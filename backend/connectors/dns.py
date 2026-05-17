"""
DNS monitoring connector.

Queries each configured DNS server for reachability and per-hostname resolution.
All configured integration hostnames (vCenter, Veeam, Alletra, KACE, iLO, Aruba)
are automatically included — no manual dns_check_hosts entry required.

When no DNS servers are configured the system resolver is used so integration
hosts are still checked.
"""

import logging
import socket as _socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import dns.resolver
import dns.exception

from config import get_settings
from models.schemas import DNSServerResult, DNSRecordResult, DNSSummary, HealthStatus

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_ip(host: str) -> bool:
    for family in (_socket.AF_INET, _socket.AF_INET6):
        try:
            _socket.inet_pton(family, host)
            return True
        except _socket.error:
            pass
    return False


def _integration_hosts(s) -> dict[str, str]:
    """Return {hostname: source_label} for every configured integration host, skipping IPs."""
    result: dict[str, str] = {}

    def _add(raw: str, label: str) -> None:
        for h in (raw or "").split(","):
            h = h.strip()
            if h and not _is_ip(h):
                result.setdefault(h, label)

    _add(s.vcenter_host,        "vCenter")
    _add(s.veeam_host,          "Veeam")
    _add(s.alletra_host,        "Alletra")
    _add(s.kace_host,           "KACE")
    _add(s.ilo_hosts,           "iLO")
    _add(s.aruba_wireless_host, "Aruba")
    _add(s.aruba_direct_hosts,  "Aruba")
    return result


def _resolve_system(hostname: str, timeout: float) -> DNSRecordResult:
    """Resolve via the OS/system resolver (used when no DNS servers are configured)."""
    t0 = time.perf_counter()
    try:
        infos = _socket.getaddrinfo(hostname, None)
        addrs = sorted({ai[4][0] for ai in infos})
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return DNSRecordResult(hostname=hostname, resolved=True, addresses=addrs, response_ms=elapsed)
    except _socket.gaierror as e:
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return DNSRecordResult(hostname=hostname, resolved=False, response_ms=elapsed, error=str(e)[:120])


# ── Per-server check ──────────────────────────────────────────────────────────

def _check_server(server: str, check_hosts: list[str], timeout: float) -> tuple[DNSServerResult, list[DNSRecordResult]]:
    resolver = dns.resolver.Resolver(configure=False)
    resolver.nameservers = [server]
    resolver.timeout = timeout
    resolver.lifetime = timeout

    start = time.perf_counter()
    try:
        resolver.resolve(".", "NS")
        ms = round((time.perf_counter() - start) * 1000, 1)
        server_result = DNSServerResult(server=server, reachable=True, response_ms=ms, status=HealthStatus.OK)
    except Exception as e:
        ms = round((time.perf_counter() - start) * 1000, 1)
        server_result = DNSServerResult(
            server=server, reachable=False, response_ms=ms,
            error=str(e)[:120], status=HealthStatus.CRITICAL,
        )

    record_results: list[DNSRecordResult] = []
    for host in check_hosts:
        t0 = time.perf_counter()
        try:
            answers = resolver.resolve(host, "A")
            elapsed = round((time.perf_counter() - t0) * 1000, 1)
            record_results.append(DNSRecordResult(
                hostname=host, resolved=True,
                addresses=[r.address for r in answers], response_ms=elapsed,
            ))
        except dns.resolver.NXDOMAIN:
            elapsed = round((time.perf_counter() - t0) * 1000, 1)
            record_results.append(DNSRecordResult(
                hostname=host, resolved=False, response_ms=elapsed,
                error="NXDOMAIN — name does not exist",
            ))
        except dns.exception.Timeout:
            elapsed = round((time.perf_counter() - t0) * 1000, 1)
            record_results.append(DNSRecordResult(
                hostname=host, resolved=False, response_ms=elapsed,
                error=f"Timeout after {timeout:.0f}s",
            ))
        except Exception as e:
            elapsed = round((time.perf_counter() - t0) * 1000, 1)
            record_results.append(DNSRecordResult(
                hostname=host, resolved=False, response_ms=elapsed,
                error=str(e)[:120],
            ))

    return server_result, record_results


# ── Public API ────────────────────────────────────────────────────────────────

def fetch_dns_summary() -> DNSSummary:
    s = get_settings()
    servers      = [sv.strip() for sv in s.dns_servers.split(",") if sv.strip()]
    manual_hosts = [h.strip()  for h  in s.dns_check_hosts.split(",") if h.strip()]
    integ_hosts  = _integration_hosts(s)   # {hostname: source_label}

    # Source map: integration label takes precedence if same hostname appears in both
    source_map: dict[str, str] = {h: "manual" for h in manual_hosts}
    source_map.update(integ_hosts)

    # Ordered unique host list: integration first, then manual-only additions
    all_hosts = list(integ_hosts.keys()) + [h for h in manual_hosts if h not in integ_hosts]

    server_results: list[DNSServerResult] = []
    record_map: dict[str, DNSRecordResult] = {}

    if servers:
        with ThreadPoolExecutor(max_workers=min(len(servers), 8)) as ex:
            futures = {ex.submit(_check_server, sv, all_hosts, s.dns_timeout): sv for sv in servers}
            for fut in as_completed(futures):
                sv = futures[fut]
                try:
                    srv_result, rec_results = fut.result()
                except Exception as e:
                    logger.warning(f"DNS check {sv}: {e}")
                    srv_result = DNSServerResult(
                        server=sv, reachable=False,
                        error=f"Unexpected error: {e}", status=HealthStatus.CRITICAL,
                    )
                    rec_results = []

                server_results.append(srv_result)
                for r in rec_results:
                    existing = record_map.get(r.hostname)
                    if existing is None or (not r.resolved and existing.resolved):
                        record_map[r.hostname] = r

    elif all_hosts:
        # No DNS servers configured — fall back to system resolver
        logger.debug("No DNS servers configured; using system resolver for integration hosts")
        with ThreadPoolExecutor(max_workers=min(len(all_hosts), 8)) as ex:
            futures_sys = {ex.submit(_resolve_system, h, s.dns_timeout): h for h in all_hosts}
            for fut in as_completed(futures_sys):
                h = futures_sys[fut]
                try:
                    record_map[h] = fut.result()
                except Exception as e:
                    record_map[h] = DNSRecordResult(hostname=h, resolved=False, error=str(e)[:120])

    # Build ordered record list with source labels assigned
    records: list[DNSRecordResult] = []
    for h in all_hosts:
        if h in record_map:
            r = record_map[h]
            r.source = source_map.get(h, "manual")
            records.append(r)

    server_results.sort(key=lambda r: r.server)

    reachable      = sum(1 for r in server_results if r.reachable)
    failed_records = sum(1 for r in records if not r.resolved)

    if not server_results and not records:
        overall = HealthStatus.UNKNOWN
    elif failed_records > 0 or (server_results and reachable == 0):
        overall = HealthStatus.CRITICAL
    elif server_results and reachable < len(server_results):
        overall = HealthStatus.WARNING
    else:
        overall = HealthStatus.OK

    return DNSSummary(
        servers=server_results,
        records=records,
        server_count=len(server_results),
        reachable_count=reachable,
        failed_records=failed_records,
        status=overall,
    )
