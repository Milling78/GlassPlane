from fastapi import APIRouter, Depends, Query
from typing import Optional

from config import get_settings
from models.schemas import SiemEvent
from security import verify_api_key
from siem import store as siem_store
from siem.publisher import get_runtime_status

siem_router = APIRouter(prefix="/siem", tags=["siem"], dependencies=[Depends(verify_api_key)])


@siem_router.get("/status")
def siem_status():
    s = get_settings()
    return {
        "enabled":  s.siem_enabled,
        "push_url": s.siem_push_url,
        **get_runtime_status(s.db_path),
    }


@siem_router.get("/events")
def list_events(
    since:    Optional[str] = Query(None, description="ISO-8601 UTC lower bound for ts"),
    limit:    int           = Query(500, le=5000),
    source:   Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
):
    """Pull normalised events — primary integration point for the SIEM project."""
    s = get_settings()
    return siem_store.query(s.db_path, since=since, limit=limit,
                            source=source, severity=severity)


@siem_router.post("/ingest")
def ingest_events(events: list[SiemEvent]):
    """Receive SiemEvent[] pushed by the SIEM project back into GlassPlane."""
    s = get_settings()
    siem_store.store(s.db_path, events)
    return {"stored": len(events)}
