from typing import Optional

from fastapi import APIRouter, Depends

from security import verify_api_key
import log_buffer

logs_router = APIRouter(prefix="/logs", tags=["Logs"], dependencies=[Depends(verify_api_key)])


@logs_router.get("/")
async def get_logs(level: Optional[str] = None, limit: int = 200):
    return {"records": log_buffer.get_records(level=level, limit=limit)}


@logs_router.delete("/")
async def clear_logs():
    log_buffer.clear()
    return {"ok": True}
