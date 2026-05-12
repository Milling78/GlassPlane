"""
HP iLO (Redfish) connector — iLO 5 / 6, Gen10 / Gen10+.
Fetches power, thermal, health, and IML log from each configured host
in parallel. One shared username/password across all hosts.
"""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

from config import get_settings
from models.schemas import ILOHostSummary, ILOSummary, HealthStatus

logger = logging.getLogger(__name__)

_BASE = "/redfish/v1"


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
    with httpx.Client(auth=(user, password), verify=ssl_verify, timeout=15) as client:
        # ── System: model, serial, power state, overall health ──────────────
        sys  = _get(client, host, port, "/Systems/1/")
        model       = sys.get("Model", "")
        serial      = sys.get("SerialNumber", "").strip()
        power_state = sys.get("PowerState", "Unknown")
        sys_health  = sys.get("Status", {}).get("Health") or "OK"

        # ── Power ────────────────────────────────────────────────────────────
        pwr      = _get(client, host, port, "/Chassis/1/Power/")
        ctrl     = (pwr.get("PowerControl") or [{}])[0]
        power_w  = ctrl.get("PowerConsumedWatts")
        cap_w    = (ctrl.get("PowerLimit") or {}).get("LimitInWatts")

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

        fan_healths = [
            (f.get("Status") or {}).get("Health") or "OK"
            for f in therm.get("Fans", [])
        ]
        fan_status = (
            "Critical" if "Critical" in fan_healths else
            "Warning"  if "Warning"  in fan_healths else "OK"
        )

        # ── IML — active (unrepaired) non-OK entries only ────────────────────
        recent_errors: list[str] = []
        try:
            log = _get(client, host, port, "/Systems/1/LogServices/IML/Entries/")
            for e in (log.get("Members") or []):
                if (e.get("Severity") or "OK") in ("OK", "Informational"):
                    continue
                oem = e.get("Oem") or {}
                # iLO 5 uses Hpe, older firmware uses Hp
                hpe = oem.get("Hpe") or oem.get("Hp") or {}
                if hpe.get("Repaired"):
                    continue
                recent_errors.append(e.get("Message", ""))
                if len(recent_errors) >= 5:
                    break
        except Exception:
            pass

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
        status=_worst_health(sys_health, fan_status),
    )


def fetch_ilo_summary() -> ILOSummary:
    s     = get_settings()
    hosts = [h.strip() for h in s.ilo_hosts.split(",") if h.strip()]

    results: list[ILOHostSummary] = []
    with ThreadPoolExecutor(max_workers=min(len(hosts), 8)) as ex:
        futures = {
            ex.submit(_fetch_host, h, s.ilo_user, s.ilo_password, s.ilo_port, s.ilo_ssl_verify): h
            for h in hosts
        }
        for fut in as_completed(futures):
            host = futures[fut]
            try:
                results.append(fut.result())
            except Exception as e:
                logger.warning(f"iLO {host}: {e}")
                results.append(ILOHostSummary(
                    hostname=host,
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
