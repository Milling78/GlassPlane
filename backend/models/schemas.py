from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ── Shared ────────────────────────────────────────────────────────────────────

class HealthStatus(str, Enum):
    OK = "ok"
    WARNING = "warning"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


# ── vCenter / Compute ─────────────────────────────────────────────────────────

class VMSummary(BaseModel):
    vm_id: str
    name: str
    power_state: str
    cpu_allocated_mhz: int
    cpu_used_mhz: float
    cpu_util_pct: float
    ram_allocated_mb: int
    ram_used_mb: float
    ram_util_pct: float
    datastore_gb: float
    host: str
    cluster: str
    is_idle: bool          # CPU < 5% sustained
    is_oversized: bool     # Allocated >> actual peak


class ClusterSummary(BaseModel):
    name: str
    host_count: int
    total_cpu_ghz: float
    used_cpu_ghz: float
    cpu_util_pct: float
    total_ram_gb: float
    used_ram_gb: float
    ram_util_pct: float
    vm_count: int
    idle_vm_count: int
    oversized_vm_count: int
    status: HealthStatus


class VCenterSummary(BaseModel):
    clusters: list[ClusterSummary]
    vms: list[VMSummary]
    total_vms: int
    powered_on: int
    idle_vms: int
    oversized_vms: int
    wasted_cpu_ghz: float
    wasted_ram_gb: float


# ── Aruba Networking ──────────────────────────────────────────────────────────

class SwitchPort(BaseModel):
    port_id: str
    name: str
    speed_mbps: int
    rx_util_pct: float
    tx_util_pct: float
    is_unused: bool        # No traffic in 30 days


class Switch(BaseModel):
    device_id: str
    name: str
    model: str
    site: str
    uptime_seconds: int
    port_count: int
    unused_ports: int
    cpu_util_pct: float
    mem_util_pct: float
    status: HealthStatus
    ports: list[SwitchPort] = Field(default_factory=list)


class ArubaSummary(BaseModel):
    switch_count: int
    total_ports: int
    unused_ports: int
    unused_port_pct: float
    switches: list[Switch]
    status: HealthStatus


# ── HPE Alletra 6000 ──────────────────────────────────────────────────────────

class Volume(BaseModel):
    volume_id: str
    name: str
    provisioned_gb: float
    used_gb: float
    util_pct: float
    dedup_ratio: float
    compress_ratio: float
    total_savings_pct: float
    is_thin: bool
    host_mapped: Optional[str] = None


class AlletraSummary(BaseModel):
    array_name: str
    model: str
    total_raw_tb: float
    usable_tb: float
    used_tb: float
    free_tb: float
    util_pct: float
    dedup_savings_tb: float
    compression_savings_tb: float
    total_efficiency_ratio: float
    volume_count: int
    volumes: list[Volume]
    iops: int
    latency_ms: float
    throughput_mbps: float
    status: HealthStatus


# ── HPE iLO / Redfish ─────────────────────────────────────────────────────────

class ILOHostSummary(BaseModel):
    hostname: str
    model: str = ""
    serial: str = ""
    health: str = "OK"           # OK | Warning | Critical
    power_state: str = "Unknown" # On | Off | Unknown
    power_watts: Optional[float] = None
    power_cap_watts: Optional[float] = None
    cpu_temp_c: Optional[float] = None
    ambient_temp_c: Optional[float] = None
    fan_status: str = "OK"       # OK | Warning | Critical
    recent_errors: list[str] = []
    status: HealthStatus = HealthStatus.OK


class ILOSummary(BaseModel):
    hosts: list[ILOHostSummary]
    total_power_watts: float
    host_count: int
    error_count: int
    status: HealthStatus


# ── Veeam ─────────────────────────────────────────────────────────────────────

class JobSession(BaseModel):
    session_id: str
    job_id: str
    job_name: str
    result: str                         # Success | Warning | Failed | None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    duration_seconds: Optional[int] = None


class BackupJob(BaseModel):
    job_id: str
    name: str
    type: str          # Backup, BackupCopy, Replication
    status: str        # Success, Warning, Failed, Running, None
    last_run: Optional[str] = None
    duration_seconds: Optional[int] = None
    data_size_gb: float
    dedupe_ratio: float
    compress_ratio: float
    vms_protected: int


class Repository(BaseModel):
    repo_id: str
    name: str
    host: str
    capacity_gb: float
    used_gb: float
    free_gb: float
    util_pct: float
    status: HealthStatus


class VeeamSummary(BaseModel):
    job_count: int
    protected_vms: int
    unprotected_vms: int
    success_jobs: int
    warning_jobs: int
    failed_jobs: int
    running_jobs: int
    jobs: list[BackupJob]
    repositories: list[Repository]
    total_repo_capacity_gb: float
    total_repo_used_gb: float
    repo_util_pct: float
    status: HealthStatus


# ── Unified Glassplane ────────────────────────────────────────────────────────

class GlassplaneSummary(BaseModel):
    vcenter: Optional[VCenterSummary] = None
    aruba: Optional[ArubaSummary] = None
    alletra: Optional[AlletraSummary] = None
    veeam: Optional[VeeamSummary] = None
    overall_status: HealthStatus
    optimization_score: int        # 0-100
    top_recommendations: list[str]
