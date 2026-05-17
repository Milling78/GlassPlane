import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

# Electron main passes GLASSPLANE_ENV_FILE pointing to %APPDATA%\Infra Glassplane\.env
# so the packaged binary stores config in the right place for all users on the machine.
_ENV_FILE = os.environ.get("GLASSPLANE_ENV_FILE", ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    # vCenter
    vcenter_host: str = ""
    vcenter_user: str = ""
    vcenter_password: str = ""
    vcenter_port: int = 443
    vcenter_ssl_verify: bool = False

    # Aruba Central
    aruba_central_base_url: str = "https://apigw-prod2.central.arubanetworks.com"
    aruba_client_id: str = ""
    aruba_client_secret: str = ""
    aruba_customer_id: str = ""
    aruba_access_token: str = ""

    # Alletra 6000 / Nimble Storage  (Nimble REST API, default port 5392)
    alletra_host: str = ""
    alletra_user: str = ""
    alletra_password: str = ""
    alletra_port: int = 5392

    # Veeam
    veeam_host: str = ""
    veeam_user: str = ""
    veeam_password: str = ""
    veeam_port: int = 9419

    # App
    cache_ttl_seconds: int = 60
    log_level: str = "INFO"
    api_key: str = ""
    # "null" covers Electron file:// origin; add your server URL for remote access
    # e.g. ALLOWED_ORIGINS=https://glassplane.corp.local
    allowed_origins: str = "null,http://localhost:5173,http://localhost:8000"
    # Path to React dist/ for standalone server mode; auto-detected when empty
    frontend_dist: str = ""

    # Alerting
    webhook_url: str = ""
    webhook_format: str = "teams"       # teams | slack | generic
    alert_interval_seconds: int = 300   # 5 minutes

    # vCenter thresholds
    alert_vcenter_idle_vms: int = 1
    alert_vcenter_oversized_vms: int = 5
    alert_vcenter_cluster_cpu_low_pct: float = 30.0

    # Aruba thresholds
    alert_aruba_unused_port_pct: float = 30.0

    # Alletra thresholds
    alert_alletra_util_high_pct: float = 80.0
    alert_alletra_util_low_pct: float = 20.0
    alert_alletra_efficiency_min: float = 2.0

    # Veeam thresholds
    alert_veeam_failed_jobs: int = 1
    alert_veeam_unprotected_vms: int = 1
    alert_veeam_repo_util_pct: float = 80.0

    # Aruba wireless controller (ArubaOS Mobility Controller — standalone)
    aruba_wireless_host: str = ""
    aruba_wireless_user: str = ""
    aruba_wireless_password: str = ""
    aruba_wireless_port: int = 4343

    # Aruba direct (AOS-CX REST / SSH fallback)
    aruba_direct_hosts: str = ""     # comma-separated IPs or hostnames
    aruba_direct_user: str = ""
    aruba_direct_password: str = ""
    aruba_direct_port: int = 443     # HTTPS port for AOS-CX REST
    aruba_direct_ssh_port: int = 22  # SSH port for ProCurve fallback
    aruba_direct_ssl_verify: bool = False

    # HPE iLO / Redfish
    ilo_hosts: str = ""          # comma-separated hostnames/IPs
    ilo_user: str = ""
    ilo_password: str = ""
    ilo_port: int = 443
    ilo_ssl_verify: bool = False
    ilo_host_map: str = ""       # ilo_ip=esxi_name,... manual iLO→server mapping

    # iLO alert thresholds
    alert_ilo_power_cap_pct: float = 90.0   # alert when power > X% of cap
    alert_ilo_error_count: int = 1          # alert when IML errors >= this
    alert_ilo_iml_days: int = 90            # ignore IML entries older than this many days

    # DNS monitoring
    dns_servers: str = ""         # comma-separated DNS server IPs to poll
    dns_check_hosts: str = ""     # comma-separated hostnames to resolve
    dns_timeout: float = 5.0      # per-query timeout in seconds

    # KACE SMA service desk
    kace_host: str = ""
    kace_user: str = ""
    kace_password: str = ""
    kace_org: str = "Default"
    kace_port: int = 443
    kace_ssl_verify: bool = False
    kace_helpdesk_queue: str = "Helpdesk"       # queue name to pull as helpdesk feed
    kace_engineering_queue: str = "Engineering"  # queue name to pull as engineering feed
    kace_ticket_limit: int = 500                 # max open tickets to fetch per queue

    # Certificate monitoring
    cert_hosts: str = ""          # comma-separated host[:port] to check TLS certs
    cert_warn_days: int = 30      # warn when cert expires within this many days
    cert_crit_days: int = 14      # critical when cert expires within this many days
    cert_timeout: float = 10.0    # per-host connect timeout in seconds

    # Claude AI
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-4-6"

    # Historical snapshots
    snapshot_interval_seconds: int = 900   # 15 minutes
    snapshot_retention_days: int = 30
    db_path: str = "glassplane.db"

    # Per-VM CPU/RAM time-series (used by surge calculator)
    vm_perf_interval_seconds: int = 300    # collect one sample per VM every 5 minutes
    vm_perf_retention_days: int = 7        # keep 7 days of per-VM perf data

    # FortiAnalyzer
    fortianalyzer_host: str = ""
    fortianalyzer_user: str = ""
    fortianalyzer_password: str = ""
    fortianalyzer_port: int = 443
    fortianalyzer_ssl_verify: bool = False
    fortianalyzer_adom: str = "root"
    fortianalyzer_disk_warn_pct: float = 80.0
    fortianalyzer_disk_crit_pct: float = 90.0

    # MS Exchange
    exchange_server: str = ""
    exchange_user: str = ""
    exchange_password: str = ""
    exchange_domain: str = ""         # Windows domain (optional — prepended as DOMAIN\user)
    exchange_transport_warn_queue: int = 50    # warn when any queue exceeds this
    exchange_transport_crit_queue: int = 200   # critical when any queue exceeds this

    # FortiGate firewall
    fortigate_host: str = ""
    fortigate_token: str = ""          # REST API admin token (System > Administrators > REST API Admin)
    fortigate_port: int = 443
    fortigate_ssl_verify: bool = False
    fortigate_vdom: str = "root"
    fortigate_warn_cpu_pct: float = 70.0
    fortigate_crit_cpu_pct: float = 90.0

    # Terminal Server / RDS
    rds_broker: str = ""             # FQDN of RD Connection Broker (optional)
    rds_hosts: str = ""              # comma-separated RDSH hostnames (direct mode fallback)
    rds_warn_load_pct: float = 75.0  # host CPU % threshold for warning
    rds_crit_load_pct: float = 90.0  # host CPU % threshold for critical

    # SIEM integration
    siem_enabled: bool = False
    siem_push_url: str = ""          # SIEM project endpoint — GlassPlane POSTs events here
    siem_push_api_key: str = ""      # Bearer token for authenticating to the SIEM push endpoint
    siem_retain_days: int = 30       # days to keep events in the local siem_events.db store

    # Wall TV display mode
    tv_mode_enabled: bool = False
    tv_mode_resolution: str = "hd"         # hd | 4k
    tv_mode_refresh_seconds: int = 30


@lru_cache
def get_settings() -> Settings:
    return Settings()
