"""
HPE Alletra 6000 connector.
Uses the HPE Primera/Alletra WSAPI (port 8080) — the same REST interface
shared across HPE Primera 600 / Alletra 6000/9000 arrays.
Reference: HPE Primera / Alletra OS WSAPI Developer's Guide
"""

import logging
import base64

import httpx

from config import get_settings
from models.schemas import Volume, AlletraSummary, HealthStatus

logger = logging.getLogger(__name__)


def _base_url(settings) -> str:
    return f"https://{settings.alletra_host}:{settings.alletra_port}/api/v1"


def _get_token(client: httpx.Client, settings) -> str:
    cred = base64.b64encode(
        f"{settings.alletra_user}:{settings.alletra_password}".encode()
    ).decode()
    resp = client.post(
        f"{_base_url(settings)}/credentials",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {cred}"
        },
        json={"user": settings.alletra_user, "password": settings.alletra_password}
    )
    resp.raise_for_status()
    return resp.json()["key"]


def _headers(token: str) -> dict:
    return {
        "X-HP3PAR-WSAPI-SessionKey": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _fetch_system(client: httpx.Client, settings, token: str) -> dict:
    resp = client.get(f"{_base_url(settings)}/system", headers=_headers(token))
    resp.raise_for_status()
    return resp.json()


def _fetch_capacity(client: httpx.Client, settings, token: str) -> dict:
    resp = client.get(f"{_base_url(settings)}/capacity", headers=_headers(token))
    resp.raise_for_status()
    return resp.json()


def _fetch_volumes(client: httpx.Client, settings, token: str) -> list[dict]:
    resp = client.get(
        f"{_base_url(settings)}/volumes",
        headers=_headers(token),
        params={"query": "\"provisioningType EQ 2 OR provisioningType EQ 3\""}  # TPVV + TDVV
    )
    resp.raise_for_status()
    return resp.json().get("members", [])


def _fetch_stats(client: httpx.Client, settings, token: str) -> dict:
    """Fetch array-level I/O stats."""
    resp = client.get(
        f"{_base_url(settings)}/systemreporter/attime/volumestatistics/hires",
        headers=_headers(token),
        params={"samplefreq": "hires"}
    )
    resp.raise_for_status()
    data = resp.json()
    members = data.get("members", [{}])
    latest = members[-1] if members else {}
    return latest


def _mib_to_gb(mib: float) -> float:
    return round(mib / 1024, 2)


def _mib_to_tb(mib: float) -> float:
    return round(mib / (1024 * 1024), 3)


def fetch_alletra_summary() -> AlletraSummary:
    settings = get_settings()

    with httpx.Client(verify=False, timeout=30) as client:
        token = _get_token(client, settings)

        system = _fetch_system(client, settings, token)
        capacity = _fetch_capacity(client, settings, token)
        raw_volumes = _fetch_volumes(client, settings, token)
        stats = _fetch_stats(client, settings, token)

        # Capacity (values come in MiB)
        total_raw = _mib_to_tb(capacity.get("totalCapacityMiB", 0))
        usable = _mib_to_tb(capacity.get("allocatedCapacityMiB", 0))
        used = _mib_to_tb(capacity.get("usedCapacityMiB", 0))
        free = _mib_to_tb(capacity.get("freeCapacityMiB", 0))
        util_pct = round(used / usable * 100, 1) if usable else 0

        # Efficiency
        dedup_ratio = float(system.get("dedupRatio", 1.0)) or 1.0
        compress_ratio = float(system.get("compressionRatio", 1.0)) or 1.0
        savings_dedup = round(used * (1 - 1 / dedup_ratio), 3)
        savings_compress = round(used * (1 - 1 / compress_ratio), 3)
        total_efficiency = round(dedup_ratio * compress_ratio, 2)

        # Volumes
        volumes: list[Volume] = []
        for v in raw_volumes:
            prov = _mib_to_gb(v.get("sizeMiB", 0))
            used_v = _mib_to_gb(v.get("usedMiB", prov * 0.5))
            util_v = round(used_v / prov * 100, 1) if prov else 0
            volumes.append(Volume(
                volume_id=str(v.get("id", "")),
                name=v.get("name", ""),
                provisioned_gb=prov,
                used_gb=used_v,
                util_pct=util_v,
                dedup_ratio=float(v.get("deduplicationRatio", dedup_ratio)),
                compress_ratio=float(v.get("compressionRatio", compress_ratio)),
                total_savings_pct=round((1 - 1 / total_efficiency) * 100, 1),
                is_thin=v.get("provisioningType", 2) in (2, 3),
                host_mapped=v.get("hostName")
            ))

        # I/O stats
        iops = int(stats.get("IOPSRead", 0)) + int(stats.get("IOPSWrite", 0))
        latency_ms = float(stats.get("latencyRead", 0))
        throughput = float(stats.get("throughputRead", 0)) + float(stats.get("throughputWrite", 0))

        array_status = HealthStatus.CRITICAL if util_pct > 85 else (
            HealthStatus.WARNING if util_pct > 70 else HealthStatus.OK
        )

        return AlletraSummary(
            array_name=system.get("name", "Alletra 6000"),
            model=system.get("model", ""),
            total_raw_tb=total_raw,
            usable_tb=usable,
            used_tb=used,
            free_tb=free,
            util_pct=util_pct,
            dedup_savings_tb=savings_dedup,
            compression_savings_tb=savings_compress,
            total_efficiency_ratio=total_efficiency,
            volume_count=len(volumes),
            volumes=volumes,
            iops=iops,
            latency_ms=latency_ms,
            throughput_mbps=round(throughput, 1),
            status=array_status
        )
