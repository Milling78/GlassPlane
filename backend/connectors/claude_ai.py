"""
Anthropic Claude connector — AI-powered infrastructure pattern analysis.
Streams response tokens via Server-Sent Events so the UI can render as they arrive.
"""

import json
import logging
from typing import Generator, Optional

import anthropic

from config import get_settings

logger = logging.getLogger(__name__)

# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM = """\
You are an AI infrastructure analyst embedded in Infra Glassplane, a monitoring dashboard \
for a mid-size law firm's on-premises IT environment.

Your environment includes:
- VMware vCenter: virtual machines, clusters, ESXi hosts
- HPE Alletra 6000 (Nimble Storage): primary SAN storage array
- HPE iLO / Redfish: physical server health and power monitoring
- Aruba networking: managed switches and wireless controllers
- Veeam Backup & Replication: VM backup and restore jobs
- TLS certificate monitoring across internal and external services
- KACE SMA: helpdesk and engineering ticketing

Your role is to identify:
- **Patterns** — cyclic resource usage, recurring failures, consistent trends
- **Anomalies** — outliers, unexpected behavior, health degradation
- **Risks** — capacity thresholds approaching, certs expiring, jobs failing
- **Optimization opportunities** — idle/oversized VMs, wasted resources, storage inefficiency

Response guidelines:
- Be specific — always name the affected VMs, hosts, or volumes with their metrics
- Quantify findings (e.g., "8 of 140 powered-on VMs are idle, consuming ~64 GB RAM")
- Prioritize by impact: critical risks first, then quick wins, then long-term optimizations
- Use markdown headers (##) and bullets (-) for readability
- Provide actionable next steps, not just observations

Current infrastructure snapshot:
{snapshot}
"""


def _snapshot_text(snapshot: Optional[dict]) -> str:
    if not snapshot:
        return "(no snapshot provided — ask the user to share their infrastructure data)"
    try:
        return json.dumps(snapshot, indent=2, default=str)
    except Exception:
        return str(snapshot)


# ── Streaming generator ───────────────────────────────────────────────────────

def stream_analysis(
    messages: list[dict],
    snapshot: Optional[dict] = None,
) -> Generator[str, None, None]:
    """
    Yields SSE-formatted strings.
    Each data chunk: ``data: {"text": "..."}\\n\\n``
    Terminal marker:  ``data: [DONE]\\n\\n``
    """
    settings = get_settings()

    if not settings.anthropic_api_key:
        yield 'data: {"text": "No Anthropic API key configured. Add ANTHROPIC_API_KEY to your .env or Settings."}\n\n'
        yield "data: [DONE]\n\n"
        return

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    system = _SYSTEM.format(snapshot=_snapshot_text(snapshot))

    try:
        with client.messages.stream(
            model=settings.claude_model,
            max_tokens=4096,
            system=system,
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'text': text})}\n\n"

    except anthropic.AuthenticationError:
        yield 'data: {"text": "Invalid Anthropic API key — check ANTHROPIC_API_KEY in Settings."}\n\n'
    except anthropic.RateLimitError:
        yield 'data: {"text": "Anthropic rate limit reached. Please wait a moment and retry."}\n\n'
    except anthropic.APIStatusError as e:
        logger.warning(f"Anthropic API error {e.status_code}: {e.message}")
        yield f'data: {json.dumps({"text": f"Anthropic API error {e.status_code}: {e.message}"})}\n\n'
    except Exception as e:
        logger.error(f"Claude stream error: {e}", exc_info=True)
        yield f'data: {json.dumps({"text": f"Unexpected error: {e}"})}\n\n'

    yield "data: [DONE]\n\n"
