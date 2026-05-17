"""
HP iLO (Redfish) connector — iLO 5 / 6, Gen10 / Gen10+.
Fetches power, thermal, health, and IML log from each configured host
in parallel. One shared username/password across all hosts.
"""

import logging
import ssl
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

import httpx

from config import get_settings
from models.schemas import ILOHostSummary, ILOSummary, HealthStatus

logger = logging.getLogger(__name__)

_BASE = "/redfish/v1"

# ── Per-host Redfish session cache ────────────────────────────────────────────
# iLO allows only 3–5 concurrent sessions per host. Creating a new session on
# every 60-second cache refresh (×N hosts) floods the iLO event log and can
# exhaust the session limit. Instead, we cache the X-Auth-Token per host and
# reuse it; the session is only re-created on first access or after a 401.
# iLO sessions time out after ~30 min inactivity; each API call resets the
# timer, so an active poller will keep the session alive indefinitely.
_session_lock = threading.Lock()
# host:port -> {"token": str, "use_basic": bool, "ts": float}
_sessions: dict[str, dict] = {}
_SESSION_MAX_AGE = 3600 * 22   # force re-auth after 22 h as a safety margin


def _build_client(host: str, port: int, ssl_verify: bool,
                  token: str | None, user: str, password: str) -> httpx.Client:
    ssl_ctx = _make_ssl_ctx(ssl_verify)
    headers = {"OData-Version": "4.0", "Accept": "application/json"}
    if token:
        headers["X-Auth-Token"] = token
        return httpx.Client(verify=ssl_ctx, timeout=25, headers=headers)
    return httpx.Client(auth=(user, password), verify=ssl_ctx, timeout=25, headers=headers)


def _create_session(host: str, port: int, user: str, password: str,
                    ssl_verify: bool) -> str | None:
    """POST to SessionService. Returns X-Auth-Token on success, None on failure."""
    ssl_ctx = _make_ssl_ctx(ssl_verify)
    headers = {"OData-Version": "4.0", "Accept": "application/json",
               "Content-Type": "application/json"}
    try:
        with httpx.Client(verify=ssl_ctx, timeout=15) as probe:
            r = probe.post(
                f"https://{host}:{port}{_BASE}/SessionService/Sessions/",
                json={"UserName": user, "Password": password},
                headers=headers,
            )
            if r.status_code in (200, 201):
                return r.headers.get("X-Auth-Token") or r.headers.get("x-auth-token")
    except Exception as e:
        logger.debug(f"iLO {host} session POST failed ({e})")
    return None


def _get_session_token(host: str, port: int, user: str, password: str,
                       ssl_verify: bool) -> str | None:
    """Return a cached or freshly created session token. None → use Basic auth."""
    key = f"{host}:{port}"
    now = time.monotonic()

    with _session_lock:
        cached = _sessions.get(key)
        if cached and (now - cached["ts"]) < _SESSION_MAX_AGE:
            return None if cached.get("use_basic") else cached.get("token")

    token = _create_session(host, port, user, password, ssl_verify)
    with _session_lock:
        if token:
            _sessions[key] = {"token": token, "use_basic": False, "ts": now}
        else:
            # Session creation failed — remember to use Basic auth for this host
            _sessions[key] = {"use_basic": True, "ts": now}
    return token


def _invalidate_session(host: str, port: int) -> None:
    with _session_lock:
        _sessions.pop(f"{host}:{port}", None)


def _make_ssl_ctx(ssl_verify: bool) -> ssl.SSLContext:
    """
    Permissive SSL context for iLO.  Gen9 / iLO 4 firmware only supports
    TLS 1.0/1.1 and a restricted cipher set; the Python default of TLS 1.2+
    causes 'server disconnected without sending a response'.
    """
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_REQUIRED if ssl_verify else ssl.CERT_NONE
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1
    except (AttributeError, ssl.SSLError):
        pass
    try:
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
    except ssl.SSLError:
        pass
    return ctx


def _get(client: httpx.Client, host: str, port: int, path: str) -> dict:
    url = f"https://{host}:{port}{_BASE}{path}"
    r = client.get(url)
    r.raise_for_status()
    return r.json()




def _worst_health(*statuses: str) -> HealthStatus:
    s = {v.lower() for v in statuses if v}
    if "critical" in s: return HealthStatus.CRITICAL
    if "warning"  in s: return HealthStatus.WARNING
    return HealthStatus.OK


def _fetch_host(host: str, user: str, password: str, port: int, ssl_verify: bool) -> ILOHostSummary:
    for attempt in range(2):
        token = _get_session_token(host, port, user, password, ssl_verify)
        client = _build_client(host, port, ssl_verify, token, user, password)
        try:
            result = _fetch_host_data(client, host, port)
            return result
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401 and attempt == 0:
                logger.info(f"iLO {host}: session expired (401), re-authenticating")
                _invalidate_session(host, port)
                client.close()
                continue
            client.close()
            raise
        except Exception:
            client.close()
            raise


def _fetch_host_data(client: httpx.Client, host: str, port: int) -> ILOHostSummary:
    amber: list[str] = []

    with client:
        # ── System: model, serial, power state, overall health ──────────────
        sys  = _get(client, host, port, "/Systems/1/")
        model       = sys.get("Model", "")
        serial      = sys.get("SerialNumber", "").strip()
        power_state = sys.get("PowerState", "Unknown")
        sys_health  = sys.get("Status", {}).get("Health") or "OK"

        # Memory / processor aggregate health (amber triggers)
        mem_health  = (sys.get("MemorySummary")   or {}).get("Status", {}).get("Health") or "OK"
        cpu_health  = (sys.get("ProcessorSummary") or {}).get("Status", {}).get("Health") or "OK"
        if mem_health not in ("OK", "Informational"):
            amber.append(f"Memory {mem_health.lower()}")
        if cpu_health not in ("OK", "Informational"):
            amber.append(f"Processor {cpu_health.lower()}")

        # ── Chassis: LED state and aggregate health ──────────────────────────
        try:
            chassis = _get(client, host, port, "/Chassis/1/")
            led = chassis.get("IndicatorLED") or ""
            if led.lower() in ("lit", "blinking"):
                amber.append(f"Chassis LED {led.lower()}")
            chassis_health = (chassis.get("Status") or {}).get("Health") or "OK"
            if chassis_health not in ("OK", "Informational"):
                amber.append(f"Chassis health {chassis_health.lower()}")
        except Exception:
            pass

        # ── Power ────────────────────────────────────────────────────────────
        pwr      = _get(client, host, port, "/Chassis/1/Power/")
        ctrl     = (pwr.get("PowerControl") or [{}])[0]
        power_w  = ctrl.get("PowerConsumedWatts")
        cap_w    = (ctrl.get("PowerLimit") or {}).get("LimitInWatts")

        for i, psu in enumerate((pwr.get("PowerSupplies") or []), start=1):
            psu_status = psu.get("Status") or {}
            psu_health = psu_status.get("Health") or "OK"
            psu_state  = psu_status.get("State")  or "Enabled"
            psu_name   = psu.get("Name") or f"PSU {i}"
            if psu_state.lower() == "absent":
                amber.append(f"{psu_name} absent")
            elif psu_health not in ("OK", "Informational"):
                amber.append(f"{psu_name} {psu_health.lower()}")

        # ── Thermal ──────────────────────────────────────────────────────────
        therm        = _get(client, host, port, "/Chassis/1/Thermal/")
        cpu_temp = ambient_temp = None
        for t in therm.get("Temperatures", []):
            reading = t.get("ReadingCelsius")
            if reading is None:
                continue
            name = (t.get("Name") or "").lower()
            if any(k in name for k in ("cpu", "processor", "proc")):
                cpu_temp = max(cpu_temp or 0.0, float(reading))
            elif any(k in name for k in ("ambient", "inlet", "room")):
                ambient_temp = float(reading)
            sensor_health = (t.get("Status") or {}).get("Health") or "OK"
            if sensor_health not in ("OK", "Informational"):
                label = t.get("Name") or f"sensor {t.get('MemberId', '')}"
                amber.append(f"Temp {sensor_health.lower()}: {label} ({reading}°C)")
            else:
                warn_thresh = t.get("UpperThresholdNonCritical")
                if warn_thresh is not None and float(reading) >= float(warn_thresh):
                    label = t.get("Name") or f"sensor {t.get('MemberId', '')}"
                    amber.append(f"Temp threshold: {label} ({reading}°C ≥ {warn_thresh}°C)")

        fan_healths = [
            (f.get("Status") or {}).get("Health") or "OK"
            for f in therm.get("Fans", [])
        ]
        fan_status = (
            "Critical" if "Critical" in fan_healths else
            "Warning"  if "Warning"  in fan_healths else "OK"
        )
        for i, fan in enumerate(therm.get("Fans", []), start=1):
            fh = (fan.get("Status") or {}).get("Health") or "OK"
            if fh not in ("OK", "Informational"):
                fname = fan.get("Name") or f"Fan {i}"
                amber.append(f"Fan {fh.lower()}: {fname}")

        # ── IML — active (unrepaired) non-OK entries within the age window ─────
        recent_errors: list[str] = []
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=get_settings().alert_ilo_iml_days)
            log = _get(client, host, port, "/Systems/1/LogServices/IML/Entries/")
            for e in (log.get("Members") or []):
                severity = e.get("Severity") or "OK"
                if severity in ("OK", "Informational"):
                    continue
                oem = e.get("Oem") or {}
                hpe = oem.get("Hpe") or oem.get("Hp") or {}
                if hpe.get("Repaired"):
                    continue
                created_str = e.get("Created") or ""
                if created_str:
                    try:
                        if datetime.fromisoformat(created_str.replace("Z", "+00:00")) < cutoff:
                            continue
                    except ValueError:
                        pass
                msg = e.get("Message", "")
                date_tag = created_str[:10] if created_str else ""
                recent_errors.append(f"[{date_tag}] {msg}" if date_tag else msg)
                if len(recent_errors) >= 5:
                    break
            if recent_errors:
                amber.append(f"{len(recent_errors)} unrepaired IML entr{'y' if len(recent_errors) == 1 else 'ies'}")
        except Exception:
            pass

    # Deduplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for item in amber:
        if item not in seen:
            seen.add(item)
            deduped.append(item)

    return ILOHostSummary(
        hostname=host,
        model=model,
        serial=serial,
        health=sys_health,
        power_state=power_state,
        power_watts=round(float(power_w), 1) if power_w is not None else None,
        power_cap_watts=round(float(cap_w), 1) if cap_w is not None else None,
        cpu_temp_c=round(cpu_temp, 1) if cpu_temp is not None else None,
        ambient_temp_c=round(ambient_temp, 1) if ambient_temp is not None else None,
        fan_status=fan_status,
        recent_errors=recent_errors,
        amber_conditions=deduped,
        status=_worst_health(sys_health, fan_status),
    )


def _parse_host_map(raw: str) -> dict[str, str]:
    """Parse 'ilo1=esxi1, ilo2=esxi2' into {ilo_host: server_name}."""
    result: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if "=" in pair:
            ilo, _, name = pair.partition("=")
            ilo  = ilo.strip()
            name = name.strip()
            if ilo and name:
                result[ilo] = name
    return result


def fetch_ilo_summary() -> ILOSummary:
    s        = get_settings()
    hosts    = [h.strip() for h in s.ilo_hosts.split(",") if h.strip()]
    host_map = _parse_host_map(s.ilo_host_map)

    if not hosts:
        return ILOSummary(hosts=[], total_power_watts=0.0, host_count=0, error_count=0, status=HealthStatus.OK)

    # iLO 4 allows 3 concurrent sessions; iLO 5 allows 5.
    # Exceeding the limit causes random connection drops — cap at 3 to be safe
    # across mixed generations and add a single retry on failure.
    _MAX_WORKERS = 3
    _RETRY_DELAY = 2  # seconds between first attempt and retry

    def _fetch_with_retry(h: str) -> ILOHostSummary:
        try:
            return _fetch_host(h, s.ilo_user, s.ilo_password, s.ilo_port, s.ilo_ssl_verify)
        except Exception as first_err:
            logger.debug(f"iLO {h} first attempt failed ({first_err}), retrying in {_RETRY_DELAY}s")
            time.sleep(_RETRY_DELAY)
            return _fetch_host(h, s.ilo_user, s.ilo_password, s.ilo_port, s.ilo_ssl_verify)

    results: list[ILOHostSummary] = []
    with ThreadPoolExecutor(max_workers=min(len(hosts), _MAX_WORKERS)) as ex:
        futures = {ex.submit(_fetch_with_retry, h): h for h in hosts}
        for fut in as_completed(futures):
            host = futures[fut]
            try:
                summary = fut.result()
                summary.server_name = host_map.get(host)
                results.append(summary)
            except Exception as e:
                logger.warning(f"iLO {host} failed after retry: {e}")
                results.append(ILOHostSummary(
                    hostname=host,
                    server_name=host_map.get(host),
                    health="Unknown",
                    status=HealthStatus.WARNING,
                    recent_errors=[f"Connection failed: {e}"],
                ))

    results.sort(key=lambda h: h.hostname)

    total_power = sum(h.power_watts for h in results if h.power_watts is not None)
    error_count = sum(len(h.recent_errors) for h in results)
    worst = HealthStatus.OK
    for h in results:
        if h.status == HealthStatus.CRITICAL:
            worst = HealthStatus.CRITICAL
            break
        if h.status == HealthStatus.WARNING:
            worst = HealthStatus.WARNING

    return ILOSummary(
        hosts=results,
        total_power_watts=round(total_power, 1),
        host_count=len(results),
        error_count=error_count,
        status=worst,
    )
