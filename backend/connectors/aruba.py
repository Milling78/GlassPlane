"""
Aruba Central connector — uses the Aruba Central REST API v2.
Pulls switch inventory, port utilisation, and identifies unused ports.
Docs: https://developer.arubanetworks.com/aruba-central/reference
"""

import logging
from typing import Any

import httpx

from config import get_settings
from models.schemas import Switch, SwitchPort, ArubaSummary, AccessPoint, WirelessSummary, HealthStatus

logger = logging.getLogger(__name__)

UNUSED_PORT_RX_THRESHOLD = 1.0   # ports with <1% RX util considered unused


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _get_access_token(client: httpx.Client, settings) -> str:
    """
    Exchange client credentials for an access token.
    Falls back to the static ARUBA_ACCESS_TOKEN if OAuth is not configured.
    """
    if settings.aruba_access_token:
        return settings.aruba_access_token

    resp = client.post(
        f"{settings.aruba_central_base_url}/oauth2/token",
        data={
            "client_id": settings.aruba_client_id,
            "client_secret": settings.aruba_client_secret,
            "grant_type": "client_credentials",
            "customer_id": settings.aruba_customer_id,
        }
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _fetch_switches(client: httpx.Client, base_url: str, token: str) -> list[dict]:
    items: list[dict] = []
    offset = 0
    while True:
        resp = client.get(
            f"{base_url}/monitoring/v1/switches",
            headers=_headers(token),
            params={"limit": 1000, "offset": offset},
        )
        resp.raise_for_status()
        data  = resp.json()
        batch = data.get("switches", [])
        items.extend(batch)
        if len(items) >= data.get("total", len(items)) or not batch:
            break
        offset += len(batch)
    return items


def _fetch_switch_ports(client: httpx.Client, base_url: str, token: str, serial: str) -> list[dict]:
    resp = client.get(
        f"{base_url}/monitoring/v1/switches/{serial}/ports",
        headers=_headers(token),
    )
    resp.raise_for_status()
    return resp.json().get("port_details", [])


def _map_status(status: str) -> HealthStatus:
    mapping = {"Up": HealthStatus.OK, "Down": HealthStatus.CRITICAL}
    return mapping.get(status, HealthStatus.UNKNOWN)


def _fetch_aps(client: httpx.Client, base_url: str, token: str) -> list[dict]:
    items: list[dict] = []
    offset = 0
    while True:
        resp = client.get(
            f"{base_url}/monitoring/v1/aps",
            headers=_headers(token),
            params={"limit": 1000, "offset": offset},
        )
        resp.raise_for_status()
        data  = resp.json()
        batch = data.get("aps", [])
        items.extend(batch)
        if len(items) >= data.get("total", len(items)) or not batch:
            break
        offset += len(batch)
    return items


def fetch_aruba_wireless() -> WirelessSummary:
    settings = get_settings()
    with httpx.Client(base_url=settings.aruba_central_base_url, verify=False, timeout=30) as client:
        token   = _get_access_token(client, settings)
        raw_aps = _fetch_aps(client, settings.aruba_central_base_url, token)

    aps: list[AccessPoint] = []
    for ap in raw_aps:
        radios = ap.get("radios", [])
        ch_2g  = next((r.get("channel") for r in radios if r.get("band") == "2.4GHz"), None)
        ch_5g  = next((r.get("channel") for r in radios if r.get("band") == "5GHz"),   None)
        aps.append(AccessPoint(
            ap_id=ap.get("serial", ""),
            name=ap.get("name", ap.get("serial", "")),
            model=ap.get("model", ""),
            site=ap.get("site", ""),
            group=ap.get("group_name", ""),
            ip_address=ap.get("ip_address", ""),
            status=_map_status(ap.get("status", "")),
            client_count=int(ap.get("client_count", 0)),
            uptime_seconds=int(ap.get("uptime", 0)),
            radio_count=len(radios),
            channel_2g=ch_2g,
            channel_5g=ch_5g,
        ))

    online  = sum(1 for a in aps if a.status == HealthStatus.OK)
    offline = len(aps) - online
    overall = HealthStatus.CRITICAL if offline > 0 else HealthStatus.OK if aps else HealthStatus.UNKNOWN

    return WirelessSummary(
        ap_count=len(aps),
        online_count=online,
        offline_count=offline,
        total_clients=sum(a.client_count for a in aps),
        aps=sorted(aps, key=lambda a: (-a.client_count, a.name)),
        status=overall,
    )


def fetch_aruba_summary() -> ArubaSummary:
    settings = get_settings()

    with httpx.Client(
        base_url=settings.aruba_central_base_url,
        verify=False,
        timeout=30
    ) as client:
        token = _get_access_token(client, settings)
        raw_switches = _fetch_switches(client, settings.aruba_central_base_url, token)

        switches: list[Switch] = []
        total_ports = 0
        total_unused = 0

        for sw in raw_switches:
            serial = sw.get("serial", "")
            raw_ports = _fetch_switch_ports(
                client, settings.aruba_central_base_url, token, serial
            )

            ports: list[SwitchPort] = []
            for p in raw_ports:
                rx_util = float(p.get("rx_usage", 0))
                tx_util = float(p.get("tx_usage", 0))
                unused = rx_util < UNUSED_PORT_RX_THRESHOLD and tx_util < UNUSED_PORT_RX_THRESHOLD
                ports.append(SwitchPort(
                    port_id=p.get("port", ""),
                    name=p.get("port", ""),
                    speed_mbps=int(p.get("speed", 1000)),
                    rx_util_pct=round(rx_util, 1),
                    tx_util_pct=round(tx_util, 1),
                    is_unused=unused
                ))

            unused_count = sum(1 for p in ports if p.is_unused)
            total_ports += len(ports)
            total_unused += unused_count

            switches.append(Switch(
                device_id=serial,
                name=sw.get("name", serial),
                model=sw.get("model", ""),
                site=sw.get("site", ""),
                uptime_seconds=int(sw.get("uptime", 0)),
                port_count=len(ports),
                unused_ports=unused_count,
                cpu_util_pct=round(float(sw.get("cpu_utilization", 0)), 1),
                mem_util_pct=round(float(sw.get("mem_utilization", 0)), 1),
                status=_map_status(sw.get("status", "")),
                ports=ports
            ))

        unused_pct = (total_unused / total_ports * 100) if total_ports else 0
        overall = HealthStatus.CRITICAL if any(
            s.status == HealthStatus.CRITICAL for s in switches
        ) else HealthStatus.OK

        return ArubaSummary(
            switch_count=len(switches),
            total_ports=total_ports,
            unused_ports=total_unused,
            unused_port_pct=round(unused_pct, 1),
            switches=switches,
            status=overall
        )
