"""
Aruba Mobility Controller (ArubaOS) standalone wireless connector.
Connects to the controller REST API (default HTTPS port 4343).

Tested against ArubaOS 8.x.  The login cookie (UIDARUBA) is used for
subsequent requests and cleaned up on exit.
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


def fetch_aruba_wireless_controller() -> WirelessSummary:
    s    = get_settings()
    base = f"https://{s.aruba_wireless_host}:{s.aruba_wireless_port}/api/v1"

    with httpx.Client(verify=_ssl_ctx(), timeout=20) as client:
        # ── Login ─────────────────────────────────────────────────────────────
        login = client.post(
            f"{base}/api/login",
            json={"uid": s.aruba_wireless_user, "passwd": s.aruba_wireless_password},
        )
        login.raise_for_status()
        cookies = login.cookies

        try:
            # ── AP list ───────────────────────────────────────────────────────
            ap_resp = client.get(f"{base}/monitor/ap_details", cookies=cookies)
            ap_resp.raise_for_status()
            raw = ap_resp.json()
        finally:
            try:
                client.get(f"{base}/api/logout", cookies=cookies)
            except Exception:
                pass

    aps: list[AccessPoint] = []
    for ap in raw.get("AP Details", []):
        name     = _first("Name", "name", src=ap)
        ip       = _first("IP Address", "ip-address", "ip_address", src=ap)
        model    = _first("Model", "model", src=ap)
        group    = _first("AP Group", "group", "group_name", src=ap)
        serial   = _first("Serial #", "serial", src=ap) or name

        status_s = _first("Status", "status", src=ap).lower()
        status   = HealthStatus.OK if status_s in ("up", "online", "active") else HealthStatus.CRITICAL

        clients  = _parse_clients(_first("Clients", "client_count", "Client Count", src=ap) or 0)
        uptime   = _parse_uptime(_first("Uptime", "uptime", src=ap) or 0)

        # channels — ArubaOS format: "36+/23/30" → take first token
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
