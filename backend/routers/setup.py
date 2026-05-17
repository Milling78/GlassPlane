import base64
import logging
import os
import re as _re
import socket
import ssl

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from config import _ENV_FILE, get_settings
from security import verify_api_key

logger = logging.getLogger(__name__)
setup_router = APIRouter(prefix="/setup", tags=["Setup"])


@setup_router.get("/config", dependencies=[Depends(verify_api_key)])
async def get_config():
    s = get_settings()
    return {
        "apiKeyConfigured": bool(s.api_key),
        "allowedOrigins":   s.allowed_origins,
        "frontendDist":     s.frontend_dist,
        "vcenter": {
            "host":              s.vcenter_host,
            "user":              s.vcenter_user,
            "passwordConfigured": bool(s.vcenter_password),
            "port":              s.vcenter_port,
            "sslVerify":         s.vcenter_ssl_verify,
        },
        "aruba": {
            "baseUrl":              s.aruba_central_base_url,
            "clientId":             s.aruba_client_id,
            "clientSecretConfigured": bool(s.aruba_client_secret),
            "customerId":           s.aruba_customer_id,
            "accessTokenConfigured": bool(s.aruba_access_token),
        },
        "arubaWireless": {
            "host":              s.aruba_wireless_host,
            "user":              s.aruba_wireless_user,
            "passwordConfigured": bool(s.aruba_wireless_password),
            "port":              s.aruba_wireless_port,
        },
        "arubaDirectSwitches": {
            "hosts":             s.aruba_direct_hosts,
            "user":              s.aruba_direct_user,
            "passwordConfigured": bool(s.aruba_direct_password),
            "port":              s.aruba_direct_port,
            "sshPort":           s.aruba_direct_ssh_port,
            "sslVerify":         s.aruba_direct_ssl_verify,
        },
        "alletra": {
            "host":              s.alletra_host,
            "user":              s.alletra_user,
            "passwordConfigured": bool(s.alletra_password),
            "port":              s.alletra_port,
        },
        "veeam": {
            "host":              s.veeam_host,
            "user":              s.veeam_user,
            "passwordConfigured": bool(s.veeam_password),
            "port":              s.veeam_port,
        },
        "ilo": {
            "hosts":             s.ilo_hosts,
            "user":              s.ilo_user,
            "passwordConfigured": bool(s.ilo_password),
            "port":              s.ilo_port,
            "sslVerify":         s.ilo_ssl_verify,
            "hostMap":           s.ilo_host_map,
        },
        "cacheTtl":  s.cache_ttl_seconds,
        "logLevel":  s.log_level,
        "dns": {
            "servers":    s.dns_servers,
            "checkHosts": s.dns_check_hosts,
            "timeout":    s.dns_timeout,
        },
        "certs": {
            "hosts":     s.cert_hosts,
            "warnDays":  s.cert_warn_days,
            "critDays":  s.cert_crit_days,
            "timeout":   s.cert_timeout,
        },
        "kace": {
            "host":              s.kace_host,
            "user":              s.kace_user,
            "passwordConfigured": bool(s.kace_password),
            "org":               s.kace_org,
            "port":              s.kace_port,
            "sslVerify":         s.kace_ssl_verify,
            "helpdeskQueue":     s.kace_helpdesk_queue,
            "engineeringQueue":  s.kace_engineering_queue,
            "ticketLimit":       s.kace_ticket_limit,
        },
        "claude": {
            "apiKeyConfigured": bool(s.anthropic_api_key),
            "model":            s.claude_model,
        },
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
        "rds": {
            "broker":       s.rds_broker,
            "hosts":        s.rds_hosts,
            "warnLoadPct":  s.rds_warn_load_pct,
            "critLoadPct":  s.rds_crit_load_pct,
        },
        "fortianalyzer": {
            "host":              s.fortianalyzer_host,
            "user":              s.fortianalyzer_user,
            "passwordConfigured": bool(s.fortianalyzer_password),
            "port":              s.fortianalyzer_port,
            "sslVerify":         s.fortianalyzer_ssl_verify,
            "adom":              s.fortianalyzer_adom,
            "diskWarnPct":       s.fortianalyzer_disk_warn_pct,
            "diskCritPct":       s.fortianalyzer_disk_crit_pct,
        },
        "exchange": {
            "server":              s.exchange_server,
            "user":                s.exchange_user,
            "passwordConfigured":  bool(s.exchange_password),
            "domain":              s.exchange_domain,
            "transportWarnQueue":  s.exchange_transport_warn_queue,
            "transportCritQueue":  s.exchange_transport_crit_queue,
        },
        "fortigate": {
            "host":             s.fortigate_host,
            "tokenConfigured":  bool(s.fortigate_token),
            "port":             s.fortigate_port,
            "sslVerify":        s.fortigate_ssl_verify,
            "vdom":             s.fortigate_vdom,
            "warnCpuPct":       s.fortigate_warn_cpu_pct,
            "critCpuPct":       s.fortigate_crit_cpu_pct,
        },
        "tv": {
            "enabled":        s.tv_mode_enabled,
            "resolution":     s.tv_mode_resolution,
            "refreshSeconds": s.tv_mode_refresh_seconds,
        },
        "siem": {
            "enabled":            s.siem_enabled,
            "pushUrl":            s.siem_push_url,
            "pushApiKeyConfigured": bool(s.siem_push_api_key),
            "retainDays":         s.siem_retain_days,
        },
    }


@setup_router.post("/reload", dependencies=[Depends(verify_api_key)])
async def reload_config():
    get_settings.cache_clear()
    from routers.api import clear_all_caches
    clear_all_caches()
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

class ArubaWirelessTestReq(BaseModel):
    host: str
    user: str
    password: str
    port: int = 4343

class KACETestReq(BaseModel):
    host: str
    user: str
    password: str
    org: str = "Default"
    port: int = 443


# ── Helpers ───────────────────────────────────────────────────────────────────

_CRED_RE = _re.compile(r'(PASSWORD|SECRET|TOKEN|KEY|PASSWD)', _re.I)


def _merge_env_content(existing: str, incoming: str) -> str:
    """Preserve non-empty credential values from existing .env when the UI sends blanks."""
    existing_vals: dict[str, str] = {}
    for line in existing.split('\n'):
        eq = line.find('=')
        if eq == -1 or line.lstrip().startswith('#'):
            continue
        existing_vals[line[:eq].strip()] = line[eq + 1:]
    out = []
    for line in incoming.split('\n'):
        eq = line.find('=')
        if eq == -1 or line.lstrip().startswith('#'):
            out.append(line)
            continue
        k, v = line[:eq].strip(), line[eq + 1:].strip()
        if v == '' and _CRED_RE.search(k) and existing_vals.get(k, '').strip():
            out.append(f"{k}={existing_vals[k]}")
        else:
            out.append(line)
    return '\n'.join(out)


class SaveConfigReq(BaseModel):
    content: str


@setup_router.post("/save", dependencies=[Depends(verify_api_key)])
async def save_config(req: SaveConfigReq):
    """Write .env content server-side — enables Settings save without Electron."""
    from routers.api import clear_all_caches
    env_path = os.path.abspath(_ENV_FILE)
    content = req.content
    if os.path.exists(env_path):
        try:
            content = _merge_env_content(open(env_path, encoding='utf-8').read(), content)
        except Exception as e:
            logger.warning("save_config merge failed: %s", e)
    parent = os.path.dirname(env_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(env_path, 'w', encoding='utf-8') as f:
        f.write(content)
    get_settings.cache_clear()
    clear_all_caches()
    return {"ok": True, "path": env_path}


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
    rest_error = None
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
    except Exception as e:
        rest_error = e  # save before Python 3 deletes the except-clause variable

    # Fall back to SSH — use raw Transport so we can enable legacy algorithms
    # required by older ProCurve / Aruba switches (ssh-dss, dh-group1-sha1).
    try:
        from connectors.aruba_direct import _open_ssh_transport
        import re as _re
        transport = _open_ssh_transport(req.host, req.ssh_port, req.user, req.password)
        try:
            chan = transport.open_session()
            chan.exec_command("show system information")
            out = chan.makefile("r").read()
        finally:
            transport.close()
        name_m = _re.search(r"System Name\s*:\s*(.+)", out)
        name = name_m.group(1).strip() if name_m else req.host
        return {"ok": True, "message": f"SSH — {name}", "method": "ssh"}
    except Exception as ssh_err:
        return {"ok": False, "message": f"REST: {_friendly(rest_error)} | SSH: {_friendly(ssh_err)}"}


@setup_router.post("/test/aruba-wireless")
def test_aruba_wireless(req: ArubaWirelessTestReq):
    try:
        import ssl, httpx
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        try:
            ctx.minimum_version = ssl.TLSVersion.TLSv1
        except (AttributeError, ssl.SSLError):
            pass
        _AP_PROBE = [
            ("monitor/ap_details",        "AP Details",  {}),
            ("monitor/ap_active",         "AP active",   {}),
            ("monitor/ap_database",       "AP Database", {}),
            ("monitor/ap_table",          "AP table",    {}),
            ("monitor/ap_all",            "AP all",      {}),
            ("configuration/showcommand", "AP Database", {"command": "show ap database"}),
            ("configuration/showcommand", "AP active",   {"command": "show ap active"}),
        ]
        def _isal(v):
            return isinstance(v, list) and (not v or isinstance(v[0], dict))
        base = f"https://{req.host}:{req.port}/api/v1"
        with httpx.Client(verify=ctx, timeout=10, follow_redirects=True) as client:
            # ArubaOS 8.x requires form-encoded login, not JSON
            r = client.post(f"{base}/api/login", data={"uid": req.user, "passwd": req.password})
            r.raise_for_status()
            try:
                _lb = r.json() or {}
            except ValueError:
                _lb = {}
            uid_token = _lb.get("UIDARUBA") or r.cookies.get("UIDARUBA") or ""
            ap_count = 0
            try:
                for path, key, extra in _AP_PROBE:
                    params = dict(extra)
                    if uid_token:
                        params["UIDARUBA"] = uid_token
                    ap_r = client.get(f"{base}/{path}", params=params or None)
                    if ap_r.status_code in (400, 401, 403, 404, 405, 501):
                        continue
                    ap_r.raise_for_status()
                    if not ap_r.content:
                        break
                    try:
                        body = ap_r.json()
                    except ValueError:
                        continue
                    aps = None
                    for k in (key, "_data"):
                        v = body.get(k)
                        if v is None: continue
                        if _isal(v): aps = v; break
                        if isinstance(v, dict):
                            for iv in v.values():
                                if _isal(iv): aps = iv; break
                        if aps is not None: break
                    if aps is None:
                        for v in body.values():
                            if _isal(v): aps = v; break
                    if aps is not None:
                        ap_count = len(aps)
                        break
            finally:
                try:
                    p = {"UIDARUBA": uid_token} if uid_token else {}
                    client.get(f"{base}/api/logout", params=p or None)
                except Exception:
                    pass
        return {"ok": True, "message": f"Connected — {ap_count} access point(s) found"}
    except Exception as e:
        logger.debug(f"Aruba wireless test failed: {e}")
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


@setup_router.post("/test/kace")
def test_kace(req: KACETestReq):
    try:
        base = f"https://{req.host}:{req.port}"
        with httpx.Client(verify=False, timeout=10, follow_redirects=True) as client:
            resp = client.post(
                f"{base}/ams/shared/api/security/login",
                json={"userName": req.user, "password": req.password, "organizationName": req.org},
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            token = resp.headers.get("x-dell-auth-token") or (resp.json().get("UserToken") or {}).get("token")
            if token:
                client.headers["x-dell-auth-token"] = token
            q_resp = client.get(f"{base}/api/service_desk/queues")
            q_resp.raise_for_status()
            queues = q_resp.json().get("Queues", [])
            names = [q.get("name", "") for q in queues[:8]]
            return {"ok": True, "message": f"Connected — {len(queues)} queue(s): {', '.join(names)}"}
    except Exception as e:
        logger.debug(f"KACE test failed: {e}")
        return {"ok": False, "message": _friendly(e)}


class FortiAnalyzerTestReq(BaseModel):
    host: str
    user: str
    password: str
    port: int = 443
    ssl_verify: bool = False


@setup_router.post("/test/fortianalyzer")
def test_fortianalyzer(req: FortiAnalyzerTestReq):
    try:
        import ssl as _ssl
        ctx = _ssl.SSLContext(_ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = _ssl.CERT_NONE
        verify = req.ssl_verify if req.ssl_verify else ctx
        with httpx.Client(
            base_url=f"https://{req.host}:{req.port}",
            verify=verify, timeout=10,
            headers={"Content-Type": "application/json"},
        ) as client:
            resp = client.post("/jsonrpc", json={
                "id": 1, "method": "exec",
                "params": [{"url": "/sys/login/user",
                             "data": {"user": req.user, "passwd": req.password}}],
            })
            resp.raise_for_status()
            j = resp.json()
            session = j.get("session")
            r0 = (j.get("result") or [{}])
            r0 = r0[0] if isinstance(r0, list) else r0
            code = r0.get("status", {}).get("code", -1)
            if code != 0 or not session:
                msg = r0.get("status", {}).get("message", "login failed")
                return {"ok": False, "message": f"Login failed: {msg}"}
            # Get hostname
            sys_resp = client.post("/jsonrpc", json={
                "id": 2, "method": "get",
                "params": [{"url": "/sys/status"}],
                "session": session,
            })
            sys_resp.raise_for_status()
            sys_j = sys_resp.json()
            sys_r = (sys_j.get("result") or [{}])
            sys_r = sys_r[0] if isinstance(sys_r, list) else sys_r
            sys_data = sys_r.get("data") or {}
            hostname = sys_data.get("Hostname") or sys_data.get("hostname") or req.host
            version  = sys_data.get("Version")  or sys_data.get("version")  or ""
            # Logout
            try:
                client.post("/jsonrpc", json={"id": 3, "method": "exec",
                                               "params": [{"url": "/sys/logout"}],
                                               "session": session})
            except Exception:
                pass
            return {"ok": True, "message": f"Connected — {hostname} {version}"}
    except Exception as e:
        logger.debug(f"FortiAnalyzer test failed: {e}")
        return {"ok": False, "message": _friendly(e)}


class ExchangeTestReq(BaseModel):
    server: str
    user: str
    password: str
    domain: str = ""


@setup_router.post("/test/exchange")
def test_exchange(req: ExchangeTestReq):
    import os as _os, tempfile as _tmp, subprocess as _sp, json as _json
    ps = r"""
param([string]$Server,[string]$User,[string]$Password,[string]$Domain="")
try {
    $sp = ConvertTo-SecureString $Password -AsPlainText -Force
    $cu = if ($Domain) { "$Domain\$User" } else { $User }
    $cr = New-Object System.Management.Automation.PSCredential($cu,$sp)
    $so = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
    $s  = New-PSSession -ConfigurationName Microsoft.Exchange `
              -ConnectionUri "http://$Server/PowerShell/" `
              -Authentication Kerberos -Credential $cr -SessionOption $so -ErrorAction Stop
    $v = Invoke-Command -Session $s -ScriptBlock { (Get-ExchangeServer | Select-Object -First 1).AdminDisplayVersion.ToString() }
    Remove-PSSession $s -ErrorAction SilentlyContinue
    @{ ok=$true; version=$v } | ConvertTo-Json
} catch {
    @{ ok=$false; error=$_.Exception.Message } | ConvertTo-Json
}
"""
    ps_path = None
    try:
        with _tmp.NamedTemporaryFile(suffix=".ps1", mode="w", encoding="utf-8", delete=False) as f:
            f.write(ps)
            ps_path = f.name
        r = _sp.run(
            ["powershell", "-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-File", ps_path,
             "-Server", req.server, "-User", req.user, "-Password", req.password,
             "-Domain", req.domain or ""],
            capture_output=True, text=True, timeout=30,
        )
        raw = r.stdout.strip()
        if not raw:
            return {"ok": False, "message": r.stderr.strip()[:200] or "No output from PowerShell"}
        d = _json.loads(raw)
        if d.get("ok"):
            return {"ok": True, "message": f"Connected — Exchange {d.get('version', '')}"}
        return {"ok": False, "message": d.get("error", "Unknown error")[:200]}
    except _sp.TimeoutExpired:
        return {"ok": False, "message": "Timed out — check server FQDN and WinRM connectivity"}
    except Exception as e:
        return {"ok": False, "message": _friendly(e)}
    finally:
        if ps_path and _os.path.exists(ps_path):
            try: _os.unlink(ps_path)
            except OSError: pass


class FortiGateTestReq(BaseModel):
    host: str
    token: str
    port: int = 443
    vdom: str = "root"
    ssl_verify: bool = False


@setup_router.post("/test/fortigate")
def test_fortigate(req: FortiGateTestReq):
    try:
        ctx = _unverified_ssl_ctx()
        verify = req.ssl_verify if req.ssl_verify else ctx
        with httpx.Client(
            base_url=f"https://{req.host}:{req.port}",
            headers={"Authorization": f"Bearer {req.token}", "Accept": "application/json"},
            verify=verify,
            timeout=10,
        ) as client:
            resp = client.get("/api/v2/monitor/system/status", params={"vdom": req.vdom})
            resp.raise_for_status()
            data = resp.json()
            r = data.get("results", data)
            hostname = r.get("hostname") or r.get("system info", {}).get("hostname", req.host)
            version = r.get("version") or r.get("system info", {}).get("version", "unknown")
            return {"ok": True, "message": f"Connected — {hostname} running {version}"}
    except Exception as e:
        logger.debug(f"FortiGate test failed: {e}")
        return {"ok": False, "message": _friendly(e)}


class RDSTestReq(BaseModel):
    broker: str = ""
    hosts: str = ""   # comma-separated hostnames


@setup_router.post("/test/rds")
def test_rds(req: RDSTestReq):
    import subprocess, tempfile, os as _os, json as _json
    broker = req.broker.strip()
    hosts  = req.hosts.strip()
    if not broker and not hosts:
        return {"ok": False, "message": "No broker or hosts configured"}

    # Quick PowerShell probe — just test TCP+qwinsta on first host
    target = broker if broker else hosts.split(",")[0].strip()
    try:
        r = subprocess.run(
            ["powershell", "-NonInteractive", "-NoProfile", "-Command",
             f"$r = & qwinsta /server:{target} 2>&1; "
             f"if($LASTEXITCODE -eq 0){{Write-Output 'ok'}}else{{Write-Output $r[0]}}"],
            capture_output=True, text=True, timeout=20,
        )
        out = r.stdout.strip()
        if out == "ok" or "SESSIONNAME" in out:
            return {"ok": True, "message": f"Reached {target} — qwinsta returned session data"}
        if "Access is denied" in out or "Logon failure" in out:
            return {"ok": False, "message": f"Access denied to {target} — check credentials / WinRM permissions"}
        if out:
            return {"ok": False, "message": f"Unexpected response from {target}: {out[:120]}"}
        return {"ok": False, "message": f"No response from {target} — host may be unreachable"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "message": f"Timed out connecting to {target}"}
    except Exception as e:
        return {"ok": False, "message": _friendly(e)}


# ── Diagnostic endpoints (step-by-step output) ────────────────────────────────

@setup_router.post("/diagnose/aruba-direct")
def diagnose_aruba_direct(req: ArubaDirectTestReq):
    import time, re as _re
    steps: list[dict] = []

    def add(label: str, ok, detail: str = ""):
        steps.append({"label": label, "ok": ok, "detail": detail})

    # ── REST path ──────────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        with socket.create_connection((req.host, req.port), timeout=5):
            add(f"TCP {req.host}:{req.port}", True,
                f"reachable ({round((time.perf_counter() - t0) * 1000)} ms)")
        rest_tcp = True
    except Exception as e:
        add(f"TCP {req.host}:{req.port}", False, str(e)[:120])
        rest_tcp = False

    rest_ok = False
    if rest_tcp:
        ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_REQUIRED if req.ssl_verify else ssl.CERT_NONE
        try:
            with socket.create_connection((req.host, req.port), timeout=5) as raw:
                with ssl_ctx.wrap_socket(raw, server_hostname=req.host) as ssock:
                    c = ssock.cipher()
                    add("TLS handshake", True,
                        f"{ssock.version()}, cipher={c[0] if c else '?'}")
            tls_ok = True
        except Exception as e:
            add("TLS handshake", False, str(e)[:150])
            tls_ok = False

        if tls_ok:
            base = f"https://{req.host}:{req.port}/rest/v10.08"
            try:
                with httpx.Client(verify=ssl_ctx, timeout=8) as client:
                    r = client.post(f"{base}/login",
                                    data={"username": req.user, "password": req.password})
                    if r.status_code == 200:
                        add("AOS-CX REST login", True, "HTTP 200")
                        sys_r = client.get(f"{base}/system",
                                           params={"attributes": "hostname,platform_name,software_version"})
                        client.post(f"{base}/logout")
                        if sys_r.status_code == 200:
                            d = sys_r.json()
                            add("AOS-CX system info", True,
                                f"{d.get('hostname', req.host)} — "
                                f"{d.get('platform_name', '?')} — "
                                f"AOS-CX {d.get('software_version', '?')}")
                            rest_ok = True
                        else:
                            add("AOS-CX system info", False, f"HTTP {sys_r.status_code}")
                    else:
                        snip = r.text[:120].replace('\n', ' ')
                        add("AOS-CX REST login", False, f"HTTP {r.status_code}: {snip}")
            except Exception as e:
                add("AOS-CX REST login", False, str(e)[:150])

    # ── SSH path ───────────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        with socket.create_connection((req.host, req.ssh_port), timeout=5):
            add(f"TCP {req.host}:{req.ssh_port} (SSH)", True,
                f"reachable ({round((time.perf_counter() - t0) * 1000)} ms)")
        ssh_tcp = True
    except Exception as e:
        add(f"TCP {req.host}:{req.ssh_port} (SSH)", False, str(e)[:120])
        ssh_tcp = False

    ssh_ok = False
    if ssh_tcp:
        try:
            import paramiko
            from connectors.aruba_direct import _LEGACY_KEY_TYPES, _LEGACY_KEX, _LEGACY_CIPHERS, _LEGACY_MACS
            sock = socket.create_connection((req.host, req.ssh_port), timeout=10)
            transport = paramiko.Transport(sock)
            sec = transport.get_security_options()
            sec.key_types = tuple(dict.fromkeys(list(sec.key_types) + list(_LEGACY_KEY_TYPES)))
            sec.kex       = tuple(dict.fromkeys(list(sec.kex)       + list(_LEGACY_KEX)))
            sec.ciphers   = tuple(dict.fromkeys(list(sec.ciphers)   + list(_LEGACY_CIPHERS)))
            sec.digests   = tuple(dict.fromkeys(list(sec.digests)   + list(_LEGACY_MACS)))

            try:
                transport.start_client(timeout=10)
                cipher = getattr(transport, 'local_cipher', None) or '?'
                mac    = getattr(transport, 'local_mac',    None) or '?'
                add("SSH handshake", True, f"cipher={cipher}, mac={mac}")
            except Exception as e:
                add("SSH handshake", False, str(e)[:150])
                transport.close()
                return {"steps": steps, "ok": rest_ok,
                        "summary": "REST ok" if rest_ok else "SSH negotiation failed — possible algorithm mismatch"}

            try:
                transport.auth_password(req.user, req.password)
                add("SSH authentication", True, f"authenticated as {req.user}")
            except paramiko.AuthenticationException:
                add("SSH authentication", False, "Wrong username or password")
                transport.close()
            except Exception as e:
                add("SSH authentication", False, str(e)[:150])
                transport.close()
            else:
                try:
                    chan = transport.open_session()
                    chan.exec_command("show system information")
                    out  = chan.makefile("r").read(4096)
                    nm   = _re.search(r"System Name\s*:\s*(.+)", out)
                    mm   = _re.search(r"(?:System Model|platform)[^:]*:\s*(.+)", out, _re.IGNORECASE)
                    name  = nm.group(1).strip() if nm else "?"
                    model = mm.group(1).strip() if mm else "?"
                    add("SSH show system", True, f"{name} — {model}")
                    ssh_ok = True
                except Exception as e:
                    add("SSH show system", False, str(e)[:150])
                finally:
                    transport.close()
        except Exception as e:
            add("SSH setup", False, str(e)[:150])

    ok = rest_ok or ssh_ok
    if rest_ok:
        summary = "AOS-CX REST — connected successfully"
    elif ssh_ok:
        summary = "SSH — connected (AOS-CX REST unavailable)"
    elif rest_tcp or ssh_tcp:
        summary = "Host reachable but login failed — check credentials"
    else:
        summary = "Host unreachable on both REST and SSH ports"

    return {"steps": steps, "ok": ok, "summary": summary}


@setup_router.post("/diagnose/aruba-wireless")
def diagnose_aruba_wireless(req: ArubaWirelessTestReq):
    import time
    steps: list[dict] = []

    # All critical info goes in the LABEL so it is readable regardless of styling.
    def add(label: str, ok, detail: str = ""):
        steps.append({"label": label, "ok": ok, "detail": detail})

    def _isal(v):
        return isinstance(v, list) and (not v or isinstance(v[0], dict))

    def _short(path, extra):
        if "showcommand" in path:
            return f"showcommand({extra.get('command','?')})"
        return path.split("/")[-1]

    _AP_PROBE = [
        ("monitor/ap_details",        "AP Details",  {}),
        ("monitor/ap_active",         "AP active",   {}),
        ("monitor/ap_database",       "AP Database", {}),
        ("monitor/ap_table",          "AP table",    {}),
        ("monitor/ap_all",            "AP all",      {}),
        ("configuration/showcommand", "AP Database", {"command": "show ap database"}),
        ("configuration/showcommand", "AP active",   {"command": "show ap active"}),
    ]

    # TCP
    t0 = time.perf_counter()
    try:
        with socket.create_connection((req.host, req.port), timeout=5):
            ms = round((time.perf_counter() - t0) * 1000)
            add(f"TCP {req.host}:{req.port}  reachable ({ms} ms)", True)
        tcp_ok = True
    except Exception as e:
        add(f"TCP {req.host}:{req.port}  FAILED: {str(e)[:80]}", False)
        tcp_ok = False

    if not tcp_ok:
        return {"steps": steps, "ok": False, "summary": "Host unreachable"}

    # TLS
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    try:
        ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1
    except (AttributeError, ssl.SSLError):
        pass

    try:
        with socket.create_connection((req.host, req.port), timeout=5) as raw:
            with ssl_ctx.wrap_socket(raw, server_hostname=req.host) as ssock:
                ver = ssock.version()
                add(f"TLS handshake  {ver}", True)
        tls_ok = True
    except Exception as e:
        add(f"TLS handshake  FAILED: {str(e)[:100]}", False)
        tls_ok = False

    if not tls_ok:
        return {"steps": steps, "ok": False, "summary": "TLS handshake failed"}

    # Login + AP endpoints
    root  = f"https://{req.host}:{req.port}"
    base  = f"{root}/api/v1"
    hdrs  = {"Accept": "application/json"}
    try:
        with httpx.Client(verify=ssl_ctx, timeout=10, follow_redirects=False) as client:
            # Probe API root to check if REST API is reachable at all
            try:
                pr = client.get(f"{base}/", headers=hdrs)
                pb = pr.text[:60].replace('\n', ' ')
                is_html = "DOCTYPE" in pb or "<html" in pb
                add(f"API probe GET /api/v1/  HTTP {pr.status_code}  "
                    f"{'HTML=REST-API-not-here' if is_html else pb!r}", None)
            except Exception as pe:
                add(f"API probe  ERROR {str(pe)[:60]}", None)

            # ── Step 1: load the root page to pick up any session/CSRF cookies ──
            import base64 as _b64
            try:
                gr = client.get(f"{root}/", headers=hdrs)
                page_cookies = dict(client.cookies)
                csrf = (page_cookies.get("csrftoken") or
                        page_cookies.get("CSRF-TOKEN") or
                        page_cookies.get("_csrf") or "")
                add(f"GET /  HTTP {gr.status_code}  "
                    f"cookies={list(page_cookies.keys())}  csrf={'YES' if csrf else 'NO'}", None)
            except Exception as ge:
                page_cookies = {}
                csrf = ""
                add(f"GET /  ERROR {str(ge)[:60]}", None)

            _oxhdrs = {
                **hdrs,
                "Origin":  root,
                "Referer": f"{root}/",
                "X-Requested-With": "XMLHttpRequest",
            }
            if csrf:
                _oxhdrs["X-CSRFToken"] = csrf

            # ── Step 2: try all login candidates with page session cookies ──
            _login_candidates = [
                (f"{base}/api/login", "json", _oxhdrs),   # /api/v1/api/login JSON+Origin+CSRF
                (f"{base}/api/login", "form", _oxhdrs),   # /api/v1/api/login form+Origin+CSRF
                (f"{root}/api/login", "json", _oxhdrs),   # /api/login        JSON+Origin+CSRF
                (f"{root}/api/login", "form", _oxhdrs),   # /api/login        form+Origin+CSRF
            ]
            uid_token = ""
            login_ok  = False
            for login_url, fmt, req_hdrs in _login_candidates:
                kwargs = ({"data": {"uid": req.user, "passwd": req.password}}
                          if fmt == "form" else
                          {"json": {"uid": req.user, "passwd": req.password}})
                try:
                    lr = client.post(login_url, **kwargs, headers=req_hdrs)
                except Exception as le:
                    add(f"Login {login_url.replace(root,'')} [{fmt}]  ERROR {str(le)[:60]}", None)
                    continue
                try: _lb = lr.json() or {}
                except ValueError: _lb = {}
                uid = (_lb.get("UIDARUBA") or
                       lr.cookies.get("UIDARUBA") or
                       client.cookies.get("UIDARUBA") or "")
                body_s = lr.text[:80].replace('\n', ' ')
                path_s = login_url.replace(root, "")
                add(f"Login {path_s} [{fmt}]  HTTP {lr.status_code}  "
                    f"UIDARUBA={'YES' if uid else 'NO'}  body={body_s!r}",
                    True if uid else None)
                if uid:
                    uid_token = uid
                    login_ok  = True
                    break

            # ── Step 3: probe REST API with GET requests (no auth) ──
            for probe_path in [
                "configuration/showcommand?command=show+version",
                "monitor/ap_details",
            ]:
                try:
                    pr2 = client.get(f"{base}/{probe_path}", headers=hdrs)
                    body_s = pr2.text[:80].replace('\n', ' ')
                    is_html = "DOCTYPE" in body_s or "<html" in body_s
                    add(f"GET {probe_path.split('?')[0]}  HTTP {pr2.status_code}  "
                        f"{'HTML' if is_html else body_s!r}",
                        None if is_html else (True if pr2.status_code < 400 else None))
                except Exception as pe2:
                    add(f"GET {probe_path.split('?')[0]}  ERROR {str(pe2)[:60]}", None)

            # ── Step 4: try Basic Auth on known REST endpoint ──
            basic = _b64.b64encode(f"{req.user}:{req.password}".encode()).decode()
            try:
                br = client.get(f"{base}/configuration/showcommand",
                                params={"command": "show version"},
                                headers={**hdrs, "Authorization": f"Basic {basic}"})
                body_s = br.text[:80].replace('\n', ' ')
                is_html = "DOCTYPE" in body_s or "<html" in body_s
                add(f"Basic-Auth showcommand(show version)  HTTP {br.status_code}  "
                    f"{'HTML' if is_html else body_s!r}",
                    True if (not is_html and br.status_code < 400) else None)
            except Exception as be:
                add(f"Basic-Auth showcommand  ERROR {str(be)[:60]}", None)

            if not login_ok:
                return {"steps": steps, "ok": False,
                        "summary": "Authentication failed — no login path returned UIDARUBA"}

            ap_count = 0
            ap_ok = False
            try:
                for path, key, extra in _AP_PROBE:
                    params = dict(extra)
                    if uid_token:
                        params["UIDARUBA"] = uid_token
                    ap_r = client.get(f"{base}/{path}", params=params or None,
                                      headers=hdrs)
                    code = ap_r.status_code
                    name = _short(path, extra)

                    if code in (400, 401, 403, 404, 405, 501):
                        add(f"{name}  HTTP {code}  skipped", None)
                        continue

                    if not ap_r.content:
                        add(f"{name}  HTTP {code}  empty body", None)
                        ap_ok = True
                        break

                    try:
                        body = ap_r.json()
                        aps = None
                        for k in (key, "_data"):
                            v = body.get(k)
                            if v is None: continue
                            if _isal(v): aps = v; break
                            if isinstance(v, dict):
                                for inner in v.values():
                                    if _isal(inner): aps = inner; break
                            if aps is not None: break
                        if aps is None:
                            for val in body.values():
                                if _isal(val): aps = val; break
                        if aps is not None:
                            add(f"{name}  HTTP {code}  {len(aps)} APs", True)
                            ap_count = len(aps)
                            ap_ok = True
                            break
                        else:
                            keys_str = " ".join(list(body.keys())[:6])
                            add(f"{name}  HTTP {code}  keys:{keys_str}", None)
                    except ValueError:
                        snip = ap_r.text[:60].replace('\n', ' ')
                        add(f"{name}  HTTP {code}  non-JSON: {snip!r}", None)

                if not ap_ok:
                    add("AP data  ALL ENDPOINTS FAILED", False)
            finally:
                try:
                    p = {"UIDARUBA": uid_token} if uid_token else {}
                    client.get(f"{base}/api/logout", params=p or None)
                except Exception:
                    pass

        ok = ap_ok
        summary = (f"Connected — {ap_count} AP(s)" if ap_ok and ap_count
                   else "Connected — controller online (no APs registered)" if ap_ok
                   else "Logged in but no AP endpoint returned data")
        return {"steps": steps, "ok": ok, "summary": summary}

    except Exception as e:
        add(f"Connection error: {str(e)[:120]}", False)
        return {"steps": steps, "ok": False, "summary": _friendly(e)}


# ── SIEM test ─────────────────────────────────────────────────────────────────

class SiemTestReq(BaseModel):
    push_url: str
    push_api_key: str = ""


@setup_router.post("/test/siem")
def test_siem(req: SiemTestReq):
    """Verify the SIEM push endpoint is reachable and accepts our auth token."""
    if not req.push_url:
        return {"ok": False, "message": "No push URL configured"}
    try:
        headers: dict = {"Content-Type": "application/json"}
        if req.push_api_key:
            headers["Authorization"] = f"Bearer {req.push_api_key}"
        with httpx.Client(timeout=10, verify=False) as client:
            # First try the health endpoint; fall back to a zero-event ingest batch
            url = req.push_url.rstrip("/")
            try:
                resp = client.get(f"{url}/health", headers=headers)
                resp.raise_for_status()
                return {"ok": True, "message": f"SIEM endpoint reachable — {url}/health returned {resp.status_code}"}
            except httpx.HTTPStatusError:
                raise
            except Exception:
                pass
            resp = client.post(f"{url}/api/ingest/batch", json=[], headers=headers)
            resp.raise_for_status()
            return {"ok": True, "message": f"SIEM ingest endpoint reachable at {url}"}
    except Exception as e:
        return {"ok": False, "message": _friendly(e)}
