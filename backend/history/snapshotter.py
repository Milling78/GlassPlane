"""
Background snapshot loop. Collects live metrics from every configured
connector and writes one row to SQLite. Missing connectors leave NULLs;
they don't block the snapshot.
"""

import asyncio
import logging
import time

from config import get_settings
from history.store import write, prune

logger = logging.getLogger(__name__)


def _collect() -> dict:
    s = get_settings()
    row: dict = {c: None for c in [
        "ts", "score",
        "vc_total", "vc_idle", "vc_oversized", "vc_wasted_cpu", "vc_wasted_ram",
        "ar_switches", "ar_unused", "ar_unused_pct",
        "al_util_pct", "al_used_tb", "al_free_tb", "al_iops", "al_latency", "al_efficiency",
        "veeam_jobs", "veeam_failed", "veeam_protected", "veeam_unprotected", "veeam_repo_pct",
    ]}
    row["ts"] = time.time()

    if s.vcenter_host:
        try:
            from connectors.vcenter import fetch_vcenter_summary
            vc = fetch_vcenter_summary()
            row.update(vc_total=vc.total_vms, vc_idle=vc.idle_vms,
                       vc_oversized=vc.oversized_vms,
                       vc_wasted_cpu=vc.wasted_cpu_ghz, vc_wasted_ram=vc.wasted_ram_gb)
        except Exception as e:
            logger.warning(f"Snapshot vCenter: {e}")

    if s.aruba_client_id or s.aruba_access_token:
        try:
            from connectors.aruba import fetch_aruba_summary
            ar = fetch_aruba_summary()
            row.update(ar_switches=ar.switch_count, ar_unused=ar.unused_ports,
                       ar_unused_pct=ar.unused_port_pct)
        except Exception as e:
            logger.warning(f"Snapshot Aruba: {e}")

    if s.alletra_host:
        try:
            from connectors.alletra import fetch_alletra_summary
            al = fetch_alletra_summary()
            row.update(al_util_pct=al.util_pct, al_used_tb=al.used_tb, al_free_tb=al.free_tb,
                       al_iops=al.iops, al_latency=al.latency_ms,
                       al_efficiency=al.total_efficiency_ratio)
        except Exception as e:
            logger.warning(f"Snapshot Alletra: {e}")

    if s.veeam_host:
        try:
            from connectors.veeam import fetch_veeam_summary
            veeam = fetch_veeam_summary()
            row.update(veeam_jobs=veeam.job_count, veeam_failed=veeam.failed_jobs,
                       veeam_protected=veeam.protected_vms,
                       veeam_unprotected=veeam.unprotected_vms,
                       veeam_repo_pct=veeam.repo_util_pct)
        except Exception as e:
            logger.warning(f"Snapshot Veeam: {e}")

    return row


async def snapshot_loop() -> None:
    logger.info("Snapshot loop started")
    while True:
        try:
            s = get_settings()
            await asyncio.sleep(s.snapshot_interval_seconds)
            loop = asyncio.get_event_loop()
            row = await loop.run_in_executor(None, _collect)
            write(s.db_path, row)
            prune(s.db_path, s.snapshot_retention_days)
            logger.debug(f"Snapshot written ts={row['ts']:.0f}")
        except asyncio.CancelledError:
            logger.info("Snapshot loop stopped")
            raise
        except Exception as e:
            logger.error(f"Snapshot loop error: {e}")
