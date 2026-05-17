"""
SQLite-backed snapshot store.
One row per collection cycle; all columns nullable so partial snapshots
(one connector down) don't block the rest.
"""

import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

_lock      = threading.Lock()
_init_lock = threading.Lock()   # guards _conn initialization only
_conn: sqlite3.Connection | None = None

_DDL = """
CREATE TABLE IF NOT EXISTS snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            REAL    NOT NULL,
    score         INTEGER,
    vc_total      INTEGER,
    vc_idle       INTEGER,
    vc_oversized  INTEGER,
    vc_wasted_cpu REAL,
    vc_wasted_ram REAL,
    ar_switches   INTEGER,
    ar_unused     INTEGER,
    ar_unused_pct REAL,
    al_util_pct   REAL,
    al_used_tb    REAL,
    al_free_tb    REAL,
    al_iops       INTEGER,
    al_latency    REAL,
    al_efficiency REAL,
    veeam_jobs    INTEGER,
    veeam_failed  INTEGER,
    veeam_protected   INTEGER,
    veeam_unprotected INTEGER,
    veeam_repo_pct    REAL,
    ilo_host_count    INTEGER,
    ilo_total_power_w REAL,
    ilo_error_count   INTEGER,
    rds_host_count    INTEGER,
    rds_active        INTEGER,
    rds_disconnected  INTEGER,
    fgt_cpu_pct       REAL,
    fgt_sessions      INTEGER,
    fgt_ipsec_up      INTEGER,
    fgt_ssl_users     INTEGER,
    ex_db_count       INTEGER,
    ex_db_mounted     INTEGER,
    ex_queue_total    INTEGER,
    faz_devices       INTEGER,
    faz_devices_up    INTEGER,
    faz_disk_pct      REAL
);
CREATE INDEX IF NOT EXISTS snapshots_ts ON snapshots(ts);
"""

_COLUMNS = [
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
]

# Columns added after initial release — migrated on first open
_MIGRATIONS = [
    ("vc_powered_on",   "INTEGER"),
    ("vc_cpu_max_pct",  "REAL"),
    ("vc_ram_max_pct",  "REAL"),
    ("rds_host_count",  "INTEGER"),
    ("rds_active",      "INTEGER"),
    ("rds_disconnected","INTEGER"),
    ("fgt_cpu_pct",     "REAL"),
    ("fgt_sessions",    "INTEGER"),
    ("fgt_ipsec_up",    "INTEGER"),
    ("fgt_ssl_users",   "INTEGER"),
    ("ex_db_count",     "INTEGER"),
    ("ex_db_mounted",   "INTEGER"),
    ("ex_queue_total",  "INTEGER"),
    ("faz_devices",     "INTEGER"),
    ("faz_devices_up",  "INTEGER"),
    ("faz_disk_pct",    "REAL"),
]


_VM_PERF_DDL = """
CREATE TABLE IF NOT EXISTS vm_perf (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       REAL    NOT NULL,
    vm_id    TEXT    NOT NULL,
    vm_name  TEXT    NOT NULL,
    cluster  TEXT    NOT NULL DEFAULT '',
    host     TEXT    NOT NULL DEFAULT '',
    cpu_pct  REAL,
    ram_pct  REAL
);
CREATE INDEX IF NOT EXISTS vm_perf_vm_ts ON vm_perf(vm_id, ts);
CREATE INDEX IF NOT EXISTS vm_perf_ts    ON vm_perf(ts);
"""


def _open(db_path: str) -> sqlite3.Connection:
    global _conn
    if _conn is None:
        with _init_lock:
            if _conn is None:
                Path(db_path).parent.mkdir(parents=True, exist_ok=True)
                conn = sqlite3.connect(db_path, check_same_thread=False)
                conn.row_factory = sqlite3.Row
                conn.executescript(_DDL)
                conn.executescript(_VM_PERF_DDL)
                for col, dtype in _MIGRATIONS:
                    try:
                        conn.execute(f"ALTER TABLE snapshots ADD COLUMN {col} {dtype}")
                    except sqlite3.OperationalError:
                        pass  # column already exists
                conn.commit()
                _conn = conn  # assign last so other threads never see a half-init connection
    return _conn


def write(db_path: str, row: dict) -> None:
    placeholders = ", ".join(f":{c}" for c in _COLUMNS)
    cols = ", ".join(_COLUMNS)
    with _lock:
        conn = _open(db_path)
        conn.execute(f"INSERT INTO snapshots ({cols}) VALUES ({placeholders})", row)
        conn.commit()


def prune(db_path: str, retention_days: int) -> None:
    cutoff = time.time() - retention_days * 86400
    with _lock:
        conn = _open(db_path)
        conn.execute("DELETE FROM snapshots WHERE ts < ?", (cutoff,))
        conn.commit()


def read(db_path: str, hours: float) -> list[dict]:
    since = time.time() - hours * 3600
    with _lock:
        cur = _open(db_path).execute(
            "SELECT * FROM snapshots WHERE ts >= ? ORDER BY ts ASC", (since,)
        )
        return [dict(r) for r in cur.fetchall()]


# ── Per-VM performance (surge calculator) ─────────────────────────────────────

def write_vm_perf(db_path: str, rows: list[dict]) -> None:
    """Batch-insert VM CPU/RAM samples. Each row: ts, vm_id, vm_name, cluster, host, cpu_pct, ram_pct."""
    if not rows:
        return
    with _lock:
        conn = _open(db_path)
        conn.executemany(
            "INSERT INTO vm_perf (ts, vm_id, vm_name, cluster, host, cpu_pct, ram_pct) "
            "VALUES (:ts, :vm_id, :vm_name, :cluster, :host, :cpu_pct, :ram_pct)",
            rows,
        )
        conn.commit()


def read_vm_perf(
    db_path: str,
    lookback_hours: float,
    metric: str,
    vm_name_filter: str | None = None,
) -> dict[str, dict]:
    """
    Return {vm_id: {name, cluster, host, series: [float], timestamps: [datetime]}}
    for all VMs that have data in the lookback window for the requested metric.
    """
    since = time.time() - lookback_hours * 3600
    col   = "cpu_pct" if metric == "cpu" else "ram_pct"
    sql   = (
        f"SELECT vm_id, vm_name, cluster, host, ts, {col} "
        f"FROM vm_perf WHERE ts >= ? AND {col} IS NOT NULL "
    )
    params: list = [since]
    if vm_name_filter:
        sql += "AND lower(vm_name) LIKE ? "
        params.append(f"%{vm_name_filter.lower()}%")
    sql += "ORDER BY vm_id, ts ASC"

    with _lock:
        rows = [dict(r) for r in _open(db_path).execute(sql, params).fetchall()]

    result: dict[str, dict] = {}
    for row in rows:
        vid = row["vm_id"]
        if vid not in result:
            result[vid] = {
                "name":       row["vm_name"],
                "cluster":    row["cluster"],
                "host":       row["host"],
                "series":     [],
                "timestamps": [],
            }
        result[vid]["series"].append(row[col])
        result[vid]["timestamps"].append(
            datetime.fromtimestamp(row["ts"], tz=timezone.utc).replace(tzinfo=None)
        )
    return result


def prune_vm_perf(db_path: str, retention_days: int) -> None:
    cutoff = time.time() - retention_days * 86400
    with _lock:
        conn = _open(db_path)
        conn.execute("DELETE FROM vm_perf WHERE ts < ?", (cutoff,))
        conn.commit()
