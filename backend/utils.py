import socket
import ssl


def friendly_error(exc: Exception) -> str:
    """Translate low-level network exceptions into actionable messages."""
    msg = str(exc)
    low = msg.lower()

    # DNS resolution failures  (errno 11001 on Windows, -2/-3 on Linux)
    if isinstance(exc, socket.gaierror) or "getaddrinfo" in low or "nodename nor servname" in low:
        # Try to pull the hostname out of the exception message
        host = _extract_host(msg)
        hint = f" '{host}'" if host else ""
        return (
            f"Cannot resolve hostname{hint}. "
            "Check the host setting — use a fully-qualified name or an IP address."
        )

    # Connection refused
    if "connection refused" in low or (hasattr(exc, "errno") and getattr(exc, "errno", None) in (111, 10061)):
        return "Connection refused. Verify the service is running and the port is correct."

    # Timeout
    if "timed out" in low or "timeout" in low or "connect timeout" in low:
        return "Connection timed out. Check the hostname/IP and firewall rules."

    # SSL / TLS errors
    if isinstance(exc, ssl.SSLError) or "ssl" in low or "tls" in low or "certificate" in low:
        return f"SSL/TLS error: {msg}. Try disabling SSL verification in Settings."

    # HTTP 401 / 403 surfaced as text
    if "401" in msg or "unauthorized" in low:
        return "Authentication failed (401). Check the username and password in Settings."
    if "403" in msg or "forbidden" in low:
        return "Access denied (403). The account may lack API permissions."

    # HTTP 404 — wrong base URL or API version
    if "404" in msg:
        return f"Endpoint not found (404). The host or port may be wrong: {msg}"

    return msg


def _extract_host(msg: str) -> str:
    """Best-effort extraction of a hostname from a socket error string."""
    # httpx wraps as: "... while connecting to ('hostname', port)"
    import re
    m = re.search(r"connecting to \('([^']+)'", msg)
    if m:
        return m.group(1)
    # getaddrinfo failed: "[Errno 11001] getaddrinfo failed" has no host embedded,
    # but httpx ConnectError often includes it in the message chain
    m = re.search(r"host[=: ]+([^\s,'\")]+)", msg, re.IGNORECASE)
    if m:
        return m.group(1)
    return ""
