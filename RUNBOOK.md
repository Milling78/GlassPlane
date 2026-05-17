# Infra Glassplane — Operations Runbook

**Version:** 1.2.41  
**Platform:** Windows 10/11 (x64)  
**Audience:** Systems / Infrastructure Engineer

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Requirements](#2-requirements)
3. [Installation](#3-installation)
4. [First-Time Setup](#4-first-time-setup)
5. [Connector Reference](#5-connector-reference)
   - [VMware vCenter](#51-vmware-vcenter)
   - [HPE Alletra 6000 / Nimble](#52-hpe-alletra-6000--nimble-storage)
   - [Veeam Backup & Replication](#53-veeam-backup--replication)
   - [Aruba Central](#54-aruba-central)
   - [Aruba Direct Switches (AOS-CX / ProCurve)](#55-aruba-direct-switches-aos-cx--procurve)
   - [Aruba Wireless Controller](#56-aruba-wireless-controller)
   - [HPE iLO / Redfish](#57-hpe-ilo--redfish)
   - [Terminal Servers / RDS](#58-terminal-servers--rds)
   - [FortiGate](#59-fortigate)
   - [FortiAnalyzer](#510-fortianalyzer)
   - [MS Exchange](#511-ms-exchange)
   - [DNS Monitoring](#512-dns-monitoring)
   - [TLS Certificate Monitoring](#513-tls-certificate-monitoring)
   - [KACE SMA Service Desk](#514-kace-sma-service-desk)
   - [AI Insights (Claude)](#515-ai-insights-claude)
6. [Alerting](#6-alerting)
7. [Maintenance](#7-maintenance)
8. [Troubleshooting](#8-troubleshooting)
9. [Recovery Procedures](#9-recovery-procedures)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────┐
│         Infra Glassplane            │
│  ┌─────────────┐  ┌──────────────┐  │
│  │  Electron   │  │   Vite SPA   │  │
│  │  (wrapper)  │◄─│  (React UI)  │  │
│  └──────┬──────┘  └──────────────┘  │
│         │ IPC / HTTP localhost       │
│  ┌──────▼──────────────────────┐    │
│  │   FastAPI backend (.exe)    │    │
│  │   glassplane-backend.exe    │    │
│  │                             │    │
│  │  Connectors (one per system)│    │
│  │  SQLite  glassplane.db      │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
         │ HTTPS / WinRM / PS
         ▼
    Your infrastructure
```

**Key facts:**
- The backend is a single self-contained `.exe` (PyInstaller). No Python installation required.
- The `.env` config file lives at `%APPDATA%\Infra Glassplane\.env` on the host machine.
- The SQLite database (`glassplane.db`) is stored in the same `%APPDATA%` folder.
- All API calls from the UI go to `http://127.0.0.1:<dynamic port>` — nothing is exposed externally.
- Snapshots are taken every 15 minutes and retained for 30 days (configurable).

---

## 2. Requirements

### Host machine
| Requirement | Detail |
|---|---|
| OS | Windows 10/11 or Windows Server 2019/2022 |
| Architecture | x64 |
| RAM | 256 MB free (backend is lightweight) |
| Disk | 500 MB for install + ~50 MB/month for SQLite history |
| Network | Must reach every monitored system on its management port |
| Domain | Must be domain-joined for Exchange (Kerberos) and RDS (WinRM) connectors |

### Firewall / network access required from the GlassPlane host

| System | Protocol | Port |
|---|---|---|
| vCenter | HTTPS | 443 |
| Alletra / Nimble | HTTPS | 5392 |
| Veeam VBR | HTTPS | 9419 |
| HPE iLO | HTTPS | 443 |
| Aruba Central | HTTPS | 443 (outbound to cloud) |
| Aruba AOS-CX switches | HTTPS | 443 |
| Aruba AOS-CX (fallback SSH) | SSH | 22 |
| Aruba Wireless Controller | HTTPS | 4343 |
| FortiGate | HTTPS | 443 |
| FortiAnalyzer | HTTPS | 443 |
| MS Exchange | HTTP | 80 (Remote PS endpoint) |
| RDS Broker | WinRM/DCOM | 5985 / 135 |
| RDS Session Hosts | WinRM/DCOM | 5985 / 135 |
| DNS servers | UDP/TCP | 53 |
| Cert hosts | TLS | 443 (or custom) |
| KACE SMA | HTTPS | 443 |

---

## 3. Installation

1. Download `Infra Glassplane Setup x.x.xx.exe` from the GitHub releases page.
2. Run the installer. Per-user install (default) — no elevation required.
3. The installer places the app in `%LOCALAPPDATA%\Programs\Infra Glassplane\`.
4. A desktop shortcut and Start Menu entry are created automatically.
5. On first launch, the Setup Wizard runs automatically (see section 4).

### Silent / managed install
```
"Infra Glassplane Setup 1.2.41.exe" /S
```
Config can be pre-staged by dropping a `.env` file at `%APPDATA%\Infra Glassplane\.env` before first launch.

---

## 4. First-Time Setup

On first launch, the Setup Wizard appears automatically if no connectors are configured.

**Wizard flow:**
1. Set an **API key** — this is a shared secret that protects the local API. Use any strong random string (e.g. output of `[System.Web.Security.Membership]::GeneratePassword(32,4)` in PowerShell). Store it in your password manager.
2. Configure at least one connector (vCenter, Alletra, Veeam, or Aruba are recommended first).
3. Click **Save & Continue** — the wizard writes `%APPDATA%\Infra Glassplane\.env` and reloads the backend.

After setup, additional connectors can be added any time via **Settings** in the sidebar.

### Editing `.env` directly
In the app: sidebar → **Edit .env** button opens the file in Notepad.  
Or navigate to: `%APPDATA%\Infra Glassplane\.env`

After editing `.env` directly, go to **Settings → Save & Reload** to apply changes without restarting.

---

## 5. Connector Reference

Each connector is optional. Unconfigured connectors are silently skipped — they do not affect other connectors or the health score.

---

### 5.1 VMware vCenter

**What it monitors:** VM inventory, idle/oversized VMs, cluster CPU/RAM utilisation, ESXi host health, snapshots, recent events, per-VM CPU/RAM surge detection.

**Permissions required:** Read-only role at the vCenter root.

```
# vCenter
VCENTER_HOST=vcenter.domain.local
VCENTER_USER=svc-glassplane@vsphere.local
VCENTER_PASSWORD=<password>
VCENTER_PORT=443
VCENTER_SSL_VERIFY=False
```

**Create the service account:**
1. vSphere Client → Administration → Single Sign On → Users and Groups → Add user.
2. vSphere Client → Hosts and Clusters → right-click root → Add Permission → assign **Read-only** to the new user, propagate to children.

---

### 5.2 HPE Alletra 6000 / Nimble Storage

**What it monitors:** Array utilisation, IOPS, latency, dedup/compression ratios, volume list.

**Permissions required:** Any valid API user (read-only is sufficient; the default `guest` account works if enabled).

```
ALLETRA_HOST=alletra.domain.local
ALLETRA_USER=admin
ALLETRA_PASSWORD=<password>
ALLETRA_PORT=5392
```

**Notes:**
- Port 5392 is the Nimble/Alletra REST API port (not the GUI port 443).
- Self-signed certificates are accepted by default.

---

### 5.3 Veeam Backup & Replication

**What it monitors:** Job success/failure, protected vs. unprotected VMs, repository utilisation, session history.

**Permissions required:** Veeam REST API — account with **Veeam Backup Viewer** role (read-only).

```
VEEAM_HOST=veeam.domain.local
VEEAM_USER=svc-glassplane
VEEAM_PASSWORD=<password>
VEEAM_PORT=9419
```

**Create the service account:**
Veeam Console → Users and Roles → Add → Role: **Veeam Backup Viewer**.

---

### 5.4 Aruba Central

**What it monitors:** Switch inventory, port utilisation, unused port count, wireless AP count (via Central cloud API).

**Credentials required:** API client credentials or a long-lived access token.

```
ARUBA_CENTRAL_BASE_URL=https://apigw-prod2.central.arubanetworks.com
ARUBA_CLIENT_ID=<client_id>
ARUBA_CLIENT_SECRET=<client_secret>
ARUBA_CUSTOMER_ID=<customer_id>
ARUBA_ACCESS_TOKEN=<token>        # leave blank if using client_id/secret
```

**Generate credentials:** Aruba Central → Accounts → API Gateway → System Apps & Tokens → Add Token.

---

### 5.5 Aruba Direct Switches (AOS-CX / ProCurve)

**What it monitors:** Port state, VLAN membership, interface utilisation for switches not managed by Aruba Central.

**Authentication:** AOS-CX REST API (HTTPS) with username/password. Falls back automatically to SSH for older ProCurve switches.

```
ARUBA_DIRECT_HOSTS=10.0.0.1,10.0.0.2,sw-core.domain.local
ARUBA_DIRECT_USER=admin
ARUBA_DIRECT_PASSWORD=<password>
ARUBA_DIRECT_PORT=443
ARUBA_DIRECT_SSH_PORT=22
ARUBA_DIRECT_SSL_VERIFY=False
```

**Diagnostics:** Settings → AOS-CX Direct → **Diagnose** runs a step-by-step probe (TCP, TLS, login, data) and shows exactly where it fails.

---

### 5.6 Aruba Wireless Controller

**What it monitors:** Connected AP count for a standalone ArubaOS Mobility Controller (not managed by Central).

```
ARUBA_WIRELESS_HOST=mc.domain.local
ARUBA_WIRELESS_USER=admin
ARUBA_WIRELESS_PASSWORD=<password>
ARUBA_WIRELESS_PORT=4343
```

---

### 5.7 HPE iLO / Redfish

**What it monitors:** Server power (watts, % of cap), CPU/ambient temperature, IML error log, fan status, chassis health.

**Permissions required:** iLO user with **Read-Only** role.

```
ILO_HOSTS=ilo-srv01.domain.local,ilo-srv02.domain.local,10.0.0.5
ILO_USER=svc-glassplane
ILO_PASSWORD=<password>
ILO_PORT=443
ILO_SSL_VERIFY=False
ILO_HOST_MAP=10.0.0.5=esxi-srv03    # optional: map iLO IP to server name shown in vCenter
```

**ILO_HOST_MAP format:** `<ilo_ip_or_fqdn>=<display_name>` — comma-separated pairs. Used to correlate iLO power data with ESXi host names in the Hosts view.

---

### 5.8 Terminal Servers / RDS

**What it monitors:** Active/disconnected session counts per RDSH, CPU/RAM per host, session list with idle time, broker-reported load index.

**Authentication:** Windows credentials — must be a member of local **Administrators** group on each RDSH (or domain admin).

```
RDS_BROKER=rds-broker.domain.local   # RD Connection Broker FQDN
RDS_HOSTS=ts01.domain.local,ts02.domain.local   # used only if no broker
RDS_WARN_LOAD_PCT=75.0
RDS_CRIT_LOAD_PCT=90.0
```

**Two modes:**
- **Broker mode** (preferred): requires the **RemoteDesktop** PowerShell module (`RSAT-RDS-Tools` feature) installed on the GlassPlane machine. Provides richer data including load index.
- **Direct mode**: uses `qwinsta` + WMI/CIM per host. No RSAT required. Needs WinRM enabled on each RDSH.

**Enable WinRM on RDSH hosts (if not already enabled via GPO):**
```powershell
# Run on each RDSH, or via GPO
winrm quickconfig -q
Set-Item WSMan:\localhost\Client\TrustedHosts -Value "*" -Force
```

---

### 5.9 FortiGate

**What it monitors:** CPU/memory/session count, IPsec VPN tunnel status (up/down), SSL VPN active users, interface link state.

**Authentication:** REST API admin token — no username/password needed.

```
FORTIGATE_HOST=192.168.1.1
FORTIGATE_TOKEN=<api_token>
FORTIGATE_PORT=443
FORTIGATE_SSL_VERIFY=False
FORTIGATE_VDOM=root
FORTIGATE_WARN_CPU_PCT=70.0
FORTIGATE_CRIT_CPU_PCT=90.0
```

**Create the REST API token:**
FortiGate GUI → System → Administrators → Create New → **REST API Admin**.  
- Set **Trusted Hosts** to the GlassPlane machine IP.  
- Profile: **Read-only** (or a custom profile with read access to Monitor/System, VPN, Interface).  
- Copy the token immediately — it is not shown again.

---

### 5.10 FortiAnalyzer

**What it monitors:** Managed device connectivity (up/down per device), appliance disk/CPU/memory utilisation.

**Authentication:** Username and password for a read-only admin account.

```
FORTIANALYZER_HOST=192.168.1.2
FORTIANALYZER_USER=svc-glassplane
FORTIANALYZER_PASSWORD=<password>
FORTIANALYZER_PORT=443
FORTIANALYZER_SSL_VERIFY=False
FORTIANALYZER_ADOM=root
FORTIANALYZER_DISK_WARN_PCT=80.0
FORTIANALYZER_DISK_CRIT_PCT=90.0
```

**Create the service account:**
FAZ GUI → System Settings → Administrators → Create New.  
- Admin Profile: **Standard_User** (read-only is sufficient).  
- Trusted Hosts: set to GlassPlane machine IP for security.

**ADOM note:** If you use per-customer ADOMs, set `FORTIANALYZER_ADOM` to the name of the ADOM that contains your FortiGate devices. The default `root` works for most single-tenant deployments.

---

### 5.11 MS Exchange

**What it monitors:** Mailbox database mounted/dismounted state, database size and whitespace, DAG copy status and copy queue length, transport queue depths, server component states.

**Authentication:** Domain account with View-Only Organisation Management in Exchange.

```
EXCHANGE_SERVER=mail.domain.local
EXCHANGE_USER=svc-glassplane
EXCHANGE_PASSWORD=<password>
EXCHANGE_DOMAIN=CORP                 # NetBIOS domain name, not FQDN
EXCHANGE_TRANSPORT_WARN_QUEUE=50
EXCHANGE_TRANSPORT_CRIT_QUEUE=200
```

**Grant the minimum required role:**
```powershell
# Run in Exchange Management Shell
Add-RoleGroupMember "View-Only Organization Management" -Member svc-glassplane
```

**Prerequisites on the GlassPlane machine:**
- Must be **domain-joined** (Kerberos authentication to the Exchange PowerShell endpoint).
- WinRM must be able to reach `http://<EXCHANGE_SERVER>/PowerShell/` (port 80).
- No Exchange Management Tools installation required — GlassPlane uses implicit PowerShell remoting.

**`EXCHANGE_DOMAIN`** is the short (NetBIOS) domain name, e.g. `CORP` not `corp.domain.local`. Leave blank if using UPN-format usernames (`user@domain.com`).

---

### 5.12 DNS Monitoring

**What it monitors:** Reachability and response time of DNS servers; resolution of specified hostnames.

```
DNS_SERVERS=10.0.0.10,10.0.0.11
DNS_CHECK_HOSTS=vcenter.domain.local,mail.domain.local,dc01.domain.local
DNS_TIMEOUT=5.0
```

No credentials required. Uses standard UDP/TCP DNS queries.

---

### 5.13 TLS Certificate Monitoring

**What it monitors:** Days until expiry, issuer, CN, SANs for any HTTPS endpoint. Warns at 30 days, critical at 14 days (configurable).

```
CERT_HOSTS=mail.domain.local,vcenter.domain.local:443,alletra.domain.local:5392
CERT_WARN_DAYS=30
CERT_CRIT_DAYS=14
CERT_TIMEOUT=10.0
```

**Format:** `hostname` or `hostname:port`. Default port is 443 if omitted. Internal self-signed certs are supported — GlassPlane connects and reads the cert without verifying the chain.

---

### 5.14 KACE SMA Service Desk

**What it monitors:** Open ticket counts per queue, grouped by category and priority.

**Authentication:** KACE local or LDAP account with read access to the queues.

```
KACE_HOST=kace.domain.local
KACE_USER=svc-glassplane
KACE_PASSWORD=<password>
KACE_ORG=Default
KACE_PORT=443
KACE_SSL_VERIFY=False
KACE_HELPDESK_QUEUE=Helpdesk
KACE_ENGINEERING_QUEUE=Engineering
KACE_TICKET_LIMIT=500
```

**`KACE_ORG`**: the Organisation name as shown in KACE SMA (case-sensitive). Default is `Default`.  
**`KACE_HELPDESK_QUEUE` / `KACE_ENGINEERING_QUEUE`**: exact queue names as configured in KACE. GlassPlane pulls these two queues into separate panels. Set both to the same name if you only have one queue.

---

### 5.15 AI Insights (Claude)

**What it monitors:** Not a live connector — provides on-demand AI analysis of all collected metrics in the Insights view.

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```

**Get an API key:** console.anthropic.com → API Keys → Create Key.  
Leave blank to disable AI Insights. All other views function normally without it.

---

## 6. Alerting

GlassPlane can POST webhook alerts to Microsoft Teams, Slack, or a generic JSON endpoint.

```
WEBHOOK_URL=https://outlook.office.com/webhook/...   # or Slack incoming webhook
WEBHOOK_FORMAT=teams                                  # teams | slack | generic
ALERT_INTERVAL_SECONDS=300                            # check every 5 minutes
```

### What triggers alerts

| System | Trigger |
|---|---|
| vCenter | Idle VM count ≥ threshold; oversized VM count ≥ threshold; cluster CPU < low% |
| Aruba | Unused port % ≥ threshold |
| Alletra | Utilisation > high% or < low%; efficiency ratio < minimum |
| Veeam | Failed jobs ≥ threshold; unprotected VMs ≥ threshold; repo util > threshold |
| iLO | Power > cap%; IML error count ≥ threshold |
| FortiGate | CPU ≥ warn/crit threshold; IPsec tunnel down |
| Exchange | Database dismounted; transport queue > crit threshold |
| FortiAnalyzer | Disk ≥ warn/crit threshold; device disconnected |

### Thresholds

All thresholds are set in `.env` (see config) or via **Settings → Alerts** in the UI.

### Alert history

Sidebar → **Alerts** → History tab shows the last 100 fired alerts with timestamp and message.  
To trigger an immediate check: Alerts → **Run Check Now**.

---

## 7. Maintenance

### Applying updates

1. Download the new installer from GitHub Releases.
2. Run the installer over the existing installation — it upgrades in place.
3. The `.env` file and `glassplane.db` in `%APPDATA%\Infra Glassplane\` are never touched by the installer.
4. SQLite column migrations run automatically on first start after upgrade.

### Backing up configuration

```powershell
# Copy the .env and database to a safe location
$src = "$env:APPDATA\Infra Glassplane"
$dst = "\\fileserver\backups\glassplane\$(Get-Date -f yyyy-MM-dd)"
New-Item -ItemType Directory -Path $dst -Force
Copy-Item "$src\.env", "$src\glassplane.db" -Destination $dst
```

Schedule this as a Task Scheduler job daily.

### Database size

The SQLite DB grows at approximately:
- Snapshot table: ~2 KB/row × 96 rows/day × 30 days ≈ **~6 MB**
- VM perf table: ~0.5 KB/row × ~200 VMs × 288 rows/day × 7 days ≈ **~200 MB** (scales with VM count)

To reduce VM perf storage: lower `VM_PERF_RETENTION_DAYS` in `.env` (default 7).  
Pruning runs automatically at each snapshot cycle.

### Changing the API key

1. Generate a new key.
2. Edit `%APPDATA%\Infra Glassplane\.env` → update `API_KEY=<new_key>`.
3. Settings → Save & Reload.
4. You will be prompted to log in again with the new key.

### Log access

Sidebar → **Logs** shows the last 200 log lines (configurable) with level filtering.  
To increase verbosity: set `LOG_LEVEL=DEBUG` in `.env` → Save & Reload.  
Log lines are in-memory only — they do not persist across backend restarts.

---

## 8. Troubleshooting

### Backend won't start

**Symptom:** App shows "connecting to backend…" indefinitely.

1. Check Task Manager for `glassplane-backend.exe` — if absent, the process crashed on launch.
2. Open `%APPDATA%\Infra Glassplane\` and look for a crash log.
3. Run the backend manually to see the error:
   ```
   "%LOCALAPPDATA%\Programs\Infra Glassplane\resources\backend\glassplane-backend.exe" --port 8765
   ```
4. Common cause: another process is bound to the chosen port. The backend picks a random high port — this is rare.

### "Unauthorized" error in UI

The API key in the browser session doesn't match `API_KEY` in `.env`.  
Click **Logout** in the sidebar, then log in with the correct key.

### Connector shows "unknown" status

The connector is configured but the last poll failed. Click the connector's view and check for a red error banner. Most common causes:

| Error text | Cause | Fix |
|---|---|---|
| `Connection refused` | Service down or wrong port | Verify the service is running; check port |
| `Timed out` | Firewall blocking or host unreachable | Check network path and firewall rules |
| `401 / Authentication failed` | Wrong credentials | Verify username/password; check account isn't locked |
| `SSL handshake failed` | Strict TLS mismatch | Set `*_SSL_VERIFY=False` for that connector |
| `HTTP 403` | Account lacks required permissions | Review required role in section 5 |

### Settings test button returns failure

Use the **Test** button in Settings for a fast connectivity check. If it fails:
1. Check network connectivity from the GlassPlane machine: `Test-NetConnection <host> -Port <port>` in PowerShell.
2. Check credentials against the system's own management UI.
3. For AOS-CX switches, use the **Diagnose** button (Settings → AOS-CX Direct → Diagnose) for a step-by-step breakdown.

### Exchange: "No output from PowerShell" or timeout

- Verify WinRM is enabled: `Test-WSMan -ComputerName mail.domain.local`
- Verify the Exchange PowerShell endpoint is accessible: `Invoke-Command -ConnectionUri http://mail.domain.local/PowerShell/ -ConfigurationName Microsoft.Exchange -Credential (Get-Credential) -ScriptBlock { Get-ExchangeServer }`
- The GlassPlane host must be domain-joined and the account must exist in AD.
- Check `EXCHANGE_DOMAIN` — use the NetBIOS name (`CORP`), not the FQDN.

### RDS: sessions not appearing in Direct mode

- Verify WinRM is reachable: `Test-WSMan -ComputerName ts01.domain.local`
- The account must be a local administrator on each RDSH.
- If WinRM isn't enabled: `Enable-PSRemoting -Force` on each RDSH, or deploy via GPO (`Computer Configuration → Windows Settings → Security Settings → Windows Firewall → Allow inbound WinRM`).

### FortiGate: "401" on token test

- Verify the token is copied correctly (no trailing spaces).
- Confirm the token was created as a **REST API Admin** (not a regular admin).
- Check that **Trusted Hosts** on the REST API admin includes the GlassPlane machine IP.

### FortiAnalyzer: empty device list

- Confirm `FORTIANALYZER_ADOM` matches the actual ADOM name exactly (case-sensitive).
- The read-only account must have access to the specified ADOM. In FAZ: System Settings → Administrators → edit user → assign to the correct ADOM.

### Snapshot history not filling in

- History requires at least two snapshots (30 minutes) to show a trend line.
- Check **Logs** view for `Snapshot loop error` entries.
- If a specific connector is slow (e.g., Exchange PS takes 20 s), the snapshot still completes — that connector just contributes NULL to that row.

---

## 9. Recovery Procedures

### Restore configuration after reinstall

1. Install Glassplane fresh.
2. Before launching, copy the backed-up `.env` to `%APPDATA%\Infra Glassplane\.env`.
3. Optionally copy `glassplane.db` to restore historical data.
4. Launch — the Setup Wizard is bypassed because `.env` already has a configured `API_KEY`.

### Reset to factory defaults

1. Close GlassPlane.
2. Delete `%APPDATA%\Infra Glassplane\.env` (and optionally `glassplane.db`).
3. Relaunch — the Setup Wizard runs from scratch.

### Database corruption

If `glassplane.db` is corrupted (app errors mention SQLite):
1. Close GlassPlane.
2. Delete `%APPDATA%\Infra Glassplane\glassplane.db`.
3. Relaunch — the database is recreated automatically. Historical data is lost; all live data is re-fetched immediately.

### Backend crash loop

1. Set `LOG_LEVEL=DEBUG` in `.env`.
2. Run the backend manually (see section 8) to capture the full traceback.
3. Common fix: delete `glassplane.db` if the error is a SQLite schema mismatch from a manual `.env` edit that set an unexpected `DB_PATH`.

---

*Infra Glassplane is maintained by Milling78. For issues, open a ticket at github.com/Milling78/GlassPlane.*
