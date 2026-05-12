# Infrastructure Glassplane

Unified resource optimisation dashboard for:
- **VMware vCenter** — compute utilisation, idle & oversized VMs
- **Aruba Central** — switch inventory, port utilisation
- **HPE Alletra 6000** — storage capacity, efficiency, I/O
- **Veeam B&R** — backup job health, repository capacity

## Quick start

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env with your credentials

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API docs available at http://localhost:8000/docs

### API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/summary` | Unified glassplane summary + recommendations |
| `GET /api/vcenter` | vCenter compute data |
| `GET /api/aruba` | Aruba switch data |
| `GET /api/alletra` | Alletra 6000 storage data |
| `GET /api/veeam` | Veeam backup data |
| `GET /health` | Health check |

### Frontend (dashboard)

The `infra_glassplane_dashboard` React artifact runs in the browser.
Enter your FastAPI URL (e.g. `http://your-server:8000`) and click **connect**.

The dashboard also runs standalone with mock data — no backend required.

## Connector notes

### vCenter
Uses pyVmomi. Requires read-only role on vCenter. SSL verification disabled by default (set `VCENTER_SSL_VERIFY=true` for production).

### Aruba Central
Uses the Aruba Central REST API v1. Supports both static `ARUBA_ACCESS_TOKEN` and OAuth client credentials flow.

### HPE Alletra 6000
Uses the HPE Primera/Alletra WSAPI (port 8080). Same interface across Primera 600, Alletra 6000/9000. Requires `edit` or `browse` role.

### Veeam B&R
Uses Veeam REST API v1.1 (port 9419). Requires a local Veeam account with `Veeam Restore Operator` role minimum.

## Cache

All API responses are cached in-process for `CACHE_TTL_SECONDS` (default 60s) to avoid hammering your infrastructure APIs. The dashboard auto-refreshes every 60 seconds.

## Optimisation score

Scored 0–100 based on:
- Idle and oversized VM count
- Cluster CPU utilisation
- Unused switch port percentage
- Alletra utilisation band
- Veeam job failures and unprotected VMs
- Repository capacity headroom
