"""
DNS monitoring connector.
Queries each configured DNS server directly for reachability and response
time, then resolves each configured check-hostname against every server
to verify end-to-end resolution.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import dns.resolver
import dns.exception

from config import get_settings
from models.schemas import DNSServerResult, DNSRecordResult, DNSSummary, HealthStatus

logger = logging.getLogger(__name__)


def _check_server(server: str, check_hosts: list[str], timeout: float) -> tuple[DNSServerResult, list[DNSRecordResult]]:
    resolver = dns.resolver.Resolver(configure=False)
    resolver.nameservers = [server]
    resolver.timeout = timeout
    resolver.lifetime = timeout

    # Reachability: resolve a known-good name against this server
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

    # Per-hostname resolution checks against this server
    record_results: list[DNSRecordResult] = []
    for host in check_hosts:
        t0 = time.perf_counter()
        try:
            answers = resolver.resolve(host, "A")
            elapsed = round((time.perf_counter() - t0) * 1000, 1)
            addrs = [r.address for r in answers]
            record_results.append(DNSRecordResult(
                hostname=host, resolved=True, addresses=addrs, response_ms=elapsed,
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


def fetch_dns_summary() -> DNSSummary:
    s = get_settings()
    servers = [sv.strip() for sv in s.dns_servers.split(",") if sv.strip()]
    check_hosts = [h.strip() for h in s.dns_check_hosts.split(",") if h.strip()]

    server_results: list[DNSServerResult] = []
    # Aggregate record results across servers: worst status per hostname wins
    record_map: dict[str, DNSRecordResult] = {}

    with ThreadPoolExecutor(max_workers=min(len(servers) or 1, 8)) as ex:
        futures = {ex.submit(_check_server, sv, check_hosts, s.dns_timeout): sv for sv in servers}
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
                # Keep the failed result so any server failure surfaces
                if existing is None or (not r.resolved and existing.resolved):
                    record_map[r.hostname] = r

    server_results.sort(key=lambda r: r.server)
    records = [record_map[h] for h in check_hosts if h in record_map]

    reachable = sum(1 for r in server_results if r.reachable)
    failed_records = sum(1 for r in records if not r.resolved)

    if not server_results:
        overall = HealthStatus.UNKNOWN
    elif reachable == 0 or failed_records > 0:
        overall = HealthStatus.CRITICAL
    elif reachable < len(server_results):
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
