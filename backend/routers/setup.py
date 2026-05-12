import base64
import logging
import socket
import ssl

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from config import get_settings

logger = logging.getLogger(__name__)
setup_router = APIRouter(prefix="/setup", tags=["Setup"])


@setup_router.get("/status")
def setup_status():
    s = get_settings()
    configured = any([
        s.vcenter_host, s.alletra_host, s.veeam_host,
        s.aruba_client_id, s.aruba_access_token,
    ])
    return {"needs_setup": not configured}


# ── Request models ────────────────────────────────────────────────────────────

class VCenterTestReq(BaseModel):
    host: str
    user: str
    password: str
    port: int = 443
    ssl_verify: bool = False

class ArubaTestReq(BaseModel):
    base_url: str
    client_id: str = ""
    client_secret: str = ""
    customer_id: str = ""
    access_token: str = ""

class AlletraTestReq(BaseModel):
    host: str
    user: str
    password: str
    port: int = 8080

class VeeamTestReq(BaseModel):
    host: str
    user: str
    password: str
    port: int = 9419


# ── Helpers ───────────────────────────────────────────────────────────────────

def _friendly(e: Exception) -> str:
    msg = str(e)
    if any(x in msg for x in ("Connection refused", "ConnectError", "ConnectionRefused")):
        return "Connection refused — check host and port"
    if any(x in msg.lower() for x in ("timed out", "timeout")):
        return "Timed out — host unreachable"
    if any(x in msg for x in ("401", "403")) or "authentication" in msg.lower():
        return "Authentication failed — check credentials"
    return msg[:180]


def _unverified_ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


# ── Test endpoints ────────────────────────────────────────────────────────────

@setup_router.post("/test/vcenter")
def test_vcenter(req: VCenterTestReq):
    try:
        from pyVim.connect import SmartConnect, Disconnect

        ctx = _unverified_ssl_ctx()
        old = socket.getdefaulttimeout()
        socket.setdefaulttimeout(10)
        try:
            si = SmartConnect(
                host=req.host, user=req.user, pwd=req.password,
                port=req.port, sslContext=ctx,
            )
            version = si.content.about.version
            Disconnect(si)
        finally:
            socket.setdefaulttimeout(old)

        return {"ok": True, "message": f"Connected — vCenter {version}"}
    except Exception as e:
        logger.debug(f"vCenter test failed: {e}")
        return {"ok": False, "message": _friendly(e)}


@setup_router.post("/test/aruba")
def test_aruba(req: ArubaTestReq):
    try:
        with httpx.Client(verify=False, timeout=10) as client:
            if req.access_token:
                token = req.access_token
            else:
                resp = client.post(
                    f"{req.base_url}/oauth2/token",
                    data={
                        "client_id": req.client_id,
                        "client_secret": req.client_secret,
                        "grant_type": "client_credentials",
                        "customer_id": req.customer_id,
                    },
                )
                resp.raise_for_status()
                token = resp.json()["access_token"]

            resp = client.get(
                f"{req.base_url}/monitoring/v1/switches",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": 1},
            )
            resp.raise_for_status()
            count = resp.json().get("count", "?")
            return {"ok": True, "message": f"Connected — {count} switch(es) visible"}
    except Exception as e:
        logger.debug(f"Aruba test failed: {e}")
        return {"ok": False, "message": _friendly(e)}


@setup_router.post("/test/alletra")
def test_alletra(req: AlletraTestReq):
    try:
        base = f"https://{req.host}:{req.port}/api/v1"
        cred = base64.b64encode(f"{req.user}:{req.password}".encode()).decode()

        with httpx.Client(verify=False, timeout=10) as client:
            resp = client.post(
                f"{base}/credentials",
                headers={"Content-Type": "application/json", "Authorization": f"Basic {cred}"},
                json={"user": req.user, "password": req.password},
            )
            resp.raise_for_status()
            token = resp.json()["key"]

            sys_resp = client.get(
                f"{base}/system",
                headers={"X-HP3PAR-WSAPI-SessionKey": token, "Accept": "application/json"},
            )
            sys_resp.raise_for_status()
            name = sys_resp.json().get("name", "Alletra")
            return {"ok": True, "message": f"Connected — {name}"}
    except Exception as e:
        logger.debug(f"Alletra test failed: {e}")
        return {"ok": False, "message": _friendly(e)}


@setup_router.post("/test/veeam")
def test_veeam(req: VeeamTestReq):
    try:
        base = f"https://{req.host}:{req.port}/api/v1"

        with httpx.Client(verify=False, timeout=10) as client:
            resp = client.post(
                f"{base}/token",
                data={
                    "grant_type": "password",
                    "username": req.user,
                    "password": req.password,
                    "use_short_term_refresh": "true",
                },
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "x-api-version": "1.1-rev2",
                },
            )
            resp.raise_for_status()
            return {"ok": True, "message": "Authenticated successfully"}
    except Exception as e:
        logger.debug(f"Veeam test failed: {e}")
        return {"ok": False, "message": _friendly(e)}
