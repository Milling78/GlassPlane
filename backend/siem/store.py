"""
SQLite store for SIEM events — separate DB from the snapshot history.
Tracks whether each event has been forwarded to the push URL.
"""

import json
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_lock = threading.Lock()
_conn_cache: dict[str, sqlite3.Connection] = {}

_DDL = """
CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    ts          TEXT NOT NULL,
    source      TEXT NOT NULL,
    severity    TEXT NOT NULL,
    category    TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    message     TEXT NOT NULL,
    host        TEXT DEFAULT '',
    src_ip      TEXT DEFAULT '',
    dst_ip      TEXT DEFAULT '',
    user_field  TEXT DEFAULT '',
    raw         TEXT DEFAULT '{}',
    forwarded   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS evt_ts  ON events(ts);
CREATE INDEX IF NOT EXISTS evt_fwd ON events(forwarded);
CREATE INDEX IF NOT EXISTS evt_src ON events(source);
"""


def _siem_db_path(main_db: str) -> Path:
    p = Path(main_db)
    return p.parent / "siem_events.db"


def _open(main_db: str) -> sqlite3.Connection:
    path = str(_siem_db_path(main_db))
    if path not in _conn_cache:
        with _lock:
            if path not in _conn_cache:
                Path(path).parent.mkdir(parents=True, exist_ok=True)
                conn = sqlite3.connect(path, check_same_thread=False)
                conn.row_factory = sqlite3.Row
                conn.executescript(_DDL)
                conn.commit()
                _conn_cache[path] = conn
    return _conn_cache[path]


def store(main_db: str, events) -> None:
    if not events:
        return
    rows = [
        (
            e.id, e.ts, e.source, e.severity, e.category,
            e.event_type, e.message, e.host, e.src_ip, e.dst_ip,
            e.user, json.dumps(e.raw), 0,
        )
        for e in events
    ]
    with _lock:
        conn = _open(main_db)
        conn.executemany(
            """INSERT OR IGNORE INTO events
               (id, ts, source, severity, category, event_type, message,
                host, src_ip, dst_ip, user_field, raw, forwarded)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        conn.commit()


def _row_to_dict(r) -> dict:
    d = dict(r)
    d["user"] = d.pop("user_field", "")
    try:
        d["raw"] = json.loads(d.get("raw") or "{}")
    except Exception:
        d["raw"] = {}
    return d


def query(
    main_db: str,
    since: Optional[str] = None,
    limit: int = 500,
    source: Optional[str] = None,
    severity: Optional[str] = None,
) -> list[dict]:
    sql = (
        "SELECT id,ts,source,severity,category,event_type,message,"
        "host,src_ip,dst_ip,user_field,raw FROM events WHERE 1=1"
    )
    params: list = []
    if since:
        sql += " AND ts > ?"
        params.append(since)
    if source:
        sql += " AND source = ?"
        params.append(source)
    if severity:
        sql += " AND severity = ?"
        params.append(severity)
    sql += " ORDER BY ts DESC LIMIT ?"
    params.append(limit)
    with _lock:
        rows = _open(main_db).execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def pending(main_db: str, limit: int = 200) -> list[dict]:
    sql = (
        "SELECT id,ts,source,severity,category,event_type,message,"
        "host,src_ip,dst_ip,user_field,raw FROM events "
        "WHERE forwarded=0 ORDER BY ts LIMIT ?"
    )
    with _lock:
        rows = _open(main_db).execute(sql, (limit,)).fetchall()
    return [_row_to_dict(r) for r in rows]


def mark_forwarded(main_db: str, ids: list[str]) -> None:
    if not ids:
        return
    placeholders = ",".join("?" * len(ids))
    with _lock:
        conn = _open(main_db)
        conn.execute(f"UPDATE events SET forwarded=1 WHERE id IN ({placeholders})", ids)
        conn.commit()


def status_counts(main_db: str) -> dict:
    today = datetime.now(timezone.utc).date().isoformat()
    with _lock:
        conn = _open(main_db)
        total     = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        today_n   = conn.execute("SELECT COUNT(*) FROM events WHERE ts >= ?", (today,)).fetchone()[0]
        pending_n = conn.execute("SELECT COUNT(*) FROM events WHERE forwarded=0").fetchone()[0]
    return {"events_stored": total, "events_today": today_n, "pending_push": pending_n}


def prune(main_db: str, retain_days: int) -> None:
    cutoff = time.time() - retain_days * 86400
    cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
    with _lock:
        conn = _open(main_db)
        conn.execute("DELETE FROM events WHERE ts < ?", (cutoff_iso,))
        conn.commit()
