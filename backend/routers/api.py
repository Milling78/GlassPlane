"""
API routers — one per subsystem plus a unified /summary endpoint.
All responses are cached for CACHE_TTL_SECONDS to avoid hammering APIs.
"""

import logging
from functools import wraps
from time import time
from typing import Callable, Any, Optional

from fastapi import APIRouter, HTTPException

from config import get_settings
from models.schemas import (
    VCenterSummary, ArubaSummary, AlletraSummary, VeeamSummary,
    GlassplaneSummary, HealthStatus
)
from connectors.vcenter import fetch_vcenter_summary
from connectors.aruba import fetch_aruba_summary
from connectors.alletra import fetch_alletra_summary
from connectors.veeam import fetch_veeam_summary

logger = logging.getLogger(__name__)

# ── Simple in-process TTL cache ───────────────────────────────────────────────

_cache: dict[str, tuple[float, Any]] = {}


def cached(key: str):
    def decorator(fn: Callable):
        @wraps(fn)
        async def wrapper(*args, **kwargs):
            ttl = get_settings().cache_ttl_seconds
            now = time()
            if key in _cache:
                ts, val = _cache[key]
                if now - ts < ttl:
                    return val
            result = fn(*args, **kwargs)
            _cache[key] = (now, result)
            return result
        return wrapper
    return decorator


# ── vCenter router ────────────────────────────────────────────────────────────

vcenter_router = APIRouter(prefix="/vcenter", tags=["vCenter"])


@vcenter_router.get("/", response_model=VCenterSummary)
@cached("vcenter")
def get_vcenter():
    try:
        return fetch_vcenter_summary()
    except Exception as e:
        logger.error(f"vCenter error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@vcenter_router.get("/vms", response_model=list[VMSummary])
def get_vms(
    cluster: Optional[str] = None,
    flag: Optional[str] = None,      # idle | oversized | off | clean
    search: Optional[str] = None,
    sort_by: str = "cpu_util_pct",
    sort_dir: str = "desc",
    limit: int = 500,
    offset: int = 0,
):
    """
    Filtered, sorted VM inventory.
    Combines a cached vCenter pull with in-process filtering.
    """
    from models.schemas import VMSummary
    try:
        summary = fetch_vcenter_summary()
    except Exception as e:
        logger.error(f"vCenter error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))

    vms: list[VMSummary] = summary.vms

    if cluster:
        vms = [v for v in vms if v.cluster.lower() == cluster.lower()]
    if flag == "idle":
        vms = [v for v in vms if v.is_idle]
    elif flag == "oversized":
        vms = [v for v in vms if v.is_oversized]
    elif flag == "off":
        vms = [v for v in vms if v.power_state != "poweredOn"]
    elif flag == "clean":
        vms = [v for v in vms if not v.is_idle and not v.is_oversized and v.power_state == "poweredOn"]
    if search:
        q = search.lower()
        vms = [v for v in vms if q in v.name.lower() or q in v.host.lower()]

    sort_fields = {
        "cpu_util_pct", "ram_util_pct", "cpu_allocated_mhz", "ram_allocated_mb",
        "datastore_gb", "name", "cluster", "host"
    }
    if sort_by not in sort_fields:
        sort_by = "cpu_util_pct"

    reverse = sort_dir.lower() != "asc"
    vms = sorted(vms, key=lambda v: getattr(v, sort_by, 0), reverse=reverse)
    return vms[offset: offset + limit]


# ── Aruba router ──────────────────────────────────────────────────────────────

aruba_router = APIRouter(prefix="/aruba", tags=["Aruba"])


@aruba_router.get("/", response_model=ArubaSummary)
@cached("aruba")
def get_aruba():
    try:
        return fetch_aruba_summary()
    except Exception as e:
        logger.error(f"Aruba error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# ── Alletra router ────────────────────────────────────────────────────────────

alletra_router = APIRouter(prefix="/alletra", tags=["Alletra 6000"])


@alletra_router.get("/", response_model=AlletraSummary)
@cached("alletra")
def get_alletra():
    try:
        return fetch_alletra_summary()
    except Exception as e:
        logger.error(f"Alletra error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# ── Veeam router ──────────────────────────────────────────────────────────────

veeam_router = APIRouter(prefix="/veeam", tags=["Veeam"])


@veeam_router.get("/", response_model=VeeamSummary)
@cached("veeam")
def get_veeam():
    try:
        return fetch_veeam_summary()
    except Exception as e:
        logger.error(f"Veeam error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# ── Unified glassplane router ─────────────────────────────────────────────────

glassplane_router = APIRouter(prefix="/summary", tags=["Glassplane"])


def _optimization_score(
    vcenter: VCenterSummary | None,
    aruba: ArubaSummary | None,
    alletra: AlletraSummary | None,
    veeam: VeeamSummary | None
) -> tuple[int, list[str]]:
    score = 100
    recs = []

    if vcenter:
        if vcenter.idle_vms:
            penalty = min(vcenter.idle_vms * 3, 20)
            score -= penalty
            recs.append(f"Review {vcenter.idle_vms} idle VMs — reclaim ~{vcenter.wasted_ram_gb:.0f} GB RAM / {vcenter.wasted_cpu_ghz:.1f} GHz CPU")
        if vcenter.oversized_vms:
            penalty = min(vcenter.oversized_vms * 2, 15)
            score -= penalty
            recs.append(f"Right-size {vcenter.oversized_vms} over-provisioned VMs to recover stranded capacity")
        for c in vcenter.clusters:
            if c.cpu_util_pct < 30:
                score -= 5
                recs.append(f"Cluster '{c.name}' is under 30% CPU — consider consolidation")

    if aruba:
        if aruba.unused_port_pct > 30:
            score -= 10
            recs.append(f"{aruba.unused_ports} switch ports ({aruba.unused_port_pct:.0f}%) are unused — audit for decommission")

    if alletra:
        if alletra.util_pct > 80:
            score -= 15
            recs.append(f"Alletra utilisation at {alletra.util_pct}% — plan capacity expansion soon")
        elif alletra.util_pct < 30:
            score -= 5
            recs.append(f"Alletra at only {alletra.util_pct}% used — storage over-provisioned vs. actual need")
        if alletra.total_efficiency_ratio < 2.0:
            score -= 5
            recs.append("Storage efficiency ratio below 2:1 — review dedup/compression policies")

    if veeam:
        if veeam.failed_jobs:
            score -= 20
            recs.append(f"{veeam.failed_jobs} backup job(s) failing — data protection at risk")
        if veeam.unprotected_vms:
            score -= 10
            recs.append(f"{veeam.unprotected_vms} VMs have no backup coverage")
        if veeam.repo_util_pct > 80:
            score -= 10
            recs.append(f"Backup repositories at {veeam.repo_util_pct}% capacity — add storage before retention is impacted")

    return max(0, score), recs[:6]  # cap at 6 recommendations


@glassplane_router.get("/", response_model=GlassplaneSummary)
async def get_summary():
    vcenter = aruba = alletra = veeam = None
    statuses = []

    for name, fetcher, setter in [
        ("vcenter", fetch_vcenter_summary, lambda v: None),
        ("aruba", fetch_aruba_summary, lambda v: None),
        ("alletra", fetch_alletra_summary, lambda v: None),
        ("veeam", fetch_veeam_summary, lambda v: None),
    ]:
        try:
            if name == "vcenter":
                vcenter = fetch_vcenter_summary()
            elif name == "aruba":
                aruba = fetch_aruba_summary()
            elif name == "alletra":
                alletra = fetch_alletra_summary()
            elif name == "veeam":
                veeam = fetch_veeam_summary()
        except Exception as e:
            logger.warning(f"{name} unavailable: {e}")

    # Gather worst status
    for obj in [aruba, alletra, veeam]:
        if obj and hasattr(obj, "status"):
            statuses.append(obj.status)

    if HealthStatus.CRITICAL in statuses:
        overall = HealthStatus.CRITICAL
    elif HealthStatus.WARNING in statuses:
        overall = HealthStatus.WARNING
    else:
        overall = HealthStatus.OK

    score, recs = _optimization_score(vcenter, aruba, alletra, veeam)

    return GlassplaneSummary(
        vcenter=vcenter,
        aruba=aruba,
        alletra=alletra,
        veeam=veeam,
        overall_status=overall,
        optimization_score=score,
        top_recommendations=recs
    )
