"""
Surge detection schemas — added to models/schemas.py
Paste these classes into the existing file.
"""

from pydantic import BaseModel
from typing import Optional


class SurgePeriodSchema(BaseModel):
    period_min:   int
    occurrences:  int
    offsets:      list[int]    # minute-of-period when surges fire
    confidence:   float        # 0.0 – 1.0


class SurgeEventSchema(BaseModel):
    timestamp:     str
    minute_offset: int
    peak_pct:      float


class VMSurgeResultSchema(BaseModel):
    vm_id:              str
    name:               str
    cluster:            str
    host:               str
    metric:             str          # "cpu" | "ram"
    series:             list[float]  # sampled values (pct)
    series_timestamps:  list[str]
    threshold_pct:      float
    surge_events:       list[SurgeEventSchema]
    periods:            list[SurgePeriodSchema]
    max_pct:            float
    avg_pct:            float
    is_cyclic:          bool


class SurgeSummarySchema(BaseModel):
    vms_found:       int           # powered-on VMs matching filter, before data check
    vms_scanned:     int           # VMs with sufficient perf data returned
    vms_flagged:     int
    threshold_pct:   float
    metric:          str
    lookback_hours:  float
    cyclic_vms:      list[VMSurgeResultSchema]
    all_vms:         list[VMSurgeResultSchema]  # all VMs with data, not just cyclic
