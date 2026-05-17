"""
TLS certificate monitoring connector.
Connects to each configured host, fetches the server certificate, and
returns CN, SANs, issuer, and days-to-expiry without validating trust.
"""

import logging
import socket
import ssl
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from cryptography import x509
from cryptography.x509.oid import ExtensionOID, NameOID

from config import get_settings
from models.schemas import CertResult, CertsSummary, HealthStatus

logger = logging.getLogger(__name__)


def _check_cert(host: str, port: int, timeout: float, warn_days: int, crit_days: int) -> CertResult:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                der = ssock.getpeercert(binary_form=True)
    except Exception as e:
        logger.warning(f"Cert check {host}:{port}: {e}")
        return CertResult(
            host=host, port=port,
            status=HealthStatus.CRITICAL,
            error=str(e)[:200],
        )

    try:
        cert = x509.load_der_x509_certificate(der)
    except Exception as e:
        return CertResult(
            host=host, port=port,
            status=HealthStatus.CRITICAL,
            error=f"Failed to parse certificate: {e}",
        )

    # CN
    cn_attrs = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
    cn = cn_attrs[0].value if cn_attrs else ""

    # SANs
    sans: list[str] = []
    try:
        san_ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
        for name in san_ext.value:
            if isinstance(name, x509.DNSName):
                sans.append(f"DNS:{name.value}")
            elif isinstance(name, x509.IPAddress):
                sans.append(f"IP:{name.value}")
            elif isinstance(name, x509.RFC822Name):
                sans.append(f"email:{name.value}")
    except x509.ExtensionNotFound:
        pass

    # Issuer (O then CN)
    issuer_o = cert.issuer.get_attributes_for_oid(NameOID.ORGANIZATION_NAME)
    issuer_cn = cert.issuer.get_attributes_for_oid(NameOID.COMMON_NAME)
    if issuer_o:
        issuer = issuer_o[0].value
    elif issuer_cn:
        issuer = issuer_cn[0].value
    else:
        issuer = cert.issuer.rfc4514_string()

    # Expiry
    not_after = cert.not_valid_after_utc
    now = datetime.now(timezone.utc)
    days_remaining = (not_after - now).days

    if days_remaining <= crit_days:
        status = HealthStatus.CRITICAL
    elif days_remaining <= warn_days:
        status = HealthStatus.WARNING
    else:
        status = HealthStatus.OK

    return CertResult(
        host=host,
        port=port,
        cn=cn,
        sans=sans,
        issuer=issuer,
        not_after=not_after.strftime("%Y-%m-%dT%H:%M:%SZ"),
        days_remaining=days_remaining,
        status=status,
    )


def fetch_certs_summary() -> CertsSummary:
    s = get_settings()
    entries = [h.strip() for h in s.cert_hosts.split(",") if h.strip()]

    targets: list[tuple[str, int]] = []
    for entry in entries:
        if ":" in entry:
            parts = entry.rsplit(":", 1)
            try:
                targets.append((parts[0], int(parts[1])))
            except ValueError:
                targets.append((entry, 443))
        else:
            targets.append((entry, 443))

    results: list[CertResult] = []

    if not targets:
        return CertsSummary(
            hosts=[], total=0, ok_count=0, warn_count=0, crit_count=0,
            status=HealthStatus.UNKNOWN,
        )

    with ThreadPoolExecutor(max_workers=min(len(targets), 8)) as ex:
        futures = {
            ex.submit(_check_cert, host, port, s.cert_timeout, s.cert_warn_days, s.cert_crit_days): (host, port)
            for host, port in targets
        }
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as e:
                host, port = futures[fut]
                logger.warning(f"Cert check {host}:{port} unexpected: {e}")
                results.append(CertResult(
                    host=host, port=port,
                    status=HealthStatus.CRITICAL,
                    error=f"Unexpected error: {e}",
                ))

    results.sort(key=lambda r: r.days_remaining if not r.error else -1)

    ok_count   = sum(1 for r in results if r.status == HealthStatus.OK)
    warn_count = sum(1 for r in results if r.status == HealthStatus.WARNING)
    crit_count = sum(1 for r in results if r.status == HealthStatus.CRITICAL)

    if crit_count > 0:
        overall = HealthStatus.CRITICAL
    elif warn_count > 0:
        overall = HealthStatus.WARNING
    else:
        overall = HealthStatus.OK

    return CertsSummary(
        hosts=results,
        total=len(results),
        ok_count=ok_count,
        warn_count=warn_count,
        crit_count=crit_count,
        status=overall,
    )
