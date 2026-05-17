"""
Aruba Mobility Controller (ArubaOS) standalone wireless connector.
Connects to the controller REST API (default HTTPS port 4343).

Tested against ArubaOS 8.x.  The UIDARUBA token returned in the login
response body is passed as a query parameter on every subsequent request
(cookie-based auth is unreliable across non-standard ports in some clients).
"""

import re
import ssl
import logging

import httpx

from config import get_settings
from models.schemas import AccessPoint, WirelessSummary, HealthStatus

logger = logging.getLogger(__name__)


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1
    except (AttributeError, ssl.SSLError):
        pass
    return ctx


def _parse_uptime(raw) -> int:
    """'4d:12h:3m:52s' or plain seconds integer → seconds."""
    if isinstance(raw, (int, float)):
        return int(raw)
    m = re.match(r'(?:(\d+)d:?)?(?:(\d+)h:?)?(?:(\d+)m:?)?(?:(\d+)s?)?', str(raw).strip())
    if m:
        d, h, mi, s = (int(x or 0) for x in m.groups())
        return d * 86400 + h * 3600 + mi * 60 + s
    return 0


def _parse_clients(raw) -> int:
    """'12' or '12 (5G: 8, 2.4G: 4)' → 12."""
    try:
        return int(str(raw).split()[0])
    except (ValueError, IndexError):
        return 0


def _first(*keys, src: dict, default="") -> str:
    for k in keys:
        if src.get(k) is not None:
            return str(src[k])
    return default


# (path, hint_key, extra_params)
# extra_params are merged with the UIDARUBA token on every request.
_AP_ENDPOINTS = [
    ("monitor/ap_details",        "AP Details",  {}),
    ("monitor/ap_active",         "AP active",   {}),
    ("monitor/ap_database",       "AP Database", {}),
    ("monitor/ap_table",          "AP table",    {}),
    ("monitor/ap_all",            "AP all",      {}),
    # CLI passthrough — reliable on ArubaOS 8.x when monitor/* returns 404
    ("configuration/showcommand", "AP Database", {"command": "show ap database"}),
    ("configuration/showcommand", "AP active",   {"command": "show ap active"}),
]


def _is_ap_list(v) -> bool:
    """True for an empty list or a list whose first element is a dict."""
    return isinstance(v, list) and (not v or isinstance(v[0], dict))


def _extract_ap_list(data: dict, hint_key: str) -> list | None:
    """
    Find the AP list in a parsed JSON response body.
    Tries hint_key → _data → first list-of-dicts field.
    Handles _data being a wrapper dict (e.g. {"_data": {"AP Database": [...]}}).
    Returns None only if no suitable list exists.
    """
    for key in (hint_key, "_data"):
        v = data.get(key)
        if v is None:
            continue
        if _is_ap_list(v):
            return v
        if isinstance(v, dict):
            for inner in v.values():
                if _is_ap_list(inner):
                    return inner
    for val in data.values():
        if _is_ap_list(val):
            return val
    return None


def _fetch_ap_list(client: httpx.Client, base: str, uid_token: str) -> list[dict]:
    """Try AP endpoints in order; return the first that succeeds."""
    last_err: Exception = RuntimeError("no AP endpoint available")
    got_empty = False
    for path, key, extra in _AP_ENDPOINTS:
        params = dict(extra)
        if uid_token:
            params["UIDARUBA"] = uid_token
        try:
            r = client.get(f"{base}/{path}", params=params or None)
            if r.status_code in (400, 401, 403, 404, 405, 501):
                logger.debug(f"Aruba wireless: {path} → {r.status_code}, trying next")
                continue
            r.raise_for_status()
            if not r.content:
                logger.debug(f"Aruba wireless: {path} → empty body")
                got_empty = True
                continue
            try:
                data = r.json()
            except ValueError:
                logger.debug(f"Aruba wireless: {path} → non-JSON body, trying next")
                continue
            aps = _extract_ap_list(data, key)
            if aps is not None:
                logger.debug(f"Aruba wireless: {path} → {len(aps)} APs (keys: {list(data.keys())[:6]})")
                return aps
            logger.debug(f"Aruba wireless: {path} → JSON but no list (keys: {list(data.keys())[:6]})")
        except httpx.HTTPStatusError as e:
            last_err = e
            continue
        except Exception as e:
            last_err = e
            break
    if got_empty:
        return []
    raise last_err


def fetch_aruba_wireless_controller() -> WirelessSummary:
    s    = get_settings()
    base = f"https://{s.aruba_wireless_host}:{s.aruba_wireless_port}/api/v1"

    with httpx.Client(verify=_ssl_ctx(), timeout=20, follow_redirects=True) as client:
        # ── Login ─────────────────────────────────────────────────────────────
        # ArubaOS 8.x REST login requires form-encoded body, not JSON.
        login = client.post(
            f"{base}/api/login",
            data={"uid": s.aruba_wireless_user, "passwd": s.aruba_wireless_password},
        )
        login.raise_for_status()
        try:
            _body = login.json() or {}
        except ValueError:
            _body = {}
        uid_token = (_body.get("UIDARUBA") or login.cookies.get("UIDARUBA") or "")

        try:
            ap_list = _fetch_ap_list(client, base, uid_token)
        finally:
            try:
                params = {"UIDARUBA": uid_token} if uid_token else {}
                client.get(f"{base}/api/logout", params=params or None)
            except Exception:
                pass

    aps: list[AccessPoint] = []
    for ap in ap_list:
        name     = _first("Name", "name", src=ap)
        ip       = _first("IP Address", "ip-address", "ip_address", src=ap)
        model    = _first("Model", "model", src=ap)
        group    = _first("AP Group", "group", "group_name", src=ap)
        serial   = _first("Serial #", "serial", src=ap) or name

        status_s = _first("Status", "status", src=ap).lower()
        status   = HealthStatus.OK if status_s in ("up", "online", "active") else HealthStatus.CRITICAL

        clients  = _parse_clients(_first("Clients", "client_count", "Client Count", src=ap) or 0)
        uptime   = _parse_uptime(_first("Uptime", "uptime", src=ap) or 0)

        ch_2g_raw = _first("Ch/EIRP/MaxEIRP 2.4GHz", "channel_2g", src=ap)
        ch_5g_raw = _first("Ch/EIRP/MaxEIRP 5GHz",   "channel_5g", src=ap)
        ch_2g = ch_2g_raw.split("/")[0].strip() if ch_2g_raw else None
        ch_5g = ch_5g_raw.split("/")[0].strip() if ch_5g_raw else None

        aps.append(AccessPoint(
            ap_id=serial,
            name=name,
            model=model,
            site="",
            group=group,
            ip_address=ip,
            status=status,
            client_count=clients,
            uptime_seconds=uptime,
            radio_count=2,
            channel_2g=ch_2g or None,
            channel_5g=ch_5g or None,
            source="direct",
        ))

    online  = sum(1 for a in aps if a.status == HealthStatus.OK)
    offline = len(aps) - online
    overall = HealthStatus.CRITICAL if offline > 0 else (HealthStatus.OK if aps else HealthStatus.UNKNOWN)

    return WirelessSummary(
        ap_count=len(aps),
        online_count=online,
        offline_count=offline,
        total_clients=sum(a.client_count for a in aps),
        aps=sorted(aps, key=lambda a: (-a.client_count, a.name)),
        status=overall,
    )
