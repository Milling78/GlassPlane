"""
Veeam Backup & Replication connector.
Uses the Veeam REST API v1 (port 9419).
Reference: https://helpcenter.veeam.com/docs/backup/vbr_rest/overview.html
"""

import logging

import httpx

from config import get_settings
from models.schemas import BackupJob, Repository, VeeamSummary, HealthStatus

logger = logging.getLogger(__name__)


def _base_url(settings) -> str:
    return f"https://{settings.veeam_host}:{settings.veeam_port}/api/v1"


def _get_token(client: httpx.Client, settings) -> str:
    resp = client.post(
        f"{_base_url(settings)}/token",
        data={
            "grant_type": "password",
            "username": settings.veeam_user,
            "password": settings.veeam_password,
            "use_short_term_refresh": "true",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded", "x-api-version": "1.1-rev2"}
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "x-api-version": "1.1-rev2",
    }


def _fetch_jobs(client: httpx.Client, settings, token: str) -> list[dict]:
    resp = client.get(
        f"{_base_url(settings)}/jobs",
        headers=_headers(token),
        params={"limit": 500, "offset": 0}
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def _fetch_job_states(client: httpx.Client, settings, token: str) -> dict:
    """Returns a dict of job_id -> last session state."""
    resp = client.get(
        f"{_base_url(settings)}/jobStates",
        headers=_headers(token),
        params={"limit": 500}
    )
    resp.raise_for_status()
    return {s["jobId"]: s for s in resp.json().get("data", [])}


def _fetch_repositories(client: httpx.Client, settings, token: str) -> list[dict]:
    resp = client.get(
        f"{_base_url(settings)}/backupInfrastructure/repositories",
        headers=_headers(token),
        params={"limit": 100}
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def _fetch_protected_vms(client: httpx.Client, settings, token: str) -> tuple[int, int]:
    """Returns (protected_count, unprotected_count)."""
    resp = client.get(
        f"{_base_url(settings)}/protectedVms",
        headers=_headers(token),
        params={"limit": 1, "offset": 0}
    )
    protected = resp.json().get("pagination", {}).get("total", 0) if resp.is_success else 0

    resp2 = client.get(
        f"{_base_url(settings)}/inventory/vms",
        headers=_headers(token),
        params={"limit": 1, "offset": 0}
    )
    total = resp2.json().get("pagination", {}).get("total", 0) if resp2.is_success else 0
    return protected, max(0, total - protected)


def _gb(bytes_val) -> float:
    return round(float(bytes_val or 0) / (1024 ** 3), 2)


def _map_result(result: str) -> str:
    mapping = {
        "Success": "Success",
        "Warning": "Warning",
        "Failed": "Failed",
        "None": "None",
        "Running": "Running",
    }
    return mapping.get(result, result)


def fetch_veeam_summary() -> VeeamSummary:
    settings = get_settings()

    with httpx.Client(verify=False, timeout=30) as client:
        token = _get_token(client, settings)

        raw_jobs = _fetch_jobs(client, settings, token)
        job_states = _fetch_job_states(client, settings, token)
        raw_repos = _fetch_repositories(client, settings, token)
        protected_vms, unprotected_vms = _fetch_protected_vms(client, settings, token)

        jobs: list[BackupJob] = []
        for j in raw_jobs:
            jid = j.get("id", "")
            state = job_states.get(jid, {})
            last_session = state.get("lastResult", "None")

            jobs.append(BackupJob(
                job_id=jid,
                name=j.get("name", ""),
                type=j.get("type", "Backup"),
                status=_map_result(last_session),
                last_run=state.get("lastSessionEndTime"),
                duration_seconds=state.get("lastSessionDuration"),
                data_size_gb=_gb(state.get("lastSessionDataSize", 0)),
                dedupe_ratio=float(state.get("lastSessionDedupeRatio", 1.0) or 1.0),
                compress_ratio=float(state.get("lastSessionCompressRatio", 1.0) or 1.0),
                vms_protected=int(state.get("objectsCount", 0))
            ))

        repos: list[Repository] = []
        total_cap = 0.0
        total_used = 0.0
        for r in raw_repos:
            cap = _gb(r.get("capacityGB", 0) * 1024 ** 3) if r.get("capacityGB") else _gb(r.get("capacity", 0))
            used = _gb(r.get("usedSpaceGB", 0) * 1024 ** 3) if r.get("usedSpaceGB") else _gb(r.get("usedSpace", 0))
            free = cap - used
            util = round(used / cap * 100, 1) if cap else 0
            total_cap += cap
            total_used += used

            repos.append(Repository(
                repo_id=r.get("id", ""),
                name=r.get("name", ""),
                host=r.get("hostName", ""),
                capacity_gb=cap,
                used_gb=used,
                free_gb=round(free, 2),
                util_pct=util,
                status=HealthStatus.CRITICAL if util > 90 else (
                    HealthStatus.WARNING if util > 75 else HealthStatus.OK
                )
            ))

        failed = sum(1 for j in jobs if j.status == "Failed")
        warnings = sum(1 for j in jobs if j.status == "Warning")
        success = sum(1 for j in jobs if j.status == "Success")
        running = sum(1 for j in jobs if j.status == "Running")

        overall = HealthStatus.CRITICAL if failed > 0 else (
            HealthStatus.WARNING if warnings > 0 else HealthStatus.OK
        )

        return VeeamSummary(
            job_count=len(jobs),
            protected_vms=protected_vms,
            unprotected_vms=unprotected_vms,
            success_jobs=success,
            warning_jobs=warnings,
            failed_jobs=failed,
            running_jobs=running,
            jobs=jobs,
            repositories=repos,
            total_repo_capacity_gb=round(total_cap, 1),
            total_repo_used_gb=round(total_used, 1),
            repo_util_pct=round(total_used / total_cap * 100, 1) if total_cap else 0,
            status=overall
        )
