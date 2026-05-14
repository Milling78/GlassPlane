"""
Aruba direct connector — connects to individual switches without Aruba Central.

Strategy (per host):
  1. Try AOS-CX REST API (HTTPS) — modern CX 6xxx/8xxx series
  2. Fall back to SSH CLI parsing — ProCurve / Provision / older AOS
"""
import re
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

from config import get_settings
from models.schemas import Switch, SwitchPort, HealthStatus

logger = logging.getLogger(__name__)

_AOSCX_API = "v10.08"
_SSH_TIMEOUT = 20
_REST_TIMEOUT = 15
_WORKERS = 8

# ── AOS-CX REST ───────────────────────────────────────────────────────────────

def _aoscx_fetch(host: str, user: str, password: str, port: int, ssl_verify: bool) -> Switch:
    base = f"https://{host}:{port}/rest/{_AOSCX_API}"
    with httpx.Client(verify=ssl_verify, timeout=_REST_TIMEOUT) as client:
        # Login — AOS-CX uses form-encoded credentials → session cookie
        resp = client.post(f"{base}/login", data={"username": user, "password": password})
        resp.raise_for_status()

        try:
            # System info
            sys_resp = client.get(
                f"{base}/system",
                params={"attributes": "hostname,platform_name,software_version,uptime,subsystems"},
            )
            sys_resp.raise_for_status()
            sys_data = sys_resp.json()

            hostname = sys_data.get("hostname", host)
            model    = sys_data.get("platform_name", "AOS-CX")
            uptime_s = int(sys_data.get("uptime", 0))

            # CPU / memory from subsystems (best-effort)
            cpu_pct = 0.0
            mem_pct = 0.0
            subs = sys_data.get("subsystems", {})
            if subs:
                for sub in subs.values():
                    if isinstance(sub, dict):
                        ru = sub.get("resource_utilization", {})
                        cpu_pct = float(ru.get("cpu", 0))
                        mem_pct = float(ru.get("memory", 0))
                        break

            # Interfaces
            int_resp = client.get(f"{base}/system/interfaces", params={"depth": "2"})
            int_resp.raise_for_status()
            raw_ifaces = int_resp.json()

            ports: list[SwitchPort] = []
            for iface_name, iface in raw_ifaces.items():
                # Physical ports only (1/1/1 style); skip LAG, VLAN, loopback
                if not re.match(r"^\d+/\d+/\d+$", iface_name):
                    continue
                if iface.get("type") not in ("system", None):
                    continue

                link_up   = iface.get("link_state") == "up"
                admin_up  = iface.get("admin_state", "up") == "up"
                speed_bps = int(iface.get("link_speed") or 0)
                speed_mbps = speed_bps // 1_000_000 if speed_bps else 1000

                stats     = iface.get("statistics", {})
                rx_bytes_s = float(stats.get("rate_bytes_rx") or 0)
                tx_bytes_s = float(stats.get("rate_bytes_tx") or 0)

                rx_pct = min(100.0, (rx_bytes_s * 8) / speed_bps * 100) if speed_bps else 0.0
                tx_pct = min(100.0, (tx_bytes_s * 8) / speed_bps * 100) if speed_bps else 0.0
                unused = (not link_up) or (rx_pct < 1.0 and tx_pct < 1.0)

                ports.append(SwitchPort(
                    port_id=iface_name,
                    name=iface.get("description") or iface_name,
                    speed_mbps=speed_mbps,
                    rx_util_pct=round(rx_pct, 1),
                    tx_util_pct=round(tx_pct, 1),
                    is_unused=unused,
                ))

        finally:
            client.post(f"{base}/logout")

    unused_count = sum(1 for p in ports if p.is_unused)
    return Switch(
        device_id=host,
        name=hostname,
        model=model,
        site="direct",
        uptime_seconds=uptime_s,
        port_count=len(ports),
        unused_ports=unused_count,
        cpu_util_pct=round(cpu_pct, 1),
        mem_util_pct=round(mem_pct, 1),
        status=HealthStatus.OK,
        ports=sorted(ports, key=lambda p: [int(x) for x in p.port_id.split("/")]),
        ip=host,
        source="direct",
    )


# ── SSH / ProCurve fallback ────────────────────────────────────────────────────

def _ssh_run(shell, cmd: str, wait: float = 2.0) -> str:
    shell.send(cmd + "\n")
    deadline = time.monotonic() + wait + 5.0
    buf = b""
    while time.monotonic() < deadline:
        if shell.recv_ready():
            buf += shell.recv(65536)
            deadline = time.monotonic() + 0.5  # extend on each recv
        elif shell.exit_status_ready():
            break
        else:
            time.sleep(0.05)
    return buf.decode("utf-8", errors="replace")


def _parse_uptime_secs(line: str) -> int:
    """Parse 'N days, H hrs, M mins, S secs' style string → seconds."""
    total = 0
    for val, unit in re.findall(r"(\d+)\s*(day|hr|min|sec)", line, re.IGNORECASE):
        n = int(val)
        if "day" in unit.lower(): total += n * 86400
        elif "hr"  in unit.lower(): total += n * 3600
        elif "min" in unit.lower(): total += n * 60
        elif "sec" in unit.lower(): total += n
    return total


def _ssh_fetch(host: str, user: str, password: str, ssh_port: int) -> Switch:
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        host, port=ssh_port, username=user, password=password,
        timeout=_SSH_TIMEOUT, look_for_keys=False, allow_agent=False,
        banner_timeout=_SSH_TIMEOUT,
    )

    try:
        shell = client.invoke_shell(width=300, height=200)
        time.sleep(1.5)
        # Drain initial banner
        while shell.recv_ready():
            shell.recv(65536)
            time.sleep(0.1)

        # Disable paging (ProCurve / Provision)
        _ssh_run(shell, "no paging", wait=0.5)

        sys_out   = _ssh_run(shell, "show system information", wait=2.5)
        brief_out = _ssh_run(shell, "show interfaces brief",   wait=3.0)
    finally:
        client.close()

    # ── Parse system info ──────────────────────────────────────────────────────
    hostname = host
    model    = "ProCurve"
    uptime_s = 0
    cpu_pct  = 0.0
    mem_pct  = 0.0

    for line in sys_out.splitlines():
        if "System Name" in line or "system name" in line.lower():
            m = re.search(r":\s*(.+)", line)
            if m: hostname = m.group(1).strip()
        elif "System Model" in line or re.search(r"(model|platform)", line, re.IGNORECASE):
            m = re.search(r":\s*(.+)", line)
            if m: model = m.group(1).strip()
        elif "Up Time" in line:
            uptime_s = _parse_uptime_secs(line)
        elif re.search(r"CPU Util", line, re.IGNORECASE):
            m = re.search(r":\s*([\d.]+)", line)
            if m: cpu_pct = float(m.group(1))
        elif "Memory" in line and "Total" in line:
            total_m = re.search(r"Total\s*[:\-]?\s*([\d,]+)", line)
            free_m  = re.search(r"Free\s*[:\-]?\s*([\d,]+)", line)
            if total_m and free_m:
                total = int(total_m.group(1).replace(",", ""))
                free  = int(free_m.group(1).replace(",", ""))
                if total > 0:
                    mem_pct = round((total - free) / total * 100, 1)

    # ── Parse interface brief ──────────────────────────────────────────────────
    # Expected columns: Port | Status Vlan Admn Oper IntfType ...
    # or: Port Type | Admn Oper IntfType ...
    ports: list[SwitchPort] = []
    for line in brief_out.splitlines():
        # Match lines starting with a port number
        m = re.match(r"^\s*(\d+[A-Za-z]?)\s+(\S+)\s*\|\s*(\w+)\s+(\w+)", line)
        if not m:
            continue
        port_id, iface_type, admin_state, oper_state = m.groups()
        link_up = oper_state.lower() == "up"

        # Extract speed from iface_type e.g. "1000T", "100/1000T", "10GbE"
        speed_mbps = 1000
        speed_m = re.search(r"(\d+)\s*G", iface_type, re.IGNORECASE)
        if speed_m:
            speed_mbps = int(speed_m.group(1)) * 1000
        else:
            speed_m = re.search(r"(\d+)T", iface_type)
            if speed_m:
                speed_mbps = int(speed_m.group(1))

        ports.append(SwitchPort(
            port_id=port_id,
            name=port_id,
            speed_mbps=speed_mbps,
            rx_util_pct=0.0,   # SSH doesn't give us rates
            tx_util_pct=0.0,
            is_unused=not link_up,
        ))

    unused_count = sum(1 for p in ports if p.is_unused)
    return Switch(
        device_id=host,
        name=hostname,
        model=model,
        site="direct",
        uptime_seconds=uptime_s,
        port_count=len(ports),
        unused_ports=unused_count,
        cpu_util_pct=round(cpu_pct, 1),
        mem_util_pct=round(mem_pct, 1),
        status=HealthStatus.OK,
        ports=sorted(ports, key=lambda p: int(re.sub(r"\D", "", p.port_id) or "0")),
        ip=host,
        source="direct",
    )


# ── Per-host dispatcher ────────────────────────────────────────────────────────

def _fetch_one(host: str, settings) -> Switch:
    host = host.strip()
    try:
        return _aoscx_fetch(
            host, settings.aruba_direct_user, settings.aruba_direct_password,
            settings.aruba_direct_port, settings.aruba_direct_ssl_verify,
        )
    except Exception as rest_err:
        logger.info(f"{host}: AOS-CX REST failed ({rest_err}), trying SSH")
        try:
            return _ssh_fetch(
                host, settings.aruba_direct_user, settings.aruba_direct_password,
                settings.aruba_direct_ssh_port,
            )
        except Exception as ssh_err:
            logger.warning(f"{host}: both REST and SSH failed — {ssh_err}")
            return Switch(
                device_id=host, name=host, model="unknown", site="direct",
                uptime_seconds=0, port_count=0, unused_ports=0,
                cpu_util_pct=0.0, mem_util_pct=0.0,
                status=HealthStatus.CRITICAL,
                ip=host, source="direct",
            )


# ── Public API ────────────────────────────────────────────────────────────────

def fetch_direct_switches() -> list[Switch]:
    settings = get_settings()
    hosts = [h.strip() for h in settings.aruba_direct_hosts.split(",") if h.strip()]
    if not hosts:
        return []

    results: list[Switch] = []
    with ThreadPoolExecutor(max_workers=min(len(hosts), _WORKERS)) as pool:
        futs = {pool.submit(_fetch_one, h, settings): h for h in hosts}
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as e:
                logger.error(f"Unexpected error for {futs[fut]}: {e}")

    results.sort(key=lambda s: s.name)
    return results
