from datetime import datetime, timezone

import httpx

_SEVERITY_RANK = {"critical": 3, "warning": 2, "info": 1, "ok": 0}
_SEVERITY_COLOR = {"critical": "FF4444", "warning": "FF9900", "info": "3B82F6", "ok": "22C55E"}


def _worst(alerts: list[dict]) -> str:
    return max((a.get("severity", "warning") for a in alerts), key=lambda s: _SEVERITY_RANK.get(s, 0))


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _teams(alerts: list[dict], event: str) -> dict:
    resolved = event == "resolved"
    title = "✅ Resolved" if resolved else "🚨 Infrastructure Alert"
    color = "22C55E" if resolved else _SEVERITY_COLOR.get(_worst(alerts), "FF9900")
    return {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": color,
        "summary": title,
        "sections": [{
            "activityTitle": title,
            "activitySubtitle": _ts(),
            "facts": [{"name": a["system"], "value": a["message"]} for a in alerts],
        }],
    }


def _slack(alerts: list[dict], event: str) -> dict:
    resolved = event == "resolved"
    header = "✅ Resolved" if resolved else "🚨 Infrastructure Alert"
    fields = [{"type": "mrkdwn", "text": f"*{a['system']}*\n{a['message']}"} for a in alerts]
    return {
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": header}},
            {"type": "section", "fields": fields[:10]},
            {"type": "context", "elements": [{"type": "mrkdwn", "text": f"_{_ts()}_"}]},
        ]
    }


def _generic(alerts: list[dict], event: str) -> dict:
    return {
        "event": event,
        "severity": _worst(alerts),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "alerts": [{"system": a["system"], "message": a["message"], "severity": a.get("severity", "warning")} for a in alerts],
    }


def send_webhook(url: str, fmt: str, alerts: list[dict], event: str = "alert") -> None:
    payload = {"teams": _teams, "slack": _slack}.get(fmt, _generic)(alerts, event)
    with httpx.Client(timeout=10) as client:
        client.post(url, json=payload).raise_for_status()
