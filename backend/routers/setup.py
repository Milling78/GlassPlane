import base64
import logging
import socket
import ssl

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from config import get_settings
from security import verify_api_key

logger = logging.getLogger(__name__)
setup_router = APIRouter(prefix="/setup", tags=["Setup"])


@setup_router.get("/config", dependencies=[Depends(verify_api_key)])
async def get_config():
    s = get_settings()
    return {
        "apiKey":           s.api_key,
        "allowedOrigins":   s.allowed_origins,
        "vcenter": {
            "host":      s.vcenter_host,
            "user":      s.vcenter_user,
            "password":  s.vcenter_password,
            "port":      s.vcenter_port,
            "sslVerify": s.vcenter_ssl_verify,
        },
        "aruba": {
            "baseUrl":      s.aruba_central_base_url,
            "clientId":     s.aruba_client_id,
            "clientSecret": s.aruba_client_secret,
            "customerId":   s.aruba_customer_id,
            "accessToken":  s.aruba_access_token,
        },
        "arubaDirectSwitches": {
            "hosts":      s.aruba_direct_hosts,
            "user":       s.aruba_direct_user,
            "password":   s.aruba_direct_password,
            "port":       s.aruba_direct_port,
            "sshPort":    s.aruba_direct_ssh_port,
            "sslVerify":  s.aruba_direct_ssl_verify,
        },
        "alletra": {
            "host":     s.alletra_host,
            "user":     s.alletra_user,
            "password": s.alletra_password,
            "port":     s.alletra_port,
        },
        "veeam": {
            "host":     s.veeam_host,
            "user":     s.veeam_user,
            "password": s.veeam_password,
            "port":     s.veeam_port,
        },
        "ilo": {
            "hosts":     s.ilo_hosts,
            "user":      s.ilo_user,
            "password":  s.ilo_password,
            "port":      s.ilo_port,
            "sslVerify": s.ilo_ssl_verify,
        },
        "cacheTtl":  s.cache_ttl_seconds,
        "logLevel":  s.log_level,
        "alerts": {
            "webhookUrl":             s.webhook_url,
            "webhookFormat":          s.webhook_format,
            "alertIntervalMinutes":   s.alert_interval_seconds // 60,
            "vcenterIdleVms":         s.alert_vcenter_idle_vms,
            "vcenterOversizedVms":    s.alert_vcenter_oversized_vms,
            "vcenterClusterCpuLowPct": s.alert_vcenter_cluster_cpu_low_pct,
            "arubaUnusedPortPct":     s.alert_aruba_unused_port_pct,
            "alletraUtilHighPct":     s.alert_alletra_util_high_pct,
            "alletraUtilLowPct":      s.alert_alletra_util_low_pct,
            "alletraEfficiencyMin":   s.alert_alletra_efficiency_min,
            "veeamFailedJobs":        s.alert_veeam_failed_jobs,
            "veeamUnprotectedVms":    s.alert_veeam_unprotected_vms,
            "veeamRepoUtilPct":       s.alert_veeam_repo_util_pct,
            "iloPowerCapPct":         s.alert_ilo_power_cap_pct,
            "iloErrorCount":          s.alert_ilo_error_count,
        },
    }


@setup_router.post("/reload", dependencies=[Depends(verify_api_key)])
async def reload_config():
    get_settings.cache_clear()
    return {"ok": True, "message": "Configuration reloaded — new settings are active"}


@setup_router.get("/status")
async def setup_status():
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

class ArubaDirectTestReq(BaseModel):
    host: str
    user: str
    password: str
    port: int = 443
    ssh_port: int = 22
    ssl_verify: bool = False


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


@setup_router.post("/test/aruba-direct")
def test_aruba_direct(req: ArubaDirectTestReq):
    # Try AOS-CX REST first
    try:
        base = f"https://{req.host}:{req.port}/rest/v10.08"
        with httpx.Client(verify=req.ssl_verify, timeout=10) as client:
            resp = client.post(f"{base}/login", data={"username": req.user, "password": req.password})
            resp.raise_for_status()
            sys_resp = client.get(f"{base}/system", params={"attributes": "hostname,platform_name"})
            client.post(f"{base}/logout")
            sys_resp.raise_for_status()
            d = sys_resp.json()
            name = d.get("hostname", req.host)
            model = d.get("platform_name", "AOS-CX")
            return {"ok": True, "message": f"AOS-CX REST — {name} ({model})", "method": "aoscx"}
    except Exception as rest_err:
        pass

    # Fall back to SSH
    try:
        import paramiko, time
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(req.host, port=req.ssh_port, username=req.user, password=req.password,
                       timeout=10, look_for_keys=False, allow_agent=False)
        _, stdout, _ = client.exec_command("show system information", timeout=10)
        out = stdout.read().decode("utf-8", errors="replace")
        client.close()
        import re
        name_m = re.search(r"System Name\s*:\s*(.+)", out)
        name = name_m.group(1).strip() if name_m else req.host
        return {"ok": True, "message": f"SSH — {name}", "method": "ssh"}
    except Exception as ssh_err:
        return {"ok": False, "message": f"REST: {_friendly(rest_err)} | SSH: {_friendly(ssh_err)}"}


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
