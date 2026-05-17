"""
Background snapshot loop. Collects live metrics from every configured
connector and writes one row to SQLite. Missing connectors leave NULLs;
they don't block the snapshot.
"""

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import get_settings
from history.store import write, prune
from routers.api import _optimization_score
from siem import bridge as siem_bridge
from siem import store as siem_store

logger = logging.getLogger(__name__)


def _collect() -> dict:
    s = get_settings()
    row: dict = {c: None for c in [
        "ts", "score",
        "vc_total", "vc_idle", "vc_oversized", "vc_wasted_cpu", "vc_wasted_ram",
        "vc_powered_on", "vc_cpu_max_pct", "vc_ram_max_pct",
        "ar_switches", "ar_unused", "ar_unused_pct",
        "al_util_pct", "al_used_tb", "al_free_tb", "al_iops", "al_latency", "al_efficiency",
        "veeam_jobs", "veeam_failed", "veeam_protected", "veeam_unprotected", "veeam_repo_pct",
        "ilo_host_count", "ilo_total_power_w", "ilo_error_count",
        "rds_host_count", "rds_active", "rds_disconnected",
        "fgt_cpu_pct", "fgt_sessions", "fgt_ipsec_up", "fgt_ssl_users",
        "ex_db_count", "ex_db_mounted", "ex_queue_total",
        "faz_devices", "faz_devices_up", "faz_disk_pct",
    ]}
    row["ts"] = time.time()

    def _fetch_vcenter():
        from connectors.vcenter import fetch_vcenter_summary
        return fetch_vcenter_summary()

    def _fetch_aruba():
        from connectors.aruba import fetch_aruba_summary
        return fetch_aruba_summary()

    def _fetch_alletra():
        from connectors.alletra import fetch_alletra_summary
        return fetch_alletra_summary()

    def _fetch_veeam():
        from connectors.veeam import fetch_veeam_summary
        return fetch_veeam_summary()

    def _fetch_ilo():
        from connectors.ilo import fetch_ilo_summary
        return fetch_ilo_summary()

    def _fetch_rds():
        from connectors.rds import fetch_rds_summary
        return fetch_rds_summary()

    def _fetch_fortigate():
        from connectors.fortigate import fetch_fortigate_summary
        return fetch_fortigate_summary()

    def _fetch_exchange():
        from connectors.exchange import fetch_exchange_summary
        return fetch_exchange_summary()

    def _fetch_fortianalyzer():
        from connectors.fortianalyzer import fetch_fortianalyzer_summary
        return fetch_fortianalyzer_summary()

    tasks = {}
    with ThreadPoolExecutor(max_workers=9) as ex:
        if s.vcenter_host:
            tasks["vcenter"] = ex.submit(_fetch_vcenter)
        if s.aruba_client_id or s.aruba_access_token:
            tasks["aruba"] = ex.submit(_fetch_aruba)
        if s.alletra_host:
            tasks["alletra"] = ex.submit(_fetch_alletra)
        if s.veeam_host:
            tasks["veeam"] = ex.submit(_fetch_veeam)
        if s.ilo_hosts:
            tasks["ilo"] = ex.submit(_fetch_ilo)
        if s.rds_broker or s.rds_hosts:
            tasks["rds"] = ex.submit(_fetch_rds)
        if s.fortigate_host and s.fortigate_token:
            tasks["fortigate"] = ex.submit(_fetch_fortigate)
        if s.exchange_server and s.exchange_user:
            tasks["exchange"] = ex.submit(_fetch_exchange)
        if s.fortianalyzer_host and s.fortianalyzer_user:
            tasks["fortianalyzer"] = ex.submit(_fetch_fortianalyzer)

    vc = ar = al = veeam = ilo_result = fgt_result = ex_result = None

    if "vcenter" in tasks:
        try:
            vc = tasks["vcenter"].result()
            row.update(vc_total=vc.total_vms, vc_idle=vc.idle_vms,
                       vc_oversized=vc.oversized_vms,
                       vc_wasted_cpu=vc.wasted_cpu_ghz, vc_wasted_ram=vc.wasted_ram_gb,
                       vc_powered_on=vc.powered_on)
            if vc.clusters:
                row["vc_cpu_max_pct"] = max((c.cpu_util_pct for c in vc.clusters if c.cpu_util_pct is not None), default=None)
                row["vc_ram_max_pct"] = max((c.ram_util_pct for c in vc.clusters if c.ram_util_pct is not None), default=None)
        except Exception as e:
            logger.warning(f"Snapshot vCenter: {e}")

    if "aruba" in tasks:
        try:
            ar = tasks["aruba"].result()
            row.update(ar_switches=ar.switch_count, ar_unused=ar.unused_ports,
                       ar_unused_pct=ar.unused_port_pct)
        except Exception as e:
            logger.warning(f"Snapshot Aruba: {e}")

    if "alletra" in tasks:
        try:
            al = tasks["alletra"].result()
            row.update(al_util_pct=al.util_pct, al_used_tb=al.used_tb, al_free_tb=al.free_tb,
                       al_iops=al.iops, al_latency=al.latency_ms,
                       al_efficiency=al.total_efficiency_ratio)
        except Exception as e:
            logger.warning(f"Snapshot Alletra: {e}")

    if "veeam" in tasks:
        try:
            veeam = tasks["veeam"].result()
            row.update(veeam_jobs=veeam.job_count, veeam_failed=veeam.failed_jobs,
                       veeam_protected=veeam.protected_vms,
                       veeam_unprotected=veeam.unprotected_vms,
                       veeam_repo_pct=veeam.repo_util_pct)
        except Exception as e:
            logger.warning(f"Snapshot Veeam: {e}")

    if "ilo" in tasks:
        try:
            ilo_result = tasks["ilo"].result()
            row.update(
                ilo_host_count=ilo_result.host_count,
                ilo_total_power_w=ilo_result.total_power_watts,
                ilo_error_count=ilo_result.error_count,
            )
        except Exception as e:
            logger.warning(f"Snapshot iLO: {e}")

    if "rds" in tasks:
        try:
            rds = tasks["rds"].result()
            row.update(
                rds_host_count=rds.host_count,
                rds_active=rds.total_active,
                rds_disconnected=rds.total_disconnected,
            )
        except Exception as e:
            logger.warning(f"Snapshot RDS: {e}")

    if "fortigate" in tasks:
        try:
            fgt_result = tasks["fortigate"].result()
            row.update(
                fgt_cpu_pct=fgt_result.cpu_pct,
                fgt_sessions=fgt_result.session_count,
                fgt_ipsec_up=fgt_result.ipsec_tunnels_up,
                fgt_ssl_users=fgt_result.ssl_sessions,
            )
        except Exception as e:
            logger.warning(f"Snapshot FortiGate: {e}")

    if "exchange" in tasks:
        try:
            ex_result = tasks["exchange"].result()
            row.update(
                ex_db_count=len(ex_result.databases),
                ex_db_mounted=ex_result.databases_mounted,
                ex_queue_total=ex_result.total_queued,
            )
        except Exception as e:
            logger.warning(f"Snapshot Exchange: {e}")

    if "fortianalyzer" in tasks:
        try:
            faz = tasks["fortianalyzer"].result()
            row.update(
                faz_devices=faz.device_count,
                faz_devices_up=faz.devices_up,
                faz_disk_pct=faz.disk_pct,
            )
        except Exception as e:
            logger.warning(f"Snapshot FortiAnalyzer: {e}")

    try:
        score, _ = _optimization_score(vc, ar, al, veeam)
        row["score"] = score
    except Exception as e:
        logger.warning(f"Snapshot score: {e}")

    # ── SIEM bridge — emit state-change events to local event store ────────────
    try:
        siem_events = (
            siem_bridge.from_fortigate(fgt_result) +
            siem_bridge.from_exchange(ex_result) +
            siem_bridge.from_ilo(ilo_result) +
            siem_bridge.from_veeam(veeam)
        )
        if siem_events:
            siem_store.store(s.db_path, siem_events)
            logger.debug("SIEM bridge: %d event(s) stored", len(siem_events))
    except Exception as e:
        logger.warning(f"SIEM bridge: {e}")

    return row


async def snapshot_loop() -> None:
    logger.info("Snapshot loop started")
    while True:
        try:
            s = get_settings()
            await asyncio.sleep(s.snapshot_interval_seconds)
            loop = asyncio.get_running_loop()
            row = await loop.run_in_executor(None, _collect)
            write(s.db_path, row)
            prune(s.db_path, s.snapshot_retention_days)
            logger.debug(f"Snapshot written ts={row['ts']:.0f}")
        except asyncio.CancelledError:
            logger.info("Snapshot loop stopped")
            raise
        except Exception as e:
            logger.error(f"Snapshot loop error: {e}")
