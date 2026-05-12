"""
API routers — one per subsystem plus a unified /summary endpoint.
All responses are cached for CACHE_TTL_SECONDS to avoid hammering APIs.
"""

import logging
from functools import wraps
from time import time
from typing import Callable, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from security import verify_api_key

from config import get_settings
from models.schemas import (
    VCenterSummary, ArubaSummary, AlletraSummary, VeeamSummary,
    GlassplaneSummary, HealthStatus, ESXiHostDetail, VMSnapshotSummary, WirelessSummary
)
from connectors.vcenter import fetch_vcenter_summary, fetch_vcenter_hosts, fetch_vm_snapshots
from connectors.alletra import fetch_alletra_summary
from connectors.veeam import fetch_veeam_summary
from connectors.vcenter_perf import fetch_vm_surges, VMSurgeResult
from models.surge_schemas import SurgeSummarySchema, VMSurgeResultSchema, SurgeEventSchema, SurgePeriodSchema

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

vcenter_router = APIRouter(prefix="/vcenter", tags=["vCenter"], dependencies=[Depends(verify_api_key)])


@vcenter_router.get("/", response_model=VCenterSummary)
@cached("vcenter")
def get_vcenter():
    try:
        return fetch_vcenter_summary()
    except Exception as e:
        logger.error(f"vCenter error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@vcenter_router.get("/snapshots", response_model=list[VMSnapshotSummary])
@cached("vcenter_snapshots")
def get_snapshots():
    try:
        return fetch_vm_snapshots()
    except Exception as e:
        logger.error(f"vCenter snapshots error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@vcenter_router.get("/hosts", response_model=list[ESXiHostDetail])
@cached("vcenter_hosts")
def get_vcenter_hosts():
    try:
        return fetch_vcenter_hosts()
    except Exception as e:
        logger.error(f"vCenter hosts error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@vcenter_router.get("/vms")
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
        now = time()
        cached_vc = _cache.get("vcenter")
        if cached_vc and (now - cached_vc[0]) < get_settings().cache_ttl_seconds:
            summary = cached_vc[1]
        else:
            summary = fetch_vcenter_summary()
            _cache["vcenter"] = (now, summary)
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

aruba_router = APIRouter(prefix="/aruba", tags=["Aruba"], dependencies=[Depends(verify_api_key)])


@aruba_router.get("/", response_model=ArubaSummary)
@cached("aruba")
def get_aruba():
    try:
        return fetch_aruba_summary()
    except Exception as e:
        logger.error(f"Aruba error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@aruba_router.get("/wireless", response_model=WirelessSummary)
@cached("aruba_wireless")
def get_aruba_wireless():
    try:
        return fetch_aruba_wireless()
    except Exception as e:
        logger.error(f"Aruba wireless error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@aruba_router.get("/direct")
@cached("aruba_direct")
def get_aruba_direct():
    try:
        from connectors.aruba_direct import fetch_direct_switches
        return fetch_direct_switches()
    except Exception as e:
        logger.error(f"Aruba direct error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# ── Alletra router ────────────────────────────────────────────────────────────

alletra_router = APIRouter(prefix="/alletra", tags=["Alletra 6000"], dependencies=[Depends(verify_api_key)])


@alletra_router.get("/", response_model=AlletraSummary)
@cached("alletra")
def get_alletra():
    try:
        return fetch_alletra_summary()
    except Exception as e:
        logger.error(f"Alletra error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# ── Veeam router ──────────────────────────────────────────────────────────────

veeam_router = APIRouter(prefix="/veeam", tags=["Veeam"], dependencies=[Depends(verify_api_key)])


@veeam_router.get("/", response_model=VeeamSummary)
@cached("veeam")
def get_veeam():
    try:
        return fetch_veeam_summary()
    except Exception as e:
        logger.error(f"Veeam error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@veeam_router.get("/sessions")
def get_veeam_sessions(days: int = Query(default=30, ge=1, le=90)):
    try:
        from connectors.veeam import fetch_veeam_sessions
        sessions = fetch_veeam_sessions(days)
        return {"sessions": [s.model_dump() for s in sessions], "days": days}
    except Exception as e:
        logger.error(f"Veeam sessions error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# ── iLO / Redfish router ─────────────────────────────────────────────────────

ilo_router = APIRouter(prefix="/ilo", tags=["iLO"], dependencies=[Depends(verify_api_key)])


@ilo_router.get("/")
@cached("ilo")
def get_ilo():
    try:
        from connectors.ilo import fetch_ilo_summary
        return fetch_ilo_summary()
    except Exception as e:
        logger.error(f"iLO error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


# ── Unified glassplane router ─────────────────────────────────────────────────

glassplane_router = APIRouter(prefix="/summary", tags=["Glassplane"], dependencies=[Depends(verify_api_key)])


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


# ── Surge detection router ────────────────────────────────────────────────────

surge_router = APIRouter(prefix="/vcenter/surges", tags=["Surge Detection"], dependencies=[Depends(verify_api_key)])


def _vm_surge_to_schema(r: VMSurgeResult) -> VMSurgeResultSchema:
    return VMSurgeResultSchema(
        vm_id=r.vm_id,
        name=r.name,
        cluster=r.cluster,
        host=r.host,
        metric=r.metric,
        series=r.series,
        series_timestamps=r.series_timestamps,
        threshold_pct=r.threshold_pct,
        surge_events=[SurgeEventSchema(
            timestamp=str(e.timestamp),
            minute_offset=e.minute_offset,
            peak_pct=e.peak_pct
        ) for e in r.surge_events],
        periods=[SurgePeriodSchema(
            period_min=p.period_min,
            occurrences=p.occurrences,
            offsets=p.offsets,
            confidence=round(p.confidence, 2)
        ) for p in r.periods],
        max_pct=r.max_pct,
        avg_pct=r.avg_pct,
        is_cyclic=r.is_cyclic,
    )


@surge_router.get("/", response_model=SurgeSummarySchema)
def get_surges(
    threshold: float = 80.0,
    metric: str = "cpu",
    lookback_hours: float = 2.0,
    vm_filter: Optional[str] = None,
    cyclic_only: bool = False,
):
    """
    Scan VMs for cyclic CPU/RAM surge patterns.

    - threshold: % above which a sample is considered a surge (default 80)
    - metric: cpu | ram
    - lookback_hours: how far back to pull data (default 2, max 24)
    - vm_filter: optional substring match on VM name
    - cyclic_only: if true, omit non-cyclic VMs from all_vms list
    """
    if metric not in ("cpu", "ram"):
        raise HTTPException(status_code=400, detail="metric must be cpu or ram")
    lookback_hours = min(max(0.5, lookback_hours), 24.0)

    try:
        results = fetch_vm_surges(
            threshold_pct=threshold,
            metric=metric,
            lookback_hours=lookback_hours,
            vm_name_filter=vm_filter,
        )
    except Exception as e:
        logger.error(f"Surge detection error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))

    cyclic = [r for r in results if r.is_cyclic]
    output = cyclic if cyclic_only else results

    return SurgeSummarySchema(
        vms_scanned=len(results),
        vms_flagged=len(cyclic),
        threshold_pct=threshold,
        metric=metric,
        lookback_hours=lookback_hours,
        cyclic_vms=[_vm_surge_to_schema(r) for r in cyclic],
        all_vms=[_vm_surge_to_schema(r) for r in output],
    )
