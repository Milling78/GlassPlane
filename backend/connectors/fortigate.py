"""
FortiGate firewall connector — FortiOS REST API v2.
Auth: Bearer token (System → Administrators → REST API Admin).
Endpoints hit: system/status, resource/usage, ha, vpn/ipsec, vpn/ssl, interface.
"""

import logging
import ssl
from typing import Any

import httpx

from config import get_settings
from models.schemas import (
    FortiGateSummary, FortiGateInterface, FortiGateVPNTunnel,
    FortiGateSSLSession, HealthStatus,
)

logger = logging.getLogger(__name__)


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _client(s) -> httpx.Client:
    verify = s.fortigate_ssl_verify if s.fortigate_ssl_verify else _ssl_ctx()
    return httpx.Client(
        base_url=f"https://{s.fortigate_host}:{s.fortigate_port}",
        headers={
            "Authorization": f"Bearer {s.fortigate_token}",
            "Accept": "application/json",
        },
        verify=verify,
        timeout=20.0,
    )


def _get(client: httpx.Client, path: str, vdom: str) -> dict:
    resp = client.get(path, params={"vdom": vdom})
    resp.raise_for_status()
    data = resp.json()
    # FortiOS wraps responses in {"results": ..., "status": "success"}
    return data


def _safe(data: dict, *keys, default=None):
    """Safe nested dict accessor."""
    for k in keys:
        if not isinstance(data, dict):
            return default
        data = data.get(k, default)
    return data


def fetch_fortigate_summary() -> FortiGateSummary:
    s = get_settings()
    if not s.fortigate_host or not s.fortigate_token:
        return FortiGateSummary(
            hostname="unconfigured",
            status=HealthStatus.UNKNOWN,
        )

    vdom = s.fortigate_vdom or "root"

    with _client(s) as client:
        # ── System status ────────────────────────────────────────────────────
        hostname = "unknown"
        firmware = ""
        serial = None
        try:
            data = _get(client, "/api/v2/monitor/system/status", vdom)
            r = data.get("results", data)
            hostname = r.get("hostname") or r.get("system info", {}).get("hostname", "unknown")
            firmware = r.get("version") or r.get("system info", {}).get("version", "")
            serial = r.get("serial") or r.get("system info", {}).get("serial-number")
        except Exception as e:
            logger.warning(f"FortiGate system/status failed: {e}")

        # ── Resource usage (cpu, mem, sessions) ──────────────────────────────
        cpu_pct = None
        mem_pct = None
        session_count = None
        try:
            data = _get(client, "/api/v2/monitor/system/resource/usage", vdom)
            results = data.get("results", {})
            cpu_list = results.get("cpu", [])
            if cpu_list:
                # first entry is overall CPU, subsequent are per-core
                cpu_pct = float(cpu_list[0].get("current", 0))
            mem_data = results.get("mem", [{}])
            if mem_data:
                mem_pct = float(mem_data[0].get("current", 0))
            sess_data = results.get("session", [{}])
            if sess_data:
                session_count = int(sess_data[0].get("current", 0))
        except Exception as e:
            logger.warning(f"FortiGate resource/usage failed: {e}")

        # ── HA ───────────────────────────────────────────────────────────────
        ha_mode = "standalone"
        ha_peers = 0
        try:
            data = _get(client, "/api/v2/cmdb/system/ha", vdom)
            results = data.get("results", data)
            mode = results.get("mode", "standalone")
            ha_mode = mode.lower() if mode else "standalone"
            if ha_mode not in ("standalone", ""):
                # try ha-statistics for peer count
                try:
                    ha_stat = _get(client, "/api/v2/monitor/system/ha-statistics", vdom)
                    peers = ha_stat.get("results", [])
                    ha_peers = max(0, len(peers) - 1)  # exclude self
                except Exception:
                    ha_peers = 1  # at least one peer in HA
        except Exception as e:
            logger.warning(f"FortiGate HA check failed: {e}")

        # ── IPsec VPN ────────────────────────────────────────────────────────
        vpn_tunnels: list[FortiGateVPNTunnel] = []
        try:
            data = _get(client, "/api/v2/monitor/vpn/ipsec", vdom)
            for t in data.get("results", []):
                status = "up" if t.get("proxyid", [{}])[0].get("status", "") == "up" if t.get("proxyid") else t.get("tun_status", "") == "up" else "down"
                # simpler: check tun_status at tunnel level
                tun_status = t.get("tun_status", "")
                if tun_status:
                    status = "up" if tun_status == "up" else "down"
                vpn_tunnels.append(FortiGateVPNTunnel(
                    name=t.get("name", ""),
                    remote_ip=t.get("rgwy") or t.get("remoteip"),
                    status=status,
                    incoming_bytes=t.get("incoming_bytes"),
                    outgoing_bytes=t.get("outgoing_bytes"),
                ))
        except Exception as e:
            logger.warning(f"FortiGate IPsec VPN failed: {e}")

        ipsec_up = sum(1 for t in vpn_tunnels if t.status == "up")
        ipsec_down = sum(1 for t in vpn_tunnels if t.status != "up")

        # ── SSL VPN ──────────────────────────────────────────────────────────
        ssl_sessions: list[FortiGateSSLSession] = []
        try:
            data = _get(client, "/api/v2/monitor/vpn/ssl", vdom)
            for sess in data.get("results", []):
                ssl_sessions.append(FortiGateSSLSession(
                    username=sess.get("user_name") or sess.get("username", ""),
                    source_ip=sess.get("remote_host") or sess.get("src_ip"),
                    duration_sec=sess.get("duration"),
                    rx_bytes=sess.get("incoming_bytes"),
                    tx_bytes=sess.get("outgoing_bytes"),
                ))
        except Exception as e:
            logger.warning(f"FortiGate SSL VPN failed: {e}")

        # ── Interfaces ───────────────────────────────────────────────────────
        interfaces: list[FortiGateInterface] = []
        try:
            data = _get(client, "/api/v2/monitor/system/interface", vdom)
            for iface in data.get("results", {}).values() if isinstance(data.get("results"), dict) else data.get("results", []):
                link = iface.get("link", False)
                status = "up" if link else "down"
                ip_mask = iface.get("ip", "")
                ip = ip_mask.split("/")[0] if "/" in ip_mask else ip_mask or None
                interfaces.append(FortiGateInterface(
                    name=iface.get("name", ""),
                    alias=iface.get("alias") or None,
                    ip=ip if ip else None,
                    status=status,
                    rx_bytes=iface.get("rx_bytes"),
                    tx_bytes=iface.get("tx_bytes"),
                    speed=iface.get("speed"),
                ))
        except Exception as e:
            logger.warning(f"FortiGate interfaces failed: {e}")

        # ── Overall health ───────────────────────────────────────────────────
        health = HealthStatus.OK
        if cpu_pct is not None:
            if cpu_pct >= s.fortigate_crit_cpu_pct:
                health = HealthStatus.CRITICAL
            elif cpu_pct >= s.fortigate_warn_cpu_pct:
                health = HealthStatus.WARNING
        if ipsec_down > 0 and health == HealthStatus.OK:
            health = HealthStatus.WARNING

        return FortiGateSummary(
            hostname=hostname,
            firmware_version=firmware,
            serial=serial,
            cpu_pct=cpu_pct,
            mem_pct=mem_pct,
            session_count=session_count,
            ha_mode=ha_mode,
            ha_peers=ha_peers,
            ipsec_tunnels_total=len(vpn_tunnels),
            ipsec_tunnels_up=ipsec_up,
            ipsec_tunnels_down=ipsec_down,
            ssl_sessions=len(ssl_sessions),
            interfaces=interfaces,
            vpn_tunnels=vpn_tunnels,
            ssl_vpn_sessions=ssl_sessions,
            status=health,
            vdom=vdom,
        )
