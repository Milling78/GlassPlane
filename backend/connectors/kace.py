"""
KACE SMA (Systems Management Appliance) service desk connector.
Authenticates via session login, fetches open tickets from the two configured
queues (helpdesk and engineering), and groups them by category.
"""

import logging
import ssl
from collections import defaultdict

import httpx

from config import get_settings
from models.schemas import (
    KACETicket, KACETicketGroup, KACEQueueSummary, KACESummary, HealthStatus,
)

logger = logging.getLogger(__name__)

# Status names considered "closed" — tickets with these are excluded from the feed
_CLOSED_STATUSES = frozenset({
    "closed", "resolved", "cancelled", "canceled", "complete", "completed",
    "solved", "archived", "rejected",
})

# Priority normalisation → "high" | "medium" | "low"
def _norm_priority(raw: str) -> str:
    r = raw.lower()
    if any(x in r for x in ("high", "critical", "urgent", "1")):
        return "high"
    if any(x in r for x in ("medium", "normal", "moderate", "2")):
        return "medium"
    return "low"


def _extract_name(field) -> str:
    if isinstance(field, dict):
        return field.get("name") or field.get("email") or str(field.get("id", ""))
    return str(field) if field else ""


def _is_open(ticket: dict) -> bool:
    status_raw = ticket.get("status") or {}
    name = _extract_name(status_raw).lower() if isinstance(status_raw, dict) else str(status_raw).lower()
    return name not in _CLOSED_STATUSES


def _parse_ticket(t: dict) -> KACETicket:
    priority_raw = _extract_name(t.get("priority") or "Low") or "Low"
    category_raw = _extract_name(t.get("category") or "") or "Uncategorized"
    status_raw   = _extract_name(t.get("status")   or "")
    submitter_raw = _extract_name(t.get("submitter") or "")
    owner_raw    = _extract_name(t.get("owner") or "")

    return KACETicket(
        id=int(t.get("id", 0)),
        title=str(t.get("title") or "").strip() or "(no title)",
        status=status_raw,
        priority=_norm_priority(priority_raw),
        category=category_raw,
        submitter=submitter_raw,
        owner=owner_raw,
        created=str(t.get("created") or "")[:19],
        modified=str(t.get("modified") or "")[:19],
    )


def _build_queue_summary(queue_id: int, queue_name: str, tickets: list[KACETicket]) -> KACEQueueSummary:
    # Group by category, sorted by group size desc then name
    bucket: dict[str, list[KACETicket]] = defaultdict(list)
    for t in tickets:
        bucket[t.category].append(t)

    groups: list[KACETicketGroup] = []
    for cat, ts in sorted(bucket.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        groups.append(KACETicketGroup(
            category=cat,
            count=len(ts),
            high_count=sum(1 for t in ts if t.priority == "high"),
            medium_count=sum(1 for t in ts if t.priority == "medium"),
            low_count=sum(1 for t in ts if t.priority == "low"),
            tickets=sorted(ts, key=lambda t: (
                0 if t.priority == "high" else 1 if t.priority == "medium" else 2,
                t.modified or "",
            ), reverse=True),
        ))

    return KACEQueueSummary(
        queue_id=queue_id,
        queue_name=queue_name,
        total=len(tickets),
        high_count=sum(1 for t in tickets if t.priority == "high"),
        medium_count=sum(1 for t in tickets if t.priority == "medium"),
        low_count=sum(1 for t in tickets if t.priority == "low"),
        groups=groups,
    )


class _KACESession:
    def __init__(self, client: httpx.Client, base: str):
        self.client = client
        self.base = base

    def get_queues(self) -> list[dict]:
        r = self.client.get(f"{self.base}/api/service_desk/queues")
        r.raise_for_status()
        return r.json().get("Queues", [])

    def get_tickets(self, queue_id: int, limit: int) -> list[dict]:
        params = {
            "paging": f"limit.{limit}.offset.0",
        }
        r = self.client.get(
            f"{self.base}/api/service_desk/queues/{queue_id}/tickets",
            params=params,
        )
        r.raise_for_status()
        data = r.json()
        # Response key may be "Tickets" or "tickets"
        return data.get("Tickets") or data.get("tickets") or []


def _make_ssl_ctx(ssl_verify: bool) -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_REQUIRED if ssl_verify else ssl.CERT_NONE
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1
    except (AttributeError, ssl.SSLError):
        pass
    try:
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
    except ssl.SSLError:
        pass
    # KACE appliance closes TLS without close_notify; suppress the resulting EOF error
    ctx.options |= getattr(ssl, "OP_IGNORE_UNEXPECTED_EOF", 0)
    return ctx


def _login(base: str, user: str, password: str, org: str, ssl_verify: bool) -> httpx.Client:
    client = httpx.Client(verify=_make_ssl_ctx(ssl_verify), timeout=15, follow_redirects=True)
    resp = client.post(
        f"{base}/ams/shared/api/security/login",
        json={"userName": user, "password": password, "organizationName": org},
        headers={"Content-Type": "application/json"},
    )
    resp.raise_for_status()
    # Accept both token-in-header and token-in-body patterns
    token = resp.headers.get("x-dell-auth-token") or (resp.json().get("UserToken") or {}).get("token")
    if token:
        client.headers["x-dell-auth-token"] = token
    return client


def fetch_kace_summary() -> KACESummary:
    s = get_settings()
    if not s.kace_host:
        return KACESummary(total_open=0, status=HealthStatus.UNKNOWN, error="KACE_HOST not configured")

    base = f"https://{s.kace_host}:{s.kace_port}"

    try:
        client = _login(base, s.kace_user, s.kace_password, s.kace_org, s.kace_ssl_verify)
    except Exception as e:
        logger.error(f"KACE login failed: {e}")
        return KACESummary(total_open=0, status=HealthStatus.CRITICAL, error=f"Login failed: {e}")

    try:
        session = _KACESession(client, base)

        # Resolve queue names → IDs
        try:
            queues = session.get_queues()
        except Exception as e:
            logger.error(f"KACE get_queues failed: {e}")
            return KACESummary(total_open=0, status=HealthStatus.CRITICAL, error=f"Could not fetch queues: {e}")

        queue_map = {q["name"].lower(): q for q in queues}

        def fetch_queue(name: str) -> KACEQueueSummary | None:
            if not name:
                return None
            meta = queue_map.get(name.lower())
            if not meta:
                logger.warning(f"KACE queue '{name}' not found (available: {list(queue_map.keys())})")
                return None
            qid = int(meta["id"])
            try:
                raw = session.get_tickets(qid, s.kace_ticket_limit)
            except Exception as e:
                logger.error(f"KACE tickets for queue {qid} failed: {e}")
                return None
            open_tickets = [_parse_ticket(t) for t in raw if _is_open(t)]
            return _build_queue_summary(qid, meta["name"], open_tickets)

        helpdesk   = fetch_queue(s.kace_helpdesk_queue)
        engineering = fetch_queue(s.kace_engineering_queue)

    finally:
        client.close()

    total = (helpdesk.total if helpdesk else 0) + (engineering.total if engineering else 0)

    high_total = (
        (helpdesk.high_count   if helpdesk   else 0) +
        (engineering.high_count if engineering else 0)
    )

    if high_total > 0:
        overall = HealthStatus.WARNING
    elif total > 0:
        overall = HealthStatus.OK
    else:
        overall = HealthStatus.OK

    return KACESummary(
        helpdesk=helpdesk,
        engineering=engineering,
        total_open=total,
        status=overall,
    )
