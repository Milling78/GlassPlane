"""
Background threads that push pending SIEM events to a configured push URL
and prune old events from the local store.
"""

import logging
import threading
import time
from datetime import datetime, timezone

import httpx

from siem import store as siem_store

log = logging.getLogger("siem.publisher")

_status: dict = {
    "last_push_ts":  None,
    "last_push_ok":  True,
    "last_push_err": "",
}


def get_runtime_status(main_db: str) -> dict:
    counts = siem_store.status_counts(main_db)
    return {**counts, **_status}


def _push_loop(cfg_fn) -> None:
    while True:
        time.sleep(30)
        try:
            cfg = cfg_fn()
            if not getattr(cfg, "siem_enabled", False) or not cfg.siem_push_url:
                continue
            batch = siem_store.pending(cfg.db_path, limit=200)
            if not batch:
                continue
            headers: dict = {"Content-Type": "application/json"}
            if cfg.siem_push_api_key:
                headers["Authorization"] = f"Bearer {cfg.siem_push_api_key}"
            url = f"{cfg.siem_push_url.rstrip('/')}/api/ingest/batch"
            with httpx.Client(timeout=15, verify=False) as client:
                resp = client.post(url, json=batch, headers=headers)
                resp.raise_for_status()
            siem_store.mark_forwarded(cfg.db_path, [e["id"] for e in batch])
            _status["last_push_ts"]  = datetime.now(timezone.utc).isoformat()
            _status["last_push_ok"]  = True
            _status["last_push_err"] = ""
            log.debug("Pushed %d SIEM events to %s", len(batch), cfg.siem_push_url)
        except Exception as exc:
            _status["last_push_ok"]  = False
            _status["last_push_err"] = str(exc)[:200]
            log.warning("SIEM push failed: %s", exc)


def _prune_loop(cfg_fn) -> None:
    while True:
        time.sleep(3600)
        try:
            cfg = cfg_fn()
            retain = getattr(cfg, "siem_retain_days", 30)
            siem_store.prune(cfg.db_path, retain)
        except Exception as exc:
            log.warning("SIEM prune failed: %s", exc)


def start(cfg_fn) -> None:
    threading.Thread(target=_push_loop,  args=(cfg_fn,), daemon=True, name="siem-push").start()
    threading.Thread(target=_prune_loop, args=(cfg_fn,), daemon=True, name="siem-prune").start()
