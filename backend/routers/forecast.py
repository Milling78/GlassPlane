"""
Capacity forecasting — linear regression over snapshot history to project
when key metrics will breach their warning thresholds.
"""
import math
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from security import verify_api_key
from config import get_settings
from history import store

forecast_router = APIRouter(
    prefix="/forecast",
    tags=["Forecast"],
    dependencies=[Depends(verify_api_key)],
)

# ── Metric definitions ─────────────────────────────────────────────────────────

_METRICS = [
    dict(key="al_util_pct",       label="Alletra storage",    unit="%",  threshold=80.0, threshold_label="capacity warning",  higher_is_bad=True),
    dict(key="veeam_repo_pct",    label="Backup repo",         unit="%",  threshold=80.0, threshold_label="repo full warning", higher_is_bad=True),
    dict(key="ilo_total_power_w", label="Total power draw",    unit="W",  threshold=None, threshold_label="",                  higher_is_bad=True),
    dict(key="vc_idle",           label="Idle VMs",            unit="",   threshold=None, threshold_label="",                  higher_is_bad=True),
    dict(key="vc_powered_on",     label="Powered-on VMs",      unit="",   threshold=None, threshold_label="",                  higher_is_bad=False),
    dict(key="vc_cpu_max_pct",    label="Cluster CPU peak",    unit="%",  threshold=85.0, threshold_label="CPU saturation",   higher_is_bad=True),
    dict(key="vc_ram_max_pct",    label="Cluster RAM peak",    unit="%",  threshold=90.0, threshold_label="RAM saturation",   higher_is_bad=True),
    dict(key="score",             label="Optimization score",  unit="",   threshold=50.0, threshold_label="score critical",    higher_is_bad=False),
]

_STABILITY_PCT_PER_DAY = 0.3  # relative change/day below this → "stable"
_MIN_R2_FOR_FORECAST = 0.15   # don't show days-until if fit is too noisy


# ── Schemas ────────────────────────────────────────────────────────────────────

class MetricForecast(BaseModel):
    metric: str
    label: str
    unit: str
    current: Optional[float]
    slope_per_day: float
    trend: str                         # rising | falling | stable
    threshold: Optional[float]
    threshold_label: str
    higher_is_bad: bool
    days_until_threshold: Optional[int]  # None = not approaching threshold
    r_squared: float
    history: list[Optional[float]]     # chronological raw values, nulls kept


class ForecastResponse(BaseModel):
    forecasts: list[MetricForecast]
    data_points: int
    timestamps: list[float]   # epoch seconds, aligned with history arrays


# ── Maths ──────────────────────────────────────────────────────────────────────

def _linreg(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Ordinary least-squares linear regression. Returns (slope, intercept, r²)."""
    n = len(xs)
    if n < 2:
        return 0.0, (ys[0] if ys else 0.0), 0.0
    sx = sum(xs);  sy = sum(ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    sxx = sum(x * x for x in xs)
    denom = n * sxx - sx * sx
    if denom == 0.0:
        return 0.0, sy / n, 0.0
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    y_mean = sy / n
    ss_tot = sum((y - y_mean) ** 2 for y in ys)
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    r2 = max(0.0, 1.0 - ss_res / ss_tot) if ss_tot > 0.0 else 1.0
    return slope, intercept, r2


# ── Endpoint ───────────────────────────────────────────────────────────────────

@forecast_router.get("/", response_model=ForecastResponse)
def get_forecast():
    settings = get_settings()
    rows = store.read(settings.db_path, hours=settings.snapshot_retention_days * 24)

    forecasts: list[MetricForecast] = []

    for m in _METRICS:
        key: str = m["key"]
        raw: list[Optional[float]] = [r.get(key) for r in rows]
        ts_all: list[float] = [r["ts"] for r in rows]

        # Non-null pairs for regression
        pairs = [(t, v) for t, v in zip(ts_all, raw) if v is not None]

        if not pairs:
            forecasts.append(MetricForecast(
                metric=key, label=m["label"], unit=m["unit"],
                current=None, slope_per_day=0.0, trend="stable",
                threshold=m["threshold"], threshold_label=m["threshold_label"],
                higher_is_bad=m["higher_is_bad"],
                days_until_threshold=None, r_squared=0.0, history=raw,
            ))
            continue

        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]
        slope_sec, _, r2 = _linreg(xs, ys)
        slope_day = slope_sec * 86400.0
        current = ys[-1]

        # Trend classification
        rel_pct_per_day = (abs(slope_day) / abs(current) * 100.0) if current else 0.0
        if rel_pct_per_day < _STABILITY_PCT_PER_DAY:
            trend = "stable"
        elif slope_day > 0:
            trend = "rising"
        else:
            trend = "falling"

        # Days until threshold
        days_until: Optional[int] = None
        thr = m["threshold"]
        higher_bad: bool = m["higher_is_bad"]
        if thr is not None and r2 >= _MIN_R2_FOR_FORECAST:
            if higher_bad and slope_day > 0.0 and current < thr:
                raw_days = (thr - current) / slope_day
                if 0.0 < raw_days <= 365.0:
                    days_until = int(math.ceil(raw_days))
            elif not higher_bad and slope_day < 0.0 and current > thr:
                raw_days = (current - thr) / abs(slope_day)
                if 0.0 < raw_days <= 365.0:
                    days_until = int(math.ceil(raw_days))

        forecasts.append(MetricForecast(
            metric=key, label=m["label"], unit=m["unit"],
            current=round(current, 2), slope_per_day=round(slope_day, 4), trend=trend,
            threshold=thr, threshold_label=m["threshold_label"],
            higher_is_bad=m["higher_is_bad"],
            days_until_threshold=days_until, r_squared=round(r2, 3),
            history=raw,
        ))

    timestamps = [r["ts"] for r in rows]
    return ForecastResponse(forecasts=forecasts, data_points=len(rows), timestamps=timestamps)
