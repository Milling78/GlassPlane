from fastapi import APIRouter, Depends, Query

from config import get_settings
from security import verify_api_key
from history.store import read

history_router = APIRouter(
    prefix="/history", tags=["History"], dependencies=[Depends(verify_api_key)]
)


@history_router.get("")
def get_history(hours: float = Query(default=24, ge=1, le=168)):
    s = get_settings()
    points = read(s.db_path, hours)
    return {"points": points, "hours": hours, "count": len(points)}
