"""
vcenter_perf.py — fine-grained CPU/RAM time-series from vCenter performance manager.

Surge detection algorithm:
  1. Pull N minutes of per-VM CPU/RAM data at 20-second intervals
  2. Smooth with a 3-sample rolling average to kill single-sample spikes
  3. Threshold crossing → surge event (record peak time + value)
  4. Cluster inter-surge intervals with ±TOLERANCE_MIN tolerance
  5. Any cluster with ≥MIN_OCCURRENCES surges and period in [5, 120] min = cyclic alert
"""

import logging
import ssl
from datetime import datetime, timedelta
from statistics import mean, stdev
from typing import Optional

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim

from config import get_settings

logger = logging.getLogger(__name__)

# ── Tuning constants ──────────────────────────────────────────────────────────

SAMPLE_INTERVAL_SEC   = 300    # vCenter "5-minute" rolled-up counter (use 20 for real-time)
LOOKBACK_HOURS        = 2
DEFAULT_THRESHOLD_PCT = 80.0
TOLERANCE_MIN         = 3      # ±3 minutes when clustering intervals
MIN_OCCURRENCES       = 2      # minimum surge events to call a pattern cyclic
MIN_PERIOD_MIN        = 5
MAX_PERIOD_MIN        = 120
SMOOTH_WINDOW         = 3      # samples for rolling average


# ── Data classes ──────────────────────────────────────────────────────────────

class SurgeEvent:
    def __init__(self, timestamp: datetime, minute_offset: int, peak_pct: float):
        self.timestamp    = timestamp
        self.minute_offset = minute_offset
        self.peak_pct     = peak_pct


class SurgePeriod:
    def __init__(self, period_min: int, occurrences: int, offsets: list[int]):
        self.period_min   = period_min
        self.occurrences  = occurrences
        self.offsets      = offsets       # minute-of-period where surges occur
        self.confidence   = min(1.0, occurrences / 4)


class VMSurgeResult:
    def __init__(
        self,
        vm_id: str,
        name: str,
        cluster: str,
        host: str,
        metric: str,
        series: list[float],
        series_timestamps: list[str],
        threshold_pct: float,
        surge_events: list[SurgeEvent],
        periods: list[SurgePeriod],
        max_pct: float,
        avg_pct: float,
        is_cyclic: bool,
    ):
        self.vm_id             = vm_id
        self.name              = name
        self.cluster           = cluster
        self.host              = host
        self.metric            = metric
        self.series            = series
        self.series_timestamps = series_timestamps
        self.threshold_pct     = threshold_pct
        self.surge_events      = surge_events
        self.periods           = periods
        self.max_pct           = max_pct
        self.avg_pct           = avg_pct
        self.is_cyclic         = is_cyclic


# ── Smoothing ─────────────────────────────────────────────────────────────────

def _rolling_avg(series: list[float], window: int) -> list[float]:
    result = []
    for i, v in enumerate(series):
        lo = max(0, i - window // 2)
        hi = min(len(series), i + window // 2 + 1)
        result.append(mean(series[lo:hi]))
    return result


# ── Surge detection ───────────────────────────────────────────────────────────

def detect_surge_events(
    series: list[float],
    timestamps: list[datetime],
    threshold_pct: float,
) -> list[SurgeEvent]:
    smoothed = _rolling_avg(series, SMOOTH_WINDOW)
    events: list[SurgeEvent] = []
    in_surge = False
    peak_t = 0
    peak_v = 0.0

    for i, v in enumerate(smoothed):
        if v >= threshold_pct:
            if not in_surge:
                in_surge = True
                peak_t = i
                peak_v = v
            elif v > peak_v:
                peak_t = i
                peak_v = v
        else:
            if in_surge:
                ts = timestamps[peak_t]
                # Convert to minutes from start
                minutes = round((ts - timestamps[0]).total_seconds() / 60)
                events.append(SurgeEvent(ts, minutes, round(peak_v, 1)))
                in_surge = False

    if in_surge:
        ts = timestamps[peak_t]
        minutes = round((ts - timestamps[0]).total_seconds() / 60)
        events.append(SurgeEvent(ts, minutes, round(peak_v, 1)))

    return events


# ── Periodicity detection ─────────────────────────────────────────────────────

def detect_periodicity(surge_events: list[SurgeEvent]) -> list[SurgePeriod]:
    if len(surge_events) < 2:
        return []

    times = [e.minute_offset for e in surge_events]

    # Build all pairwise intervals
    intervals: list[int] = []
    for i in range(1, len(times)):
        intervals.append(times[i] - times[i - 1])

    # Cluster intervals with tolerance
    clusters: list[dict] = []
    for iv in intervals:
        matched = False
        for cl in clusters:
            if abs(iv - cl['center']) <= TOLERANCE_MIN:
                cl['samples'].append(iv)
                cl['center'] = round(mean(cl['samples']))
                matched = True
                break
        if not matched:
            clusters.append({'center': iv, 'samples': [iv]})

    # Build SurgePeriod objects for valid clusters
    results: list[SurgePeriod] = []
    for cl in clusters:
        period = cl['center']
        count  = len(cl['samples']) + 1  # intervals + 1 = occurrences
        if count < MIN_OCCURRENCES or not (MIN_PERIOD_MIN <= period <= MAX_PERIOD_MIN):
            continue
        # Find which minute-of-period the surges occur at
        offsets = [t % period for t in times]
        results.append(SurgePeriod(period, count, sorted(set(offsets))))

    return sorted(results, key=lambda p: -p.occurrences)


# ── vCenter perf query ────────────────────────────────────────────────────────

def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _get_counter_id(perf_mgr, group: str, name: str, rollup: str) -> Optional[int]:
    for c in perf_mgr.perfCounter:
        if c.groupInfo.key == group and c.nameInfo.key == name and c.rollupType == rollup:
            return c.key
    return None


def _query_metric(
    perf_mgr,
    vm: vim.VirtualMachine,
    counter_id: int,
    start: datetime,
    end: datetime,
    interval: int,
) -> tuple[list[float], list[datetime]]:
    def _run(ivl: int, t_start: datetime = start) -> tuple[list[float], list[datetime]]:
        metric_id = vim.PerformanceManager.MetricId(counterId=counter_id, instance="")
        spec = vim.PerformanceManager.QuerySpec(
            entity=vm,
            metricId=[metric_id],
            startTime=t_start,
            endTime=end,
            intervalId=ivl,
        )
        res = perf_mgr.QueryPerf(querySpec=[spec])
        if not res or not res[0].value:
            return [], []
        values = [v / 100.0 for v in res[0].value[0].value]  # vCenter returns hundredths of %
        stamps = [s.timestamp for s in res[0].sampleInfo]
        return values, stamps

    values, stamps = _run(interval)
    if not values and interval != 20:
        # Real-time buffer is only ~1 hour; clamp start so we don't ask for data
        # that has already been evicted, which causes vCenter to return empty.
        rt_start = max(start, datetime.utcnow() - timedelta(minutes=55))
        values, stamps = _run(20, rt_start)
    return values, stamps


# ── DB-backed surge calc ──────────────────────────────────────────────────────

def _surges_from_db(
    db_data: dict,
    threshold_pct: float,
    metric: str,
) -> list[VMSurgeResult]:
    results: list[VMSurgeResult] = []
    for vm_id, vm in db_data.items():
        series = vm["series"]
        stamps = vm["timestamps"]
        if len(series) < 2:
            continue
        surge_events = detect_surge_events(series, stamps, threshold_pct)
        periods      = detect_periodicity(surge_events)
        results.append(VMSurgeResult(
            vm_id=vm_id,
            name=vm["name"],
            cluster=vm["cluster"],
            host=vm["host"],
            metric=metric,
            series=[round(v, 1) for v in series],
            series_timestamps=[str(t) for t in stamps],
            threshold_pct=threshold_pct,
            surge_events=surge_events,
            periods=periods,
            max_pct=round(max(series), 1),
            avg_pct=round(mean(series), 1),
            is_cyclic=bool(periods),
        ))
    return results


# ── Public API ────────────────────────────────────────────────────────────────

def fetch_vm_surges(
    threshold_pct: float = DEFAULT_THRESHOLD_PCT,
    metric: str = "cpu",
    lookback_hours: float = LOOKBACK_HOURS,
    vm_name_filter: Optional[str] = None,
) -> tuple[list[VMSurgeResult], int]:
    """
    Return (results, vms_found).  Reads from the local vm_perf DB when data
    is available; falls back to a live vCenter query on first run.
    """
    from config import get_settings as _gs
    from history.store import read_vm_perf
    s = _gs()
    db_data = read_vm_perf(s.db_path, lookback_hours, metric, vm_name_filter)
    if db_data:
        results = _surges_from_db(db_data, threshold_pct, metric)
        return results, len(db_data)
    # No local data yet — fall back to live vCenter query
    return _fetch_from_vcenter(threshold_pct, metric, lookback_hours, vm_name_filter)


def _fetch_from_vcenter(
    threshold_pct: float = DEFAULT_THRESHOLD_PCT,
    metric: str = "cpu",
    lookback_hours: float = LOOKBACK_HOURS,
    vm_name_filter: Optional[str] = None,
) -> tuple[list[VMSurgeResult], int]:
    """Live vCenter fallback — used only when the local DB has no data yet."""
    settings  = get_settings()
    ctx       = _ssl_ctx()
    end_time   = datetime.utcnow()
    start_time = end_time - timedelta(hours=lookback_hours)

    si = SmartConnect(
        host=settings.vcenter_host,
        user=settings.vcenter_user,
        pwd=settings.vcenter_password,
        port=settings.vcenter_port,
        sslContext=ctx,
    )
    try:
        content  = si.content
        perf_mgr = si.content.perfManager

        if metric == "cpu":
            counter_id = _get_counter_id(perf_mgr, "cpu", "usage", "average")
        else:
            counter_id = _get_counter_id(perf_mgr, "mem", "usage", "average")

        if counter_id is None:
            raise ValueError(f"Performance counter not found for metric: {metric}")

        container = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True
        )
        vms = [
            vm for vm in container.view
            if vm.runtime.powerState == vim.VirtualMachinePowerState.poweredOn
            and vm.config is not None
            and (vm_name_filter is None or vm_name_filter.lower() in vm.config.name.lower())
        ]
        container.Destroy()

        vms_found = len(vms)
        results: list[VMSurgeResult] = []

        for vm in vms:
            try:
                raw_values, stamps = _query_metric(
                    perf_mgr, vm, counter_id, start_time, end_time, SAMPLE_INTERVAL_SEC
                )
                if len(raw_values) < 2:
                    continue

                surge_events = detect_surge_events(raw_values, stamps, threshold_pct)
                periods      = detect_periodicity(surge_events)
                is_cyclic    = bool(periods)

                max_pct = round(max(raw_values), 1)
                avg_pct = round(mean(raw_values), 1)

                cluster_name = "standalone"
                host_obj = vm.runtime.host
                if host_obj and hasattr(host_obj, "parent"):
                    parent = host_obj.parent
                    if isinstance(parent, vim.ClusterComputeResource):
                        cluster_name = parent.name

                results.append(VMSurgeResult(
                    vm_id=vm.config.uuid,
                    name=vm.config.name,
                    cluster=cluster_name,
                    host=host_obj.name if host_obj else "unknown",
                    metric=metric,
                    series=[round(v, 1) for v in raw_values],
                    series_timestamps=[str(t) for t in stamps],
                    threshold_pct=threshold_pct,
                    surge_events=surge_events,
                    periods=periods,
                    max_pct=max_pct,
                    avg_pct=avg_pct,
                    is_cyclic=is_cyclic,
                ))
            except Exception as e:
                name = getattr(getattr(vm, 'config', None), 'name', repr(vm))
                logger.debug(f"Skipping {name}: {e}")

        return results, vms_found
    finally:
        Disconnect(si)
