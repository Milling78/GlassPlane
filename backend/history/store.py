"""
SQLite-backed snapshot store.
One row per collection cycle; all columns nullable so partial snapshots
(one connector down) don't block the rest.
"""

import sqlite3
import threading
import time
from pathlib import Path

_lock = threading.Lock()
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
    ilo_error_count   INTEGER
);
CREATE INDEX IF NOT EXISTS snapshots_ts ON snapshots(ts);
"""

_COLUMNS = [
    "ts", "score",
    "vc_total", "vc_idle", "vc_oversized", "vc_wasted_cpu", "vc_wasted_ram",
    "ar_switches", "ar_unused", "ar_unused_pct",
    "al_util_pct", "al_used_tb", "al_free_tb", "al_iops", "al_latency", "al_efficiency",
    "veeam_jobs", "veeam_failed", "veeam_protected", "veeam_unprotected", "veeam_repo_pct",
    "ilo_host_count", "ilo_total_power_w", "ilo_error_count",
]


def _open(db_path: str) -> sqlite3.Connection:
    global _conn
    if _conn is None:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(db_path, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(_DDL)
        _conn.commit()
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
        _open(db_path).execute("DELETE FROM snapshots WHERE ts < ?", (cutoff,))
        _conn.commit()


def read(db_path: str, hours: float) -> list[dict]:
    since = time.time() - hours * 3600
    with _lock:
        cur = _open(db_path).execute(
            "SELECT * FROM snapshots WHERE ts >= ? ORDER BY ts ASC", (since,)
        )
        return [dict(r) for r in cur.fetchall()]
