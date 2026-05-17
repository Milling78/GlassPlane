"""
Maps connector result objects to normalised SiemEvent instances.
Uses module-level _prev for delta detection — only emits on genuine state
changes, not on every snapshot, to avoid flooding the downstream SIEM.

On the very first snapshot after startup, _prev is empty for each source,
so we populate state without emitting events (avoids false positives on boot).
"""

import uuid
from datetime import datetime, timezone

from models.schemas import SiemEvent

_prev: dict = {}


def _ev(
    source: str,
    severity: str,
    category: str,
    event_type: str,
    message: str,
    host: str = "",
    src_ip: str = "",
    dst_ip: str = "",
    user: str = "",
    raw: dict | None = None,
) -> SiemEvent:
    return SiemEvent(
        id=str(uuid.uuid4()),
        ts=datetime.now(timezone.utc).isoformat(),
        source=source,
        severity=severity,
        category=category,
        event_type=event_type,
        message=message,
        host=host,
        src_ip=src_ip,
        dst_ip=dst_ip,
        user=user,
        raw=raw or {},
    )


# ── FortiGate ─────────────────────────────────────────────────────────────────

def from_fortigate(data) -> list[SiemEvent]:
    if data is None:
        return []
    d = data.dict() if hasattr(data, "dict") else data
    prev = _prev.get("fortigate")
    _prev["fortigate"] = d
    if prev is None:   # first snapshot — seed state, emit nothing
        return []

    events: list[SiemEvent] = []
    hostname = d.get("hostname") or d.get("host") or "fortigate"

    cpu   = d.get("cpu_pct")
    p_cpu = prev.get("cpu_pct")
    if cpu is not None and p_cpu is not None:
        if cpu >= 90 and p_cpu < 90:
            events.append(_ev("fortigate", "high", "system", "cpu_critical",
                f"FortiGate CPU reached {cpu:.0f}%",
                host=hostname, raw={"cpu_pct": cpu}))
        elif cpu >= 70 and p_cpu < 70:
            events.append(_ev("fortigate", "medium", "system", "cpu_elevated",
                f"FortiGate CPU elevated at {cpu:.0f}%",
                host=hostname, raw={"cpu_pct": cpu}))
        elif cpu < 70 and p_cpu >= 70:
            events.append(_ev("fortigate", "info", "system", "cpu_recovered",
                f"FortiGate CPU recovered to {cpu:.0f}%",
                host=hostname, raw={"cpu_pct": cpu}))

    prev_tunnels = {t["name"]: t["status"] for t in prev.get("ipsec_tunnels", [])}
    for tunnel in d.get("ipsec_tunnels", []):
        name   = tunnel.get("name", "")
        status = tunnel.get("status", "")
        prev_s = prev_tunnels.get(name)
        if prev_s is not None and prev_s != status:
            sev = "high" if status.lower() == "down" else "low"
            events.append(_ev("fortigate", sev, "network", "vpn_tunnel_state_change",
                f"IPsec tunnel '{name}': {prev_s} → {status}",
                host=hostname, raw={"tunnel": name, "from": prev_s, "to": status}))

    return events


# ── Exchange ──────────────────────────────────────────────────────────────────

def from_exchange(data) -> list[SiemEvent]:
    if data is None:
        return []
    d = data.dict() if hasattr(data, "dict") else data
    prev = _prev.get("exchange")
    _prev["exchange"] = d
    if prev is None:
        return []

    events: list[SiemEvent] = []

    prev_dbs = {x["name"]: x for x in prev.get("databases", [])}
    for db in d.get("databases", []):
        name         = db.get("name", "")
        mounted      = db.get("mounted", True)
        prev_mounted = prev_dbs.get(name, {}).get("mounted", True)
        if not mounted and prev_mounted:
            events.append(_ev("exchange", "critical", "system", "db_dismounted",
                f"Exchange database '{name}' dismounted",
                raw={"database": name}))
        elif mounted and prev_mounted is False:
            events.append(_ev("exchange", "low", "system", "db_remounted",
                f"Exchange database '{name}' remounted",
                raw={"database": name}))

    prev_qs = {x.get("identity", ""): x for x in prev.get("queues", [])}
    for q in d.get("queues", []):
        identity   = q.get("identity", "")
        count      = int(q.get("message_count") or 0)
        prev_count = int(prev_qs.get(identity, {}).get("message_count") or 0)
        if count >= 200 and prev_count < 200:
            events.append(_ev("exchange", "high", "system", "queue_critical",
                f"Exchange queue '{identity}' has {count} messages",
                raw={"queue": identity, "count": count}))
        elif count >= 50 and prev_count < 50:
            events.append(_ev("exchange", "medium", "system", "queue_elevated",
                f"Exchange queue '{identity}' has {count} messages",
                raw={"queue": identity, "count": count}))
        elif count < 50 and prev_count >= 50:
            events.append(_ev("exchange", "info", "system", "queue_cleared",
                f"Exchange queue '{identity}' cleared ({count} messages)",
                raw={"queue": identity, "count": count}))

    return events


# ── HPE iLO / Redfish ─────────────────────────────────────────────────────────

def from_ilo(data) -> list[SiemEvent]:
    if data is None:
        return []
    d = data.dict() if hasattr(data, "dict") else data
    prev = _prev.get("ilo")
    _prev["ilo"] = d
    if prev is None:
        return []

    events: list[SiemEvent] = []
    prev_hosts = {h.get("name", ""): h for h in prev.get("hosts", [])}
    for host in d.get("hosts", []):
        name       = host.get("name", "")
        health     = (host.get("health") or "").strip()
        prev_health = (prev_hosts.get(name, {}).get("health") or "").strip()
        if health and prev_health and health.lower() != prev_health.lower():
            hl = health.lower()
            sev = "critical" if hl in ("critical", "failed") \
                  else "high" if hl == "degraded" \
                  else "low"
            events.append(_ev("ilo", sev, "health", "host_health_change",
                f"iLO host '{name}' health changed: {prev_health} → {health}",
                host=name, raw={"from": prev_health, "to": health}))

    return events


# ── Veeam ─────────────────────────────────────────────────────────────────────

def from_veeam(data) -> list[SiemEvent]:
    if data is None:
        return []
    d = data.dict() if hasattr(data, "dict") else data
    prev = _prev.get("veeam")
    _prev["veeam"] = d
    if prev is None:
        return []

    events: list[SiemEvent] = []
    failed      = int(d.get("failed_jobs") or 0)
    prev_failed = int(prev.get("failed_jobs") or 0)
    if failed > 0 and failed > prev_failed:
        events.append(_ev("veeam", "high", "backup", "backup_job_failed",
            f"{failed} Veeam backup job(s) currently failing",
            raw={"failed_jobs": failed}))
    elif failed == 0 and prev_failed > 0:
        events.append(_ev("veeam", "low", "backup", "backup_jobs_recovered",
            "All Veeam backup jobs passing",
            raw={"failed_jobs": 0}))

    return events
