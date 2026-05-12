import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from config import get_settings
from security import verify_api_key
from alerting.checker import get_active, get_history, run_check
from alerting.webhook import send_webhook

logger = logging.getLogger(__name__)
alerts_router = APIRouter(prefix="/alerts", tags=["Alerts"], dependencies=[Depends(verify_api_key)])


@alerts_router.get("/status")
def alert_status():
    active = get_active()
    return {"active_count": len(active), "active": active}


@alerts_router.get("/history")
def alert_history(limit: int = 100):
    return {"history": get_history()[:limit]}


@alerts_router.post("/test")
async def test_webhook():
    s = get_settings()
    if not s.webhook_url:
        raise HTTPException(400, "WEBHOOK_URL is not configured")
    payload = [{
        "key": "test",
        "system": "Infra Glassplane",
        "message": "Test notification — webhook is working correctly",
        "severity": "info",
    }]
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None, lambda: send_webhook(s.webhook_url, s.webhook_format, payload, event="test")
        )
    except Exception as e:
        raise HTTPException(502, f"Webhook delivery failed: {e}")
    return {"ok": True, "message": f"Test sent to {s.webhook_url}"}


@alerts_router.post("/check")
async def force_check():
    """Trigger an immediate alert check outside the scheduled interval."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, run_check)
    active = get_active()
    return {"active_count": len(active), "active": active}
