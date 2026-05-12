"""
Background alert checker.

Evaluates connector data against configurable thresholds every
ALERT_INTERVAL_SECONDS. Fires the webhook only on state *transitions*
(OK → breach = alert, breach → OK = resolved) to prevent storms.
"""

import asyncio
import logging
from datetime import datetime, timezone

from config import get_settings
from alerting.webhook import send_webhook

logger = logging.getLogger(__name__)

_active: set[str] = set()          # currently-breaching alert keys
_history: list[dict] = []          # ring buffer of fired events
_MAX_HISTORY = 200


def get_active() -> list[str]:
    return list(_active)


def get_history() -> list[dict]:
    return list(reversed(_history))


def _push_history(event: str, alerts: list[dict]) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    for a in alerts:
        _history.append({"event": event, **a, "timestamp": ts})
    if len(_history) > _MAX_HISTORY:
        del _history[:-_MAX_HISTORY]


# ── Threshold evaluation ──────────────────────────────────────────────────────

def _evaluate(s) -> list[dict]:
    breaches: list[dict] = []

    if s.vcenter_host:
        try:
            from connectors.vcenter import fetch_vcenter_summary
            vc = fetch_vcenter_summary()
            if vc.idle_vms >= s.alert_vcenter_idle_vms:
                breaches.append({"key": "vc_idle", "system": "vCenter",
                    "message": f"{vc.idle_vms} idle VM(s) — ~{vc.wasted_ram_gb:.0f} GB / {vc.wasted_cpu_ghz:.1f} GHz wasted",
                    "severity": "warning"})
            if vc.oversized_vms >= s.alert_vcenter_oversized_vms:
                breaches.append({"key": "vc_oversized", "system": "vCenter",
                    "message": f"{vc.oversized_vms} oversized VM(s) — right-size to recover capacity",
                    "severity": "warning"})
            for cl in vc.clusters:
                if cl.cpu_util_pct < s.alert_vcenter_cluster_cpu_low_pct:
                    breaches.append({"key": f"vc_cluster_cpu_{cl.name}", "system": "vCenter",
                        "message": f"Cluster '{cl.name}' CPU at {cl.cpu_util_pct}% (threshold < {s.alert_vcenter_cluster_cpu_low_pct}%)",
                        "severity": "warning"})
        except Exception as e:
            logger.warning(f"Alert check — vCenter: {e}")

    if s.aruba_client_id or s.aruba_access_token:
        try:
            from connectors.aruba import fetch_aruba_summary
            aruba = fetch_aruba_summary()
            if aruba.unused_port_pct > s.alert_aruba_unused_port_pct:
                breaches.append({"key": "aruba_unused_ports", "system": "Aruba Central",
                    "message": f"{aruba.unused_ports} ports ({aruba.unused_port_pct:.0f}%) unused (threshold > {s.alert_aruba_unused_port_pct}%)",
                    "severity": "warning"})
        except Exception as e:
            logger.warning(f"Alert check — Aruba: {e}")

    if s.alletra_host:
        try:
            from connectors.alletra import fetch_alletra_summary
            al = fetch_alletra_summary()
            if al.util_pct > s.alert_alletra_util_high_pct:
                breaches.append({"key": "alletra_high", "system": "HPE Alletra",
                    "message": f"Storage at {al.util_pct}% (threshold > {s.alert_alletra_util_high_pct}%)",
                    "severity": "critical"})
            if al.util_pct < s.alert_alletra_util_low_pct:
                breaches.append({"key": "alletra_low", "system": "HPE Alletra",
                    "message": f"Storage at only {al.util_pct}% — over-provisioned",
                    "severity": "info"})
            if al.total_efficiency_ratio < s.alert_alletra_efficiency_min:
                breaches.append({"key": "alletra_efficiency", "system": "HPE Alletra",
                    "message": f"Efficiency {al.total_efficiency_ratio:.2f}:1 (threshold < {s.alert_alletra_efficiency_min}:1)",
                    "severity": "warning"})
        except Exception as e:
            logger.warning(f"Alert check — Alletra: {e}")

    if s.veeam_host:
        try:
            from connectors.veeam import fetch_veeam_summary
            veeam = fetch_veeam_summary()
            if veeam.failed_jobs >= s.alert_veeam_failed_jobs:
                breaches.append({"key": "veeam_failed", "system": "Veeam",
                    "message": f"{veeam.failed_jobs} backup job(s) failing — data protection at risk",
                    "severity": "critical"})
            if veeam.unprotected_vms >= s.alert_veeam_unprotected_vms:
                breaches.append({"key": "veeam_unprotected", "system": "Veeam",
                    "message": f"{veeam.unprotected_vms} VM(s) with no backup coverage",
                    "severity": "warning"})
            if veeam.repo_util_pct > s.alert_veeam_repo_util_pct:
                breaches.append({"key": "veeam_repo", "system": "Veeam",
                    "message": f"Backup repos at {veeam.repo_util_pct}% (threshold > {s.alert_veeam_repo_util_pct}%)",
                    "severity": "warning"})
        except Exception as e:
            logger.warning(f"Alert check — Veeam: {e}")

    return breaches


# ── State machine ─────────────────────────────────────────────────────────────

def run_check() -> None:
    global _active
    s = get_settings()

    breaches = _evaluate(s)
    breach_keys = {b["key"] for b in breaches}

    new_alerts    = [b for b in breaches if b["key"] not in _active]
    resolved_keys = _active - breach_keys

    if new_alerts:
        logger.info(f"Alert breach: {[b['key'] for b in new_alerts]}")
        _push_history("alert", new_alerts)
        if s.webhook_url:
            try:
                send_webhook(s.webhook_url, s.webhook_format, new_alerts, event="alert")
            except Exception as e:
                logger.error(f"Webhook send failed: {e}")

    if resolved_keys:
        resolved = [{"key": k, "system": k.split("_")[0].title(),
                     "message": "Condition resolved", "severity": "ok"}
                    for k in resolved_keys]
        logger.info(f"Alert resolved: {list(resolved_keys)}")
        _push_history("resolved", resolved)
        if s.webhook_url:
            try:
                send_webhook(s.webhook_url, s.webhook_format, resolved, event="resolved")
            except Exception as e:
                logger.error(f"Resolved webhook send failed: {e}")

    _active = breach_keys


# ── Background loop ───────────────────────────────────────────────────────────

async def alert_loop() -> None:
    logger.info("Alert loop started")
    while True:
        try:
            await asyncio.sleep(get_settings().alert_interval_seconds)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, run_check)
        except asyncio.CancelledError:
            logger.info("Alert loop stopped")
            raise
        except Exception as e:
            logger.error(f"Alert loop error: {e}")
