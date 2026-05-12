import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from routers.api import vcenter_router, aruba_router, alletra_router, veeam_router, glassplane_router, surge_router
from routers.auth import auth_router

settings = get_settings()
logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Infra Glassplane API starting up")
    yield
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
app.include_router(vcenter_router, prefix="/api")
app.include_router(aruba_router, prefix="/api")
app.include_router(alletra_router, prefix="/api")
app.include_router(veeam_router, prefix="/api")
app.include_router(glassplane_router, prefix="/api")
app.include_router(surge_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
