"""
In-memory log buffer — captures the last MAX_RECORDS log entries from
every logger so the frontend can display a live log tail.
"""

import logging
import re
from collections import deque
from datetime import datetime, timezone

_REDACT_RE = re.compile(
    r'(?i)(password|passwd|token|api_key|apikey|secret|bearer)(\s*[=:]\s*|\s+)(\S+)',
    re.IGNORECASE,
)


def _redact(text: str) -> str:
    return _REDACT_RE.sub(r'\1\2***', text)

MAX_RECORDS = 500

# Loggers that are too noisy at INFO to be useful in the UI
_MUTED = {"uvicorn.access", "uvicorn.error", "watchfiles.main"}


class _MemoryHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self._records: deque[dict] = deque(maxlen=MAX_RECORDS)

    def emit(self, record: logging.LogRecord):
        if record.name in _MUTED and record.levelno < logging.WARNING:
            return
        try:
            msg = _redact(self.format(record))
        except Exception:
            msg = _redact(record.getMessage())
        self._records.append({
            "ts":      datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level":   record.levelname,   # DEBUG INFO WARNING ERROR CRITICAL
            "logger":  record.name,
            "message": msg,
        })

    def get(self, level: str | None = None, limit: int = 200) -> list[dict]:
        records = list(self._records)
        if level and level.upper() != "ALL":
            min_level = getattr(logging, level.upper(), logging.DEBUG)
            records = [r for r in records if getattr(logging, r["level"], 0) >= min_level]
        return records[-limit:]

    def clear(self):
        self._records.clear()


_handler = _MemoryHandler()
_handler.setFormatter(logging.Formatter("%(message)s"))


def install(root_level: int = logging.DEBUG) -> None:
    """Attach the buffer to the root logger.  Call once at startup."""
    _handler.setLevel(root_level)
    logging.getLogger().addHandler(_handler)


def get_records(level: str | None = None, limit: int = 200) -> list[dict]:
    return _handler.get(level=level, limit=limit)


def clear() -> None:
    _handler.clear()
