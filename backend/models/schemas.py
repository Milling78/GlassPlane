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
    boot_time: Optional[str] = None       # ISO-8601 UTC, powered-on VMs only
    days_offline: Optional[int] = None    # days since last powered-off event


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


class SnapshotDetail(BaseModel):
    name: str
    description: str
    created_at: str
    age_days: float
    size_gb: Optional[float] = None
    depth: int = 0          # nesting depth in snapshot tree


class VMSnapshotSummary(BaseModel):
    vm_id: str
    vm_name: str
    host: str
    cluster: str
    snapshot_count: int
    oldest_days: float
    newest_days: float
    total_size_gb: Optional[float] = None
    snapshots: list[SnapshotDetail]


class ESXiHostDetail(BaseModel):
    name: str
    cluster: str = ""
    cpu_total_mhz: int
    cpu_used_mhz: int
    cpu_util_pct: float
    ram_total_mb: int
    ram_used_mb: int
    ram_util_pct: float
    vm_count: int


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
    ip: str = ""           # populated for directly-connected switches
    source: str = "central"  # "central" | "direct"


class AccessPoint(BaseModel):
    ap_id: str
    name: str
    model: str
    site: str
    group: str
    ip_address: str
    status: HealthStatus
    client_count: int
    uptime_seconds: int
    radio_count: int = 0
    channel_2g: Optional[str] = None
    channel_5g: Optional[str] = None
    source: str = "central"   # "central" | "direct"


class WirelessSummary(BaseModel):
    ap_count: int
    online_count: int
    offline_count: int
    total_clients: int
    aps: list[AccessPoint]
    status: HealthStatus


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
    server_name: Optional[str] = None   # manually mapped server / ESXi hostname
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
    amber_conditions: list[str] = []   # conditions that would light the chassis amber LED
    status: HealthStatus = HealthStatus.OK


class ILOSummary(BaseModel):
    hosts: list[ILOHostSummary]
    total_power_watts: float
    host_count: int
    error_count: int
    status: HealthStatus


# ── DNS ───────────────────────────────────────────────────────────────────────

class DNSServerResult(BaseModel):
    server: str
    reachable: bool
    response_ms: Optional[float] = None
    error: str = ""
    status: HealthStatus = HealthStatus.OK


class DNSRecordResult(BaseModel):
    hostname: str
    resolved: bool
    addresses: list[str] = []
    response_ms: Optional[float] = None
    error: str = ""
    source: str = "manual"   # "manual" | integration name e.g. "vCenter"


class DNSSummary(BaseModel):
    servers: list[DNSServerResult]
    records: list[DNSRecordResult]
    server_count: int
    reachable_count: int
    failed_records: int
    status: HealthStatus


# ── KACE SMA Service Desk ─────────────────────────────────────────────────────

class KACETicket(BaseModel):
    id: int
    title: str
    status: str
    priority: str
    category: str = "Uncategorized"
    submitter: str = ""
    owner: str = ""
    created: str = ""
    modified: str = ""


class KACETicketGroup(BaseModel):
    category: str
    count: int
    high_count: int
    medium_count: int
    low_count: int
    tickets: list[KACETicket]


class KACEQueueSummary(BaseModel):
    queue_id: int
    queue_name: str
    total: int
    high_count: int
    medium_count: int
    low_count: int
    groups: list[KACETicketGroup]


class KACESummary(BaseModel):
    helpdesk: Optional[KACEQueueSummary] = None
    engineering: Optional[KACEQueueSummary] = None
    total_open: int
    status: HealthStatus
    error: str = ""


# ── TLS Certificates ─────────────────────────────────────────────────────────

class CertResult(BaseModel):
    host: str
    port: int
    cn: str = ""
    sans: list[str] = []
    issuer: str = ""
    not_after: str = ""          # ISO-8601 UTC date string
    days_remaining: int = 0
    status: HealthStatus = HealthStatus.OK
    error: str = ""


class CertsSummary(BaseModel):
    hosts: list[CertResult]
    total: int
    ok_count: int
    warn_count: int
    crit_count: int
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


# ── Terminal Server / RDS ─────────────────────────────────────────────────────

class RDSHostSummary(BaseModel):
    hostname: str
    status: str = "Unknown"          # Available | Unavailable | Drain | Unreachable | Unknown
    active_sessions: int = 0
    disconnected_sessions: int = 0
    total_sessions: int = 0
    cpu_pct: Optional[float] = None
    ram_pct: Optional[float] = None
    load_pct: Optional[float] = None  # broker-reported load index (0-100)


class RDSUserSession(BaseModel):
    username: str
    domain: Optional[str] = None
    state: str = "Unknown"           # Active | Disconnected
    host: str
    idle_minutes: Optional[int] = None
    session_id: Optional[int] = None
    client_name: Optional[str] = None


class RDSSummary(BaseModel):
    broker: str
    host_count: int
    total_active: int
    total_disconnected: int
    total_sessions: int
    hosts: list[RDSHostSummary]
    sessions: list[RDSUserSession]
    status: HealthStatus
    method: str = "unknown"          # broker | direct | unconfigured | error


# ── FortiAnalyzer ─────────────────────────────────────────────────────────────

class FortiAnalyzerDevice(BaseModel):
    name: str
    ip: Optional[str] = None
    platform: str = ""
    os_version: str = ""
    connection_status: str = "unknown"   # up | down | unknown
    adom: str = ""


class FortiAnalyzerSummary(BaseModel):
    hostname: str
    version: str = ""
    serial: Optional[str] = None
    adom: str = "root"
    device_count: int = 0
    devices_up: int = 0
    devices_down: int = 0
    devices: list[FortiAnalyzerDevice] = []
    disk_total_gb: Optional[float] = None
    disk_used_gb: Optional[float] = None
    disk_pct: Optional[float] = None
    cpu_pct: Optional[float] = None
    mem_pct: Optional[float] = None
    status: HealthStatus


# ── MS Exchange ──────────────────────────────────────────────────────────────

class ExchangeMailboxDB(BaseModel):
    name: str
    server: str
    mounted: bool
    size_gb: Optional[float] = None
    whitespace_gb: Optional[float] = None
    mailbox_count: Optional[int] = None
    copy_status: str = "Unknown"       # Healthy | Failed | Suspended | Unknown (DAG copy)
    copy_queue_length: int = 0


class ExchangeQueue(BaseModel):
    identity: str
    delivery_type: str = ""
    message_count: int
    status: str = ""                   # Active | Ready | Retry | Suspended
    next_hop: Optional[str] = None


class ExchangeServerSummary(BaseModel):
    name: str
    version: str = ""
    roles: str = ""
    components_active: int = 0
    components_inactive: int = 0


class ExchangeSummary(BaseModel):
    servers: list[ExchangeServerSummary] = []
    databases: list[ExchangeMailboxDB] = []
    queues: list[ExchangeQueue] = []
    dag_name: str = ""
    total_queued: int = 0
    databases_mounted: int = 0
    databases_dismounted: int = 0
    status: HealthStatus
    method: str = "remote_ps"          # remote_ps | unconfigured | error


# ── FortiGate ─────────────────────────────────────────────────────────────────

class FortiGateInterface(BaseModel):
    name: str
    alias: Optional[str] = None
    ip: Optional[str] = None
    status: str = "unknown"        # up | down | unknown
    rx_bytes: Optional[int] = None
    tx_bytes: Optional[int] = None
    speed: Optional[int] = None    # link speed Mbps


class FortiGateVPNTunnel(BaseModel):
    name: str
    remote_ip: Optional[str] = None
    status: str = "down"           # up | down
    incoming_bytes: Optional[int] = None
    outgoing_bytes: Optional[int] = None


class FortiGateSSLSession(BaseModel):
    username: str
    source_ip: Optional[str] = None
    duration_sec: Optional[int] = None
    rx_bytes: Optional[int] = None
    tx_bytes: Optional[int] = None


class FortiGateSummary(BaseModel):
    hostname: str
    firmware_version: str = ""
    serial: Optional[str] = None
    cpu_pct: Optional[float] = None
    mem_pct: Optional[float] = None
    session_count: Optional[int] = None
    ha_mode: str = "standalone"
    ha_peers: int = 0
    ipsec_tunnels_total: int = 0
    ipsec_tunnels_up: int = 0
    ipsec_tunnels_down: int = 0
    ssl_sessions: int = 0
    interfaces: list[FortiGateInterface] = []
    vpn_tunnels: list[FortiGateVPNTunnel] = []
    ssl_vpn_sessions: list[FortiGateSSLSession] = []
    status: HealthStatus
    vdom: str = "root"


# ── vCenter Events ───────────────────────────────────────────────────────────

class VCenterEvent(BaseModel):
    event_id: int
    event_type: str       # short class name, e.g. "VmPoweredOnEvent"
    created_time: str     # ISO-8601 UTC
    message: str
    vm_name: Optional[str] = None
    host_name: Optional[str] = None
    user_name: Optional[str] = None


# ── SIEM Integration ─────────────────────────────────────────────────────────

class SiemEvent(BaseModel):
    """Normalised event contract shared between GlassPlane and the SIEM project."""
    id: str               # UUID4 — deduplicated on both sides
    ts: str               # ISO-8601 UTC timestamp
    source: str           # connector name: "fortigate" | "exchange" | "ilo" | "veeam" | …
    severity: str         # info | low | medium | high | critical
    category: str         # auth | network | system | backup | storage | health
    event_type: str       # machine tag e.g. "vpn_tunnel_down", "db_dismounted"
    message: str          # human-readable one-liner
    host: str   = ""      # originating device hostname or IP
    src_ip: str = ""
    dst_ip: str = ""
    user: str   = ""
    raw: dict   = {}      # connector-specific context for SIEM enrichment


# ── Unified Glassplane ────────────────────────────────────────────────────────

class GlassplaneSummary(BaseModel):
    vcenter: Optional[VCenterSummary] = None
    aruba: Optional[ArubaSummary] = None
    alletra: Optional[AlletraSummary] = None
    veeam: Optional[VeeamSummary] = None
    overall_status: HealthStatus
    optimization_score: int        # 0-100
    top_recommendations: list[str]
