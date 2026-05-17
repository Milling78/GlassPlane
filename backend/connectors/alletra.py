"""
HPE Alletra 6000 / Nimble Storage connector.
Uses the Nimble Storage REST API v1 (default port 5392).
Entirely different from the Primera/Alletra 9000 WSAPI — do not confuse.

Auth: POST /v1/tokens  →  X-Auth-Token header
"""

import logging

import httpx

from config import get_settings
from models.schemas import Volume, AlletraSummary, HealthStatus

logger = logging.getLogger(__name__)

_API = "v1"


def _base(settings) -> str:
    return f"https://{settings.alletra_host}:{settings.alletra_port}/{_API}"


def _login(client: httpx.Client, settings) -> str:
    resp = client.post(
        f"{_base(settings)}/tokens",
        json={"data": {"username": settings.alletra_user, "password": settings.alletra_password}},
    )
    resp.raise_for_status()
    return resp.json()["data"]["session_token"]


def _logout(client: httpx.Client, settings, token: str) -> None:
    try:
        client.delete(f"{_base(settings)}/tokens/{token}", headers={"X-Auth-Token": token})
    except Exception:
        pass


def _auth(token: str) -> dict:
    return {"X-Auth-Token": token, "Content-Type": "application/json"}


def _get(client: httpx.Client, settings, token: str, path: str, **params) -> dict:
    resp = client.get(f"{_base(settings)}/{path}", headers=_auth(token), params=params or None)
    resp.raise_for_status()
    return resp.json()


def _to_tb(b: float) -> float:
    return round(b / (1024 ** 4), 3)


def fetch_alletra_summary() -> AlletraSummary:
    settings = get_settings()

    with httpx.Client(verify=False, timeout=30) as client:
        token = _login(client, settings)
        try:
            arr_resp = _get(client, settings, token, "arrays", detail="true")
            vol_resp = _get(client, settings, token, "volumes", detail="true")
        finally:
            _logout(client, settings, token)

    arrays = arr_resp.get("data") or []
    arr    = arrays[0] if arrays else {}

    # ── Capacity ──────────────────────────────────────────────────────────────
    usable_bytes = float(arr.get("usable_capacity_bytes") or 0)
    free_bytes   = float(arr.get("free_space_bytes")      or 0)
    used_bytes   = max(0.0, usable_bytes - free_bytes)

    usable   = _to_tb(usable_bytes)
    free     = _to_tb(free_bytes)
    used     = _to_tb(used_bytes)
    util_pct = round(used / usable * 100, 1) if usable else 0.0

    # ── Efficiency ────────────────────────────────────────────────────────────
    # Nimble exposes combined data_reduction_ratio or individual ratios
    data_red   = float(arr.get("data_reduction_ratio") or arr.get("space_savings_ratio") or 1.0)
    comp_ratio = float(arr.get("compression_ratio")    or 1.0)
    dedup_ratio = float(arr.get("dedup_ratio")         or 1.0)
    if data_red < 1.0:
        data_red = 1.0

    savings_tb = round(used * (1 - 1 / data_red), 3) if data_red > 1 else 0.0

    # ── Volumes ───────────────────────────────────────────────────────────────
    volumes: list[Volume] = []
    for v in (vol_resp.get("data") or []):
        # Nimble size field is in MiB
        size_mib  = float(v.get("size") or 0)
        prov_gb   = round(size_mib / 1024, 2)
        used_bytes_v = float(v.get("vol_usage_compressed_bytes") or 0)
        used_gb   = round(used_bytes_v / (1024 ** 3), 2)
        util_v    = round(used_gb / prov_gb * 100, 1) if prov_gb else 0.0

        # Nimble ACRs tell us which host has access
        acrs = v.get("access_control_records") or []
        host_mapped = acrs[0].get("initiator_group_name") if acrs else None

        volumes.append(Volume(
            volume_id=str(v.get("id", "")),
            name=v.get("name", ""),
            provisioned_gb=prov_gb,
            used_gb=used_gb,
            util_pct=util_v,
            dedup_ratio=float(v.get("dedup_ratio") or dedup_ratio),
            compress_ratio=float(v.get("compression_ratio") or comp_ratio),
            total_savings_pct=round((1 - 1 / data_red) * 100, 1) if data_red > 1 else 0.0,
            is_thin=True,
            host_mapped=host_mapped,
        ))

    # ── I/O stats (live from array object when detail=true) ───────────────────
    read_iops  = int(arr.get("read_iops")  or 0)
    write_iops = int(arr.get("write_iops") or 0)
    iops       = read_iops + write_iops

    # Latency comes back in microseconds — convert to ms
    read_lat_us  = float(arr.get("read_latency_usec")  or 0)
    latency_ms   = round(read_lat_us / 1000, 2)

    # Throughput in bytes/sec → MB/s
    read_tput  = float(arr.get("read_throughput_bytes")  or 0)
    write_tput = float(arr.get("write_throughput_bytes") or 0)
    throughput_mbps = round((read_tput + write_tput) / (1024 * 1024), 1)

    array_status = (
        HealthStatus.CRITICAL if util_pct > 85 else
        HealthStatus.WARNING  if util_pct > 70 else
        HealthStatus.OK
    )

    return AlletraSummary(
        array_name=arr.get("name", "Alletra 6000"),
        model=arr.get("model", ""),
        total_raw_tb=usable,
        usable_tb=usable,
        used_tb=used,
        free_tb=free,
        util_pct=util_pct,
        dedup_savings_tb=savings_tb,
        compression_savings_tb=0.0,
        total_efficiency_ratio=data_red,
        volume_count=len(volumes),
        volumes=volumes,
        iops=iops,
        latency_ms=latency_ms,
        throughput_mbps=throughput_mbps,
        status=array_status,
    )
