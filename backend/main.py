import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from routers.api import vcenter_router, aruba_router, alletra_router, veeam_router, glassplane_router, surge_router, ilo_router
from routers.auth import auth_router
from routers.setup import setup_router
from routers.alerts import alerts_router
from routers.history import history_router
from routers.forecast import forecast_router
from alerting.checker import alert_loop
from history.snapshotter import snapshot_loop

settings = get_settings()
logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Infra Glassplane API starting up")
    alert_task = asyncio.create_task(alert_loop())
    snap_task = asyncio.create_task(snapshot_loop())
    yield
    alert_task.cancel()
    snap_task.cancel()
    for t in (alert_task, snap_task):
        try:
            await t
        except asyncio.CancelledError:
            pass
    logger.info("Infra Glassplane API shutting down")


app = FastAPI(
    title="Infrastructure Glassplane API",
    description="Unified API aggregating vCenter, Aruba, HPE Alletra 6000, and Veeam metrics.",
    version="1.0.0",
    lifespan=lifespan,
)

_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(setup_router)
app.include_router(alerts_router, prefix="/api")
app.include_router(vcenter_router, prefix="/api")
app.include_router(aruba_router, prefix="/api")
app.include_router(alletra_router, prefix="/api")
app.include_router(veeam_router, prefix="/api")
app.include_router(glassplane_router, prefix="/api")
app.include_router(surge_router, prefix="/api")
app.include_router(ilo_router, prefix="/api")
app.include_router(history_router, prefix="/api")
app.include_router(forecast_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level=settings.log_level.lower())
