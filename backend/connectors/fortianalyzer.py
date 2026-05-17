"""
FortiAnalyzer connector — JSON-RPC API.
Auth: session token obtained via /sys/login/user, released at end.
Tested against FortiAnalyzer 6.4 / 7.x.
"""

import logging
import ssl

import httpx

from config import get_settings
from models.schemas import FortiAnalyzerSummary, FortiAnalyzerDevice, HealthStatus

logger = logging.getLogger(__name__)

_REQ_ID = 0


def _next_id() -> int:
    global _REQ_ID
    _REQ_ID += 1
    return _REQ_ID


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _rpc(client: httpx.Client, method: str, url: str,
         session: str | None = None, data: dict | None = None,
         params_extra: dict | None = None) -> dict:
    """Execute one JSON-RPC call, return the first result's data dict (or raw result)."""
    params: dict = {"url": url}
    if data is not None:
        params["data"] = data
    if params_extra:
        params.update(params_extra)

    body: dict = {"id": _next_id(), "method": method, "params": [params]}
    if session:
        body["session"] = session

    resp = client.post("/jsonrpc", json=body)
    resp.raise_for_status()
    j = resp.json()

    results = j.get("result", [{}])
    if not results:
        return {}
    r = results[0] if isinstance(results, list) else results
    status = r.get("status", {})
    if status.get("code", 0) != 0:
        logger.debug(f"FAZ {url} status: {status}")
    return r.get("data") or {}


def fetch_fortianalyzer_summary() -> FortiAnalyzerSummary:
    s = get_settings()
    if not s.fortianalyzer_host or not s.fortianalyzer_user:
        return FortiAnalyzerSummary(hostname="unconfigured", status=HealthStatus.UNKNOWN)

    verify = s.fortianalyzer_ssl_verify if s.fortianalyzer_ssl_verify else _ssl_ctx()
    adom   = s.fortianalyzer_adom or "root"
    session: str | None = None

    with httpx.Client(
        base_url=f"https://{s.fortianalyzer_host}:{s.fortianalyzer_port}",
        verify=verify,
        timeout=20.0,
        headers={"Content-Type": "application/json"},
    ) as client:
        try:
            # ── Login ─────────────────────────────────────────────────────────
            resp = client.post("/jsonrpc", json={
                "id": _next_id(),
                "method": "exec",
                "params": [{"url": "/sys/login/user",
                             "data": {"user": s.fortianalyzer_user,
                                      "passwd": s.fortianalyzer_password}}],
            })
            resp.raise_for_status()
            login_j = resp.json()
            session = login_j.get("session")
            if not session:
                r = (login_j.get("result") or [{}])
                if isinstance(r, list): r = r[0]
                code = r.get("status", {}).get("code", -1)
                msg  = r.get("status", {}).get("message", "no session returned")
                logger.error(f"FAZ login failed (code {code}): {msg}")
                return FortiAnalyzerSummary(hostname=s.fortianalyzer_host,
                                            status=HealthStatus.UNKNOWN)

            # ── System status ─────────────────────────────────────────────────
            hostname = s.fortianalyzer_host
            version  = ""
            serial   = None
            try:
                sys_data = _rpc(client, "get", "/sys/status", session)
                if isinstance(sys_data, dict):
                    hostname = sys_data.get("Hostname") or sys_data.get("hostname") or hostname
                    version  = (sys_data.get("Version") or sys_data.get("version") or "")
                    serial   = sys_data.get("Serial Number") or sys_data.get("serial") or None
            except Exception as e:
                logger.warning(f"FAZ sys/status: {e}")

            # ── Performance (CPU + mem) ────────────────────────────────────────
            cpu_pct = None
            mem_pct = None
            try:
                perf = _rpc(client, "get", "/sys/performance", session)
                if isinstance(perf, dict):
                    cpu_pct = _pct(perf.get("CPU Usage (%)") or perf.get("cpu_usage"))
                    mem_pct = _pct(perf.get("Memory Usage (%)") or perf.get("mem_usage"))
            except Exception as e:
                logger.warning(f"FAZ performance: {e}")

            # ── Disk ──────────────────────────────────────────────────────────
            disk_total_gb = disk_used_gb = disk_pct = None
            try:
                disk_data = _rpc(client, "get", "/sys/storage", session)
                if isinstance(disk_data, list):
                    disk_data = disk_data[0] if disk_data else {}
                if isinstance(disk_data, dict):
                    total = disk_data.get("total") or disk_data.get("Total")
                    used  = disk_data.get("used")  or disk_data.get("Used")
                    if total and used:
                        disk_total_gb = round(int(total) / 1024, 1)
                        disk_used_gb  = round(int(used)  / 1024, 1)
                        disk_pct      = round(int(used) / int(total) * 100, 1)
            except Exception as e:
                logger.warning(f"FAZ storage: {e}")

            # ── Devices ───────────────────────────────────────────────────────
            devices: list[FortiAnalyzerDevice] = []
            try:
                dev_url  = f"/dvmdb/adom/{adom}/device"
                dev_data = _rpc(client, "get", dev_url, session,
                                params_extra={"option": ["object member"]})
                dev_list = dev_data if isinstance(dev_data, list) else []
                # If empty try global device list
                if not dev_list:
                    dev_list = _rpc(client, "get", "/dvmdb/device", session,
                                    params_extra={"option": ["object member"]})
                    if not isinstance(dev_list, list):
                        dev_list = []

                for d in dev_list:
                    if not isinstance(d, dict):
                        continue
                    conn = d.get("conn_status")
                    if conn is None:
                        conn_str = "unknown"
                    elif conn in (1, "1", "up", True):
                        conn_str = "up"
                    else:
                        conn_str = "down"
                    adom_list = d.get("adom_list") or []
                    dev_adom  = adom_list[0].get("adom_name", "") if (
                        adom_list and isinstance(adom_list[0], dict)) else ""
                    devices.append(FortiAnalyzerDevice(
                        name=d.get("name", ""),
                        ip=d.get("ip") or d.get("mgmt_ip") or None,
                        platform=d.get("platform_str") or d.get("platform") or "",
                        os_version=d.get("os_ver") or d.get("build") or "",
                        connection_status=conn_str,
                        adom=dev_adom or adom,
                    ))
            except Exception as e:
                logger.warning(f"FAZ devices: {e}")

            # ── Health ────────────────────────────────────────────────────────
            devices_up   = sum(1 for d in devices if d.connection_status == "up")
            devices_down = sum(1 for d in devices if d.connection_status == "down")

            health = HealthStatus.OK
            if disk_pct is not None and disk_pct >= s.fortianalyzer_disk_crit_pct:
                health = HealthStatus.CRITICAL
            elif disk_pct is not None and disk_pct >= s.fortianalyzer_disk_warn_pct:
                health = HealthStatus.WARNING
            elif devices_down > 0 and health == HealthStatus.OK:
                health = HealthStatus.WARNING

            return FortiAnalyzerSummary(
                hostname=hostname,
                version=version,
                serial=serial,
                adom=adom,
                device_count=len(devices),
                devices_up=devices_up,
                devices_down=devices_down,
                devices=devices,
                disk_total_gb=disk_total_gb,
                disk_used_gb=disk_used_gb,
                disk_pct=disk_pct,
                cpu_pct=cpu_pct,
                mem_pct=mem_pct,
                status=health,
            )

        finally:
            if session:
                try:
                    _rpc(client, "exec", "/sys/logout", session)
                except Exception:
                    pass


def _pct(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None
