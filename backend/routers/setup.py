from fastapi import APIRouter
from config import get_settings

setup_router = APIRouter(prefix="/setup", tags=["Setup"])


@setup_router.get("/status")
def setup_status():
    s = get_settings()
    configured = any([
        s.vcenter_host,
        s.alletra_host,
        s.veeam_host,
        s.aruba_client_id,
        s.aruba_access_token,
    ])
    return {"needs_setup": not configured}
