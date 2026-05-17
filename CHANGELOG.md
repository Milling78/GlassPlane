# Changelog

All notable changes to Infra Glassplane are documented here.

## [1.2.44] — 2026-05-17

### Added / Changed

**Server-client architecture groundwork** — four changes that together make GlassPlane deployable as a headless server accessible from any browser, while keeping the Electron desktop app fully working.

- **Backend serves React frontend** — `GET /` (and all unmatched paths) now served from `frontend/dist/` when the directory exists; configure with `FRONTEND_DIST` env var to override the path. StaticFiles mount is last, so all `/api/*` and `/setup/*` routes take precedence. Backend alone (`http://server:8000`) is now a complete app.
- **`POST /setup/save`** — writes `.env` content server-side; same credential-preservation merge logic as the Electron IPC handler (blank password fields don't wipe existing values). Settings page now saves directly in browser mode instead of falling back to clipboard.
- **`GLASSPLANE_BACKEND_URL` env var for Electron** — set this to point the Electron shell at a remote backend; local backend process is skipped entirely. `getBackendUrl()` IPC exposed via preload; `api.js` `getBaseUrl()` upgraded to cache the full URL string (not just a port number), supporting both local and remote backends.
- **CORS default tightened** — changed from `*` to `null,http://localhost:5173,http://localhost:8000`; `null` covers Electron's `file://` origin; set `ALLOWED_ORIGINS=https://glassplane.corp.local` for server deployments. `FRONTEND_DIST` added to env vars.

## [1.2.43] — 2026-05-17

### Added

**SIEM integration framework** — bidirectional bridge between GlassPlane and a separate SIEM project.

- **Normalised event schema** — `SiemEvent` (id, ts, source, severity, category, event_type, message, host, src_ip, dst_ip, user, raw) is the shared contract between GlassPlane and the SIEM project
- **Local event store** — `siem_events.db` (separate SQLite beside the main DB); events persisted locally for configurable retention (default 30 days) before or after forwarding
- **State-change bridge** — each 15-min snapshot runs the bridge across FortiGate (CPU threshold crossings, VPN tunnel up/down), Exchange (DB dismount/remount, queue threshold crossings), iLO (host health changes), and Veeam (job failure onset/recovery); only emits on genuine state changes — no duplicates on every poll
- **Pull API** — `GET /api/siem/events?since=<ISO>&limit=500&source=fortigate&severity=high` — primary integration point for the SIEM project to consume normalised events
- **Push (outbound)** — if `SIEM_PUSH_URL` is set, a background thread batches and posts pending events to `{url}/api/ingest/batch` every 30 s; tracks forwarded state per event
- **Ingest (inbound)** — `POST /api/siem/ingest` accepts `SiemEvent[]` pushed by the SIEM project back into GlassPlane
- **Settings → SIEM Integration** — enable toggle, push URL, push API key, retain days, test connection button, live status (events stored / today / pending push / last push time)
- **`SIEM_ENABLED`, `SIEM_PUSH_URL`, `SIEM_PUSH_API_KEY`, `SIEM_RETAIN_DAYS`** env vars

## [1.2.42] — 2026-05-17

### Changed

**RDS view — vCenter VM name-matching** — terminal server cards now pull live CPU, RAM, and placement data from vCenter when hostnames match.

- **Name matching** — RDS hostnames and vCenter VM names are normalised to their first DNS label (case-insensitive); `TS01.corp.local` matches `TS01` in vCenter
- **DualBar** — CPU and RAM utilisation bars prefer vCenter-sourced `cpu_util_pct`/`ram_util_pct`; fall back to WMI values with a `(wmi)` label when vCenter data is unavailable
- **Allocated column** — shows `X.X GHz / Y.Y GB` from vCenter `cpu_allocated_mhz` and `ram_allocated_mb`
- **Cluster / ESXi Host columns** — show vCenter cluster membership and the ESXi host the VM is running on (host abbreviated to first DNS label)
- **VC badge** — small green chip on matched hostname cells and sessions table host column
- **Conditional columns** — Allocated / Cluster / ESXi Host columns are hidden entirely when no matches are found (vCenter not configured, or no hostname overlap)
- **Silent vCenter failure** — uses `Promise.allSettled`; RDS view loads normally if vCenter is unreachable or unconfigured

## [1.2.41] — 2026-05-17

### Added

**FortiAnalyzer connector** — managed device connectivity and appliance health via the FortiAnalyzer JSON-RPC API.

- **Settings → FortiAnalyzer** — host, username, password, port, ADOM, disk warn/critical thresholds, and test connection button
- **`GET /api/fortianalyzer/`** — returns `FortiAnalyzerSummary` with hostname, version, serial, device list, disk/CPU/memory utilisation; cached 60 s
- **Auth** — session-based JSON-RPC login (`/sys/login/user` → session token → `/sys/logout`); account needs read-only access (System Settings → Admin Profiles → Read-Only)
- **FortiAnalyzer view** — metric cards (managed devices with up/down count, disk%, CPU%, memory%); utilisation bars for disk/CPU/memory with warn/critical thresholds; devices table (name, management IP, platform, OS version, ADOM, connection status) sorted with disconnected devices first
- **ADOM support** — queries `dvmdb/adom/<adom>/device` first, falls back to global device list
- **Snapshot history** — `faz_devices`, `faz_devices_up`, `faz_disk_pct` added to the 15-min snapshot with automatic SQLite column migration
- **Nav item** added after Exchange

## [1.2.40] — 2026-05-17

### Added

**MS Exchange connector** — live mailbox database health, transport queue monitoring, and server component state via Exchange Remote PowerShell.

- **Settings → MS Exchange** — server FQDN, username, domain (optional), password, transport queue warn/critical thresholds, and test connection button
- **`GET /api/exchange/`** — returns `ExchangeSummary` with server list, databases, transport queues; cached 120 s
- **Exchange Remote PS** — connects to `http://<server>/PowerShell/` with Kerberos auth; requires View-Only Organization Management; script written to temp `.ps1` and executed via `powershell -File` (same pattern as RDS connector)
- **Exchange view** — metric cards (databases, servers, queued messages, active queues); servers table with version, roles, active/inactive component counts; two tabs: Databases (mounted state, size, whitespace, mailbox count, DAG copy status, copy queue length) and Transport Queues (identity, delivery type, status, message count, next hop)
- **Dismounted database alert** — red banner appears when any database is not mounted
- **DAG awareness** — detects and displays the DAG name; shows DAG copy status (Healthy / Failed / Suspended) per database
- **Snapshot history** — `ex_db_count`, `ex_db_mounted`, `ex_queue_total` added to the 15-min snapshot with automatic SQLite column migration
- **Nav item** added after FortiGate

## [1.2.39] — 2026-05-17

### Added

**FortiGate firewall connector** — live health, VPN, and session monitoring via the FortiOS REST API.

- **Settings → FortiGate Firewall** — host, REST API token, port, VDOM, CPU warn/critical thresholds, and test connection button
- **`GET /api/fortigate/`** — returns `FortiGateSummary` with CPU%, memory%, session count, HA mode, IPsec tunnel state, SSL VPN sessions, and interface list; cached 60 s
- **Auth** — Bearer token (System → Administrators → Create New → REST API Admin); no username/password required
- **FortiGate view** — summary metric cards (CPU, memory, sessions, IPsec tunnels, SSL VPN users, interfaces); CPU/memory utilisation bars with warn/critical colouring; three tabs: IPsec VPN tunnels (name, remote IP, status, RX/TX bytes), SSL VPN sessions (username, source IP, duration, RX/TX), and Interfaces (name, alias, IP, link status, speed, RX/TX)
- **HA awareness** — detects active/passive or FGCP mode and shows peer count
- **Snapshot history** — `fgt_cpu_pct`, `fgt_sessions`, `fgt_ipsec_up`, `fgt_ssl_users` added to the 15-min snapshot, with automatic SQLite column migration
- **Nav item** added after Term. Servers

## [1.2.38] — 2026-05-17

### Added

**Terminal Server / RDS connector** — live session and host health monitoring for Windows RDS environments.

- **Settings → Terminal Servers / RDS** — RD Connection Broker FQDN, RDSH host list (direct mode), CPU warn/critical thresholds, and test connection button
- **`GET /api/rds/`** — returns `RDSSummary` with per-host metrics and full session list; cached 60 s
- **Broker mode** — uses `Get-RDUserSession` / `Get-RDSessionHost` / `Get-RDSessionCollection` via the RemoteDesktop PowerShell module (requires RSAT-RDS-Tools on the GlassPlane machine or running on the broker)
- **Direct mode** — falls back to `qwinsta` + CIM (`Win32_PerfFormattedData_PerfOS_Processor`, `Win32_OperatingSystem`) per host; no RSAT required; needs WinRM/DCOM access to each RDSH
- **Term. Servers view** — 4 summary cards (hosts, active sessions, disconnected, total); sortable host table (status, active, disconnected, CPU%, RAM%, load index); sortable session table (username, state, host, idle time)
- **Snapshot history** — `rds_host_count`, `rds_active`, `rds_disconnected` added to the 15-min snapshot, with automatic SQLite column migration for existing installs
- **Nav item** added under Hosts / iLO

## [1.2.37] — 2026-05-16

### Added

**Wall TV Mode** — fullscreen dashboard designed for mounting on a TV or monitor.

- **Settings → Wall Display section** — enable/disable toggle, resolution selector (HD 1920×1080 or 4K 3840×2160), auto-refresh interval (seconds), and "Launch Wall Display" button
- **TVModeView component** — fixed-position dark overlay showing 6 metric cards (VMs, Storage, Backups, Networking, Hosts/iLO, DNS & Certs) with large-format numbers, colour-coded status indicators, live clock, countdown timer, and optimization score
- **Electron IPC** — `set-tv-mode` resizes and fullscreens the window to the selected resolution; `exit-tv-mode` restores normal 1400×900 windowed mode
- **Auto-refresh** — TVModeView fetches all live data independently at the configured interval; auto-refresh countdown visible in the header
- **Backend config fields** — `TV_MODE_ENABLED`, `TV_MODE_RESOLUTION`, and `TV_MODE_REFRESH_SECONDS` added to Settings model and persisted in `.env`
- **Escape to exit** — pressing `Esc` calls `exit-tv-mode` IPC and returns to the normal layout

## [1.2.36] — 2026-05-16

### Performance

- **Lazy-loaded views** — all 20 view components are now loaded on first navigation instead of at startup; initial JS payload drops from 608 kB to ~15 kB (shell) + 141 kB (React vendor chunk)
- **Code-split vendor chunk** — React and ReactDOM are bundled into a separate `vendor` chunk so they are cached independently of app code
- **Parallel startup fetches** — the 7 independent data fetches on app mount now fire in a single `Promise.all` instead of separate `useEffect` calls
- **VC Events endpoint cached** — `/vcenter/events` now respects the configured cache TTL (per `hours`+`limit` combination); previously hit vCenter on every page visit
- **Snapshot collection parallelised** — `snapshotter._collect()` now fetches vCenter, Aruba, Alletra, Veeam, and iLO concurrently via `ThreadPoolExecutor`; snapshot time is now the slowest single connector rather than their sum
- **Aruba SSH banner wait optimised** — replaced fixed 1.5 s sleep with 50 ms polling loop (up to 2 s); fast switches are ready in under 100 ms
- **iLO retry delay halved** — retry delay on iLO connection failure reduced from 4 s to 2 s

### Security / Hardening

- **API key no longer returned in plaintext** — `/setup/config` now returns `apiKeyConfigured: bool` instead of the raw key value; Settings UI shows "saved — leave blank to keep" when configured
- **SQLite init race fixed** — `store._open()` now uses double-checked locking so concurrent startup threads cannot see a half-initialised connection
- **`write_vm_perf` double open eliminated** — single `conn` variable used for both `executemany` and `commit`
- **Log redaction** — `log_buffer` now scrubs `password=`, `token=`, `api_key=`, `secret=`, and `bearer` patterns before writing to the in-memory ring buffer
- **Aruba token refresh race closed** — `_token_lock` is now held through the entire check + HTTP fetch + write sequence, preventing concurrent threads from each triggering a token refresh
- **Surge endpoint input validation** — `threshold`, `lookback_hours`, and `vm_filter` now carry FastAPI `Query` bounds (`ge`/`le`/`max_length`) so malformed values are rejected before reaching business logic

## [1.2.35] — 2026-05-16

### Added

**DNS failure alerts**
- The alert checker now evaluates DNS health every cycle when `DNS_SERVERS` or `DNS_CHECK_HOSTS` is configured.
- Per-server: fires `critical` when a configured DNS server becomes unreachable; resolves automatically when it recovers.
- Per-hostname: fires `critical` when any hostname (manual or auto-discovered integration host) fails to resolve; the alert message includes the source label (e.g., `[vCenter]`, `[Veeam]`) so the impacted integration is immediately obvious.
- Follows the same state-transition model as all other alerts — webhook fires once on breach, once on recovery.

---

## [1.2.34] — 2026-05-16

### Added

**Automatic DNS resolution for all data source hostnames**
- vCenter, Veeam, Alletra, KACE, iLO, Aruba Controller, and Aruba direct-connect hosts are automatically included in DNS resolution checks — no manual `dns_check_hosts` entry required.
- IP addresses are silently skipped (nothing to resolve); only hostnames are checked.
- When no DNS servers are configured the system resolver on the GlassPlane machine is used as a fallback, so integration hosts are always checked even without explicit DNS server config.
- `DNSRecordResult` gains a `source` field (`"vCenter"`, `"Veeam"`, `"Alletra"`, `"KACE"`, `"iLO"`, `"Aruba"`, `"manual"`) shown as a color-coded badge in the DNS view.
- Hostname resolution table now sorts failed hosts first, then by source, then alphabetically.
- A banner explains when the system resolver is being used instead of a configured DNS server.

---

## [1.2.33] — 2026-05-15

### Fixed

**Surge sparkline showing "Chart.js unavailable"**
- Chart.js was never loaded — no `<script>` tag in `index.html`, not in npm dependencies, and the CSP blocks external CDN scripts. Installed `chart.js` as an npm dependency and switched `SurgeSparkline` to a proper ES module import with tree-shaken component registration (`LineController`, `CategoryScale`, `LinearScale`, etc.). The `typeof Chart === 'undefined'` guard is removed.

---

## [1.2.32] — 2026-05-15

### Fixed

**Surge calculator returning no data for powered-on VMs**
- `vm_perf_collector` was specifying `startTime`/`endTime` alongside `intervalId=20`. vCenter's real-time buffer only holds ~1 hour of data; asking for a window that extends beyond that returns empty results. The batch QuerySpec now uses `maxSample=3` only — the correct pattern for real-time queries.
- `_query_metric` fallback (live vCenter path): when the 5-minute rollup returns nothing and we fall back to `intervalId=20`, the start time is now clamped to 55 minutes ago so the request stays within the real-time buffer.
- Surge alert banner updated: replaces the misleading "statistics level must be ≥ 1" hint with a clear explanation that data collects on first run (~5 min after startup) and actionable steps if the problem persists.

---

## [1.2.31] — 2026-05-15

### Changed

**Friendly network error messages across all connectors**
- DNS resolution failures (`getaddrinfo failed`) now read: *"Cannot resolve hostname 'x'. Check the host setting — use a fully-qualified name or an IP address."*
- Connection refused → *"Connection refused. Verify the service is running and the port is correct."*
- Timeouts → *"Connection timed out. Check the hostname/IP and firewall rules."*
- SSL/TLS errors surface the specific problem and suggest disabling SSL verification.
- 401/403 → authentication or permission hints pointing to Settings.
- All 17 router endpoints share a single `friendly_error()` helper (`utils.py`).

---

## [1.2.30] — 2026-05-15

### Reverted

**VM storage utilization** (introduced in v1.2.29) — removed entirely due to false positives. The vCenter `summary.storage.committed` / `uncommitted` figures do not reliably reflect actual on-disk usage in all datastore configurations, producing misleading utilization percentages. `VMSummary` is back to `datastore_gb` only; the disk column, storage alerts, and storage badges are all removed.

---

## [1.2.29] — 2026-05-15

### Added

**VM thin-provisioned disk utilization tracking and alerts** *(reverted in v1.2.30)*
- `VMSummary` now exposes `storage_used_gb` and `storage_util_pct` for thin-provisioned VMs.
- VMs table StorageCell, disk warn/crit badges, disk alerts metric.
- Per-VM storage webhook alerts at configurable warn/crit thresholds.

---

## [1.2.28] — 2026-05-15

### Changed

**Certificate poller — 24-hour cache TTL and immediate repoll on config change**
- Certificate checks now cache for 24 hours instead of the global 60-second TTL. TLS handshakes to every monitored host on every dashboard refresh were unnecessary given certificates change on the order of weeks/months.
- Adding or removing cert hosts in Settings triggers `POST /setup/reload` which calls `clear_all_caches()`, dropping the cert cache entry. The next page load after saving immediately runs a fresh poll against the updated host list.
- The `cached` decorator now accepts an optional `ttl` parameter so other endpoints can opt into different cache durations without affecting the global default.

---

## [1.2.27] — 2026-05-15

### Added

**Persistent VM CPU/RAM storage for surge calculator**
- New `vm_perf` table in the existing SQLite database stores one CPU% and RAM% sample per powered-on VM every 5 minutes (configurable via `VM_PERF_INTERVAL_SECONDS`).
- A new background collector (`vm_perf_loop`) starts at launch alongside the snapshot and alert loops. It connects to vCenter, batch-queries all powered-on VMs in groups of 50, and writes the latest sample to the DB. Retention defaults to 7 days (`VM_PERF_RETENTION_DAYS`).
- The surge calculator now reads from the local DB first. This makes scans instant (no live vCenter connection required) and allows lookback windows up to 7 days. The live vCenter query is retained as a fallback for the first run before any data has been collected.
- DB is self-migrating: existing installs gain the `vm_perf` table automatically on first launch of v1.2.27.

---

## [1.2.26] — 2026-05-15

### Fixed

**CPU/RAM surge calculator — no VMs shown after scan**
- `vms_scanned` was always 0 because the performance data query used only `intervalId=300` (5-minute historical rollup). If vCenter's rollup hasn't run yet or stats collection level is below 1, the rollup returns empty and every VM was silently dropped by the `< 10 samples` filter. Fixed by falling back to `intervalId=20` (real-time 20-second samples) when the rollup query returns nothing.
- `powerState` filter now uses `vim.VirtualMachinePowerState.poweredOn` enum constant instead of a bare string comparison, ensuring it works correctly across all pyVmomi versions.
- Minimum sample filter reduced from 10 to 2 — prevents valid short-window results from being discarded.
- Added `vms_found` to the API response (total powered-on VMs before data filtering) so the UI can distinguish "no VMs in vCenter" from "VMs found but no perf data".
- UI now shows **all** scanned VMs in the list, not just cyclic ones. Cyclic VMs appear first with coloured cycle badges; non-cyclic VMs show below with their peak/avg. Any VM can be clicked to see its sparkline. A warning banner appears when `vms_found > 0` but `vms_scanned = 0`, pointing to vCenter stats collection level.

---

## [1.2.25] — 2026-05-15

### Fixed

**KACE — login fails with `SSL: unexpected_EOF_while_reading`**
- KACE SMA appliances close the TLS connection without sending the required `close_notify` alert, which Python 3.11+ treats as a protocol violation and raises an EOF error before the login response is read.
- Fixed by replacing the default httpx SSL context with a permissive one that sets `OP_IGNORE_UNEXPECTED_EOF`, allows TLS 1.0+, and relaxes the cipher security level — matching the same pattern already used for iLO Gen9 compatibility.

---

## [1.2.24] — 2026-05-15

### Fixed

**iLO — stale IML entries causing false PSU / hardware alerts**
- IML entries were never filtered by age, so unrepaired events from months or years ago (e.g., a past power supply fault that has since recovered) persisted in amber conditions indefinitely — even when the iLO web UI showed current hardware as healthy.
- Added `ALERT_ILO_IML_DAYS` setting (default `90`). IML entries older than this window are silently skipped regardless of repair status. Entries within the window still require non-OK severity and unrepaired state to surface.
- Each IML message now includes its creation date prefix (`[YYYY-MM-DD] <message>`) so the age of active alerts is visible in the UI without opening iLO directly.

---

## [1.2.23] — 2026-05-15

### Changed

**Aruba Wireless diagnostics — expanded REST API probes**
- Added `GET configuration/showcommand?command=show+version` probe to test whether any authenticated REST GET with query parameters reaches the API backend.
- Added `GET monitor/ap_details` re-probe post-login to confirm whether the only previously non-HTML endpoint (`ap_details` → HTTP 501) changes behaviour after authentication.
- Added Basic Auth probe on `configuration/showcommand?command=show+version` to test whether HTTP Basic authentication bypasses the form-login CSRF issue that causes WinError 10054 (TCP reset) on `POST /api/v1/api/login`.
- All probe responses show HTTP status and body snippet (or `HTML` marker) directly in the step label for screenshot readability.

---

## [1.2.18] — 2026-05-15

### Fixed

**Aruba Wireless — login silently fails because ArubaOS 8.x requires form-encoded body**
- ArubaOS 8.x REST API login (`/api/v1/api/login`) requires `Content-Type: application/x-www-form-urlencoded` with `uid`/`passwd` fields. Sending `Content-Type: application/json` causes the controller to return HTTP 200 with an empty body and no session token — no error, but no UIDARUBA either. Every subsequent data endpoint then returns the HTML web-UI login page (HTTP 200) instead of JSON, which is why all AP endpoints appeared to fail with non-JSON responses.
- Fixed by switching from `json={"uid":...}` to `data={"uid":...}` in the login POST across the connector, test endpoint, and diagnose endpoint.

---

## [1.2.17] — 2026-05-15

### Fixed

**Aruba Wireless diagnostics — all critical info moved into step labels**
- HTTP status codes, UIDARUBA token source (body/cookie/NONE), JSON key names, and non-JSON body snippets are now embedded in the step label text rather than the detail field. Labels are always visible regardless of UI contrast or screenshot quality, making it possible to read diagnostic results from any screenshot.
- Added `Accept: application/json` header to all AP endpoint requests.
- Showcommand steps now include the command name in the label to distinguish the two candidates.

---

## [1.2.16] — 2026-05-15

### Fixed

**Aruba Wireless — crash on login when controller returns empty HTTP 200 body**
- Some ArubaOS 8.x builds return HTTP 200 from `/api/v1/api/login` with an empty body (no JSON). Calling `.json()` on an empty response raises `json.JSONDecodeError: Expecting value: Line 1 Column 1 (char 0)`, which surfaced as the modal summary and prevented any AP probing from running.
- Fixed by wrapping `.json()` in try/except and falling back to the `UIDARUBA` session cookie when the body is absent.
- Diagnostic "Controller login" step now also shows the raw body snippet when the body is non-JSON, making it possible to see what the controller is actually returning.

---

## [1.2.15] — 2026-05-15

### Fixed

**Aruba Wireless — UIDARUBA session token not reaching data endpoints**
- ArubaOS returns a `UIDARUBA` token in the login response JSON body. On non-standard ports (e.g. 4343), httpx cookie scoping silently drops the session cookie for subsequent requests, causing every data endpoint to return 401/403 (which were in the skip list, making them look like unsupported paths). Fix: extract `UIDARUBA` from the login response body and pass it as a `?UIDARUBA=<token>` query parameter on every subsequent request, bypassing cookie handling entirely.
- Restructured `_AP_ENDPOINTS` to use a `(path, key, params_dict)` tuple so `configuration/showcommand` candidates pass `command=show ap database` via httpx `params=` (proper `%20` encoding) rather than embedded in the URL string.
- Added 401 and 403 to the skipped-status set in the connector so auth-rejected responses continue to the next endpoint rather than raising.
- Diagnostic "Controller login" step now reports whether the UIDARUBA token was received, making it easy to spot token-delivery failures.

---

## [1.2.14] — 2026-05-15

### Fixed

**Aruba Wireless — ArubaOS 8.x AP data not found (all monitoring endpoints return 404)**
- On ArubaOS 8.x (tested on 8.11.0.1 HPE), the `monitor/ap_*` REST endpoints return 404. Added two CLI-passthrough candidates: `configuration/showcommand?command=show+ap+database` and `configuration/showcommand?command=show+ap+active`. These use the ArubaOS CLI-over-REST API which is available on all 8.x builds and returns structured JSON AP data.
- `_extract_ap_list` now filters out lists of strings (text-line CLI output) — only lists whose elements are dicts are accepted as a valid AP list, preventing bad parses when a showcommand returns text-format output.
- Fixed `_extract_ap_list` to unwrap one level of dict when `_data` or the hint key contains a wrapping dict rather than a list directly (`{"_data": {"AP Database": [...]}}` pattern).
- Added `follow_redirects=True` to the httpx client — some ArubaOS builds redirect monitoring paths.
- All three aruba-wireless code paths (connector, test endpoint, diagnose endpoint) updated consistently.

---

## [1.2.13] — 2026-05-15

### Fixed

**Aruba Wireless — AP data not found when controller uses non-standard JSON key names**
- `_fetch_ap_list` would silently return an empty list when the controller responded with a valid JSON body but used a key name not in the expected set (`AP Details`, `_data`). Added `_extract_ap_list()` helper that tries the hint key, then `_data`, then scans all list-valued fields as a fallback, so firmware variants with different key names are handled automatically.
- Expanded AP endpoint candidates from 3 to 5: `monitor/ap_details` → `monitor/ap_active` → `monitor/ap_database` → `monitor/ap_table` → `monitor/ap_all`.
- `400 Bad Request` added to the set of status codes that cause a silent skip to the next endpoint candidate (previously only 404/405/501 were skipped).

**Connection diagnostics — wireless AP diagnostic now shows actual JSON keys on mismatch**
- When an AP endpoint returns HTTP 200 with JSON but no recognised list key, the Diagnose modal now shows `keys: <key1>, <key2>, ...` in the step detail instead of silently counting 0 APs. This makes it possible to identify which key name a specific firmware version uses and report it for a connector fix.
- Wireless diagnostic updated to probe all 5 endpoint candidates (was 3) and to skip `400` responses consistently with the connector.

---

## [1.2.12] — 2026-05-15

### Added

**Connection Diagnostics — step-by-step troubleshooting for switches and wireless APs**
- New "Diagnose" button (stethoscope icon) added to the Aruba Wireless Controller and Aruba Direct Switches sections in Settings, alongside the existing "Test connection" button.
- Clicking "Diagnose" runs a detailed probe and displays a modal with one row per step:
  - **Direct switches**: TCP reachability (REST port), TLS handshake + negotiated cipher/version, AOS-CX REST login, AOS-CX system info; then separately TCP reachability (SSH port), SSH handshake with negotiated cipher and MAC, SSH authentication, `show system information` output.
  - **Wireless controller**: TCP reachability, TLS handshake, controller login, and all three AP endpoint candidates (`ap_details` → `ap_active` → `ap_database`) each showing HTTP status and AP count or skip reason.
- Each step shows green ✓ (ok), red ✗ (failed), or grey – (skipped/not supported). A colour-coded summary line at the bottom of the modal gives the overall verdict.
- Diagnoses always run against the first configured host; ESC or clicking outside the modal closes it.
- Backend: `POST /setup/diagnose/aruba-direct` and `POST /setup/diagnose/aruba-wireless` (no auth required in Settings context, same pattern as existing test endpoints).

---

## [1.2.11] — 2026-05-15

### Fixed

**Auto-updater — NSIS installer blocked by surviving backend subprocess**
- `process.kill(proc.pid)` on Windows terminates only the direct child process. PyInstaller `--onefile` builds spawn a second child process (the Python interpreter) which is the process that actually runs the app. Killing the parent left this child alive, holding the `glassplane-backend.exe` file open. Windows file locking then prevented NSIS from replacing the exe during the update, causing the installer to fail or hang.
- Fixed by replacing `process.kill(proc.pid)` with `execFileSync('taskkill', ['/F', '/T', '/PID', pid])`. The `/T` flag kills the entire process tree; `execFileSync` blocks `will-quit` until all processes in the tree have exited, so NSIS finds the file unlocked.

---

## [1.2.10] — 2026-05-15

### Fixed

**Aruba Central — NameError crash on every API call**
- `_fetch_switches`, `_fetch_switch_ports`, and `_fetch_aps` all called `_headers(token)` to build the Authorization header, but the function was never defined in `aruba.py`. Every Aruba Central API call raised `NameError: name '_headers' is not defined`, silently failing for any user with Aruba Central configured.
- Fixed by adding `_headers(token: str) -> dict` returning `{"Authorization": f"Bearer {token}", "Content-Type": "application/json"}`.

**Snapshot loop — deprecated `asyncio.get_event_loop()` inside async context**
- `snapshot_loop()` called `asyncio.get_event_loop()` (deprecated inside a running event loop since Python 3.10). Fixed to use `asyncio.get_running_loop()`, consistent with the rest of the backend.

---

## [1.2.9] — 2026-05-15

### Fixed

**iLO — repeated session creation on every poll cycle (event log flood)**
- `_make_client()` opened a new Redfish session (POST `/redfish/v1/SessionService/Sessions/`) on every 60-second cache refresh for every configured host. With N hosts polled every minute, this produced N×1440 login events per day in the iLO event log and risked exhausting iLO's 3–5 concurrent session limit, causing intermittent connection drops.
- Fixed with a per-host session cache (`_sessions` dict, keyed by `host:port`): `X-Auth-Token` is obtained once and reused for up to 22 hours. On 401 (token expired or revoked server-side), the session is invalidated and re-created on the next attempt. If session creation fails, the connector falls back to HTTP Basic auth and remembers that decision for the host.
- Extracted all Redfish data collection into `_fetch_host_data(client, host, port)`; the shared client is no longer closed between requests within a single poll, and sessions persist across poll cycles.

---

## [1.2.8] — 2026-05-15

### Fixed

**Settings — passwords saved as the string "undefined" after a save**
- `GET /setup/config` returns `passwordConfigured: bool` flags but no `password` field for vCenter, Alletra, Veeam, Aruba access token, and Aruba client secret. In JavaScript, accessing a missing key on an object returns `undefined`, and template literals coerce `undefined` to the string `"undefined"`. `buildEnvContent` was therefore generating `VCENTER_PASSWORD=undefined` (and similarly for the other affected fields). `_mergeEnv` did not recognise `"undefined"` as a blank value and wrote it verbatim to `.env`, replacing the real stored password on every save.
- Fixed by adding `?? ''` to all five affected fields in `buildEnvContent` (`env.js`). The empty string correctly triggers `_mergeEnv`'s credential-preservation logic, which restores the existing `.env` value.

**Aruba Central — token expiry requires app restart**
- `_get_access_token` returned the static `ARUBA_ACCESS_TOKEN` unconditionally with no expiry tracking. When the token expired, every Aruba API call returned 401 and remained broken until the app was restarted or settings were manually reloaded.
- Fixed with a module-level OAuth token cache (`_cached_token` / `_token_expiry`): when OAuth credentials are configured, the token is reused until 60 s before expiry, then transparently refreshed. When a 401 is received despite a valid-looking token (e.g. server-side revocation or a static token that expired), `_invalidate_token()` clears the cache and the request is retried once with a fresh token — no restart required.

---

## [1.2.7] — 2026-05-15

### Fixed

**Direct Switches — SSH "unknown cipher" on older ProCurve / Aruba switches**
- Paramiko 3.x removed CBC ciphers (`aes128-cbc`, `aes256-cbc`, `3des-cbc`, `blowfish-cbc`) and legacy MACs (`hmac-sha1`, `hmac-md5`) from its default preferred-algorithm list for security hardening. Older HP ProCurve and Aruba switches that only advertise these algorithms found no overlap during negotiation and the handshake failed.
- Fixed by extending `_open_ssh_transport()` to append `_LEGACY_CIPHERS` and `_LEGACY_MACS` to `sec.ciphers` and `sec.digests` before `start_client()`, using the same `dict.fromkeys` dedup pattern already used for key types and KEX. Modern switches still negotiate the strongest available algorithm first; legacy-only switches now fall back to CBC/SHA1 instead of failing.
- The Settings connection test uses `_open_ssh_transport` directly, so it is also fixed.

---

## [1.2.6] — 2026-05-15

### Fixed

**Aruba Wireless standalone — "Expecting value: line 1 column 1 (char 0)"**
- Some ArubaOS controller builds return HTTP 200 with an empty response body for AP list endpoints when no APs are currently registered or the endpoint exists but has no data. Calling `.json()` on an empty body raises `json.JSONDecodeError`.
- Fixed in both the connector (`aruba_wireless_direct.py`) and the Settings connection test (`setup.py`):
  - Empty body (`not r.content`) now causes the endpoint candidate to be skipped (same as 501/404/405) rather than crashing.
  - Non-JSON body (`ValueError` from `.json()`) is caught and skipped similarly.
  - If all three candidate endpoints (`ap_details` → `ap_active` → `ap_database`) return 200 with empty body, the connector returns an empty AP list (0 APs) instead of raising an error — valid state for a controller with no associated APs.

---

## [1.2.5] — 2026-05-15

### Fixed

**Auto-updater — update not installed when closing the app**
- `stopBackend` was registered on `before-quit`, the same event electron-updater hooks to spawn the NSIS installer. electron-updater internally calls `app.removeAllListeners('before-quit')` before spawning, which could race with or discard our handler depending on registration order.
- Fixed by moving `stopBackend` to `will-quit`, which fires after electron-updater has already spawned the installer process and called `app.exit()` — correct ordering on all platforms.
- Changed `quitAndInstall(false, true)` → `quitAndInstall(true, true)` (silent mode) on both the "Restart now" dialog path and the IPC handler. Showing the NSIS installer UI while the app is mid-quit caused intermittent failures on Windows; silent install runs correctly as a detached background process.

---

## [1.2.4] — 2026-05-15

### Fixed

**Settings — blank password fields overwriting saved credentials**
- When loading Settings, the backend returns `passwordConfigured: bool` flags instead of actual password values (a security measure introduced in v1.0.1), leaving all password inputs blank.
- Saving with any blank password field was writing an empty value to `.env`, erasing the stored credential.
- Fixed in two layers:
  - **Electron `write-env` IPC** (`electron/main.js`): `_mergeEnv()` now reads the existing `.env` before writing; for any credential key (matching `PASSWORD|SECRET|TOKEN|KEY|PASSWD`) whose incoming value is blank, the existing `.env` value is preserved.
  - **Settings UI** (`SettingsView.jsx`): all 10 password `<Field>` components now receive a `configured` prop. When `configured` is true and the field is empty, the placeholder reads *"(saved — leave blank to keep)"* instead of being blank. Also fixed the Claude API key field, which previously stored `'••••••••••••••••'` as the actual field value (those dots would have been saved to `.env` as the key).

---

## [1.2.3] — 2026-05-15

### Fixed

**iLO — 401 Unauthorized on all hosts**
- The connector was using HTTP Basic auth exclusively. Several iLO firmware versions reject Basic auth in favor of Redfish session tokens (`X-Auth-Token`).
- Fixed: `_make_client()` now attempts a Redfish session (POST `/redfish/v1/SessionService/Sessions/`) first; if the session is created successfully the `X-Auth-Token` header is used for all subsequent requests and the session is deleted on exit. HTTP Basic auth remains as a fallback for firmware that doesn't support session creation.
- Added `OData-Version: 4.0` header to all requests — required by some HPE iLO firmware revisions.

---

## [1.2.2] — 2026-05-15

### Fixed

**Direct Switches — SSH "no acceptable host key" on older ProCurve / Aruba switches**
- Older HP ProCurve and Aruba switches only advertise legacy host key types (`ssh-dss`) and key-exchange algorithms (`diffie-hellman-group1-sha1`, `diffie-hellman-group14-sha1`) that paramiko omits from its default negotiation list.
- Fixed by using a raw `paramiko.Transport` with `get_security_options()` to append legacy algorithms before the handshake. Modern switches still negotiate the strongest available option first; legacy ones now succeed instead of raising "incompatible SSH peer."
- Same fix applied to the Settings connection test.

---

## [1.2.1] — 2026-05-15

### Fixed

**Aruba Wireless standalone — 501 Not Implemented on `ap_details`**
- `ap_details` returns 501 on some ArubaOS builds. Connector and connection test now try three endpoints in order: `ap_details` → `ap_active` → `ap_database`, skipping any that return 501/404/405 and using the first that succeeds.

---

## [1.2.0] — 2026-05-14

### Added

**Capacity Planning view** (`Capacity` nav item)
- SVG trend charts with 30-day linear regression projections for storage, backup repo, cluster CPU/RAM peak, powered-on VM count, power draw, and optimization score.
- Urgency banner highlights metrics approaching their warning threshold with days-to-breach.
- New snapshot columns captured every 15 min: `vc_powered_on`, `vc_cpu_max_pct`, `vc_ram_max_pct`. Auto-migrated on first run — no DB wipe needed.

**VM Lifecycle — dormancy tracking**
- Powered-off VMs now show days since last power-off event (90-day event history query).
- Red "stale" badge for VMs dormant ≥ 30 days.
- Boot time recorded for all powered-on VMs.

**vCenter Events view** (`VC Events` nav item)
- Live event timeline from the vCenter EventManager covering power on/off, migrations, VM create/delete/rename/reconfigure, auth sessions, and tasks.
- Time-range selector (1h / 4h / 8h / 24h / 48h / 7d), type-group filter chips (Power / VM Mgmt / Migration / Auth / Tasks), and free-text search.

### Fixed

**Alletra connector** — complete rewrite for HPE Alletra 6000 / Nimble REST API (port 5392, `/v1/tokens` auth, `X-Auth-Token` header). Previous connector targeted HPE Primera WSAPI and returned 404 on every call.

**Surge Alerts — VMs scanned: 0** — `sampleInfo` items are `PerfSampleInfo` objects, not ISO-parseable strings. Fixed timestamp extraction to use `s.timestamp`; also corrected timezone-aware datetime passed to pyVmomi QuerySpec (must be naive UTC).

**Claude AI integration** — streaming SSE endpoint (`POST /api/ai/stream`) backed by Anthropic SDK; `InsightsView` chat interface with quick-start prompts and stop-generation support.

---

## [1.1.0] — 2026-05-14

### Fixed

**Aruba direct-switch connection test (NameError crash)**
- `test_aruba_direct` in `setup.py` referenced `rest_err` after the `except` block, where Python 3 had already deleted it. When both REST and SSH failed, the endpoint threw an unhandled `NameError`, Starlette returned a plain-text 500, and `testConnector` in the frontend called `res.json()` on that response — producing the "unexpected token 'I', 'internal S' is not valid JSON" error visible in the Wired Switches test row.
- Fix: save exception to `rest_error` before the `except` clause exits; add `res.ok` guard in `testConnector` as defence-in-depth.

**Auto-updater silent failures**
- The 10-second startup update check returned an unhandled Promise rejection when `latest.yml` was absent from GitHub Releases; Node.js swallowed the rejection silently.
- Any update event (error, up-to-date, available) fired as a one-shot IPC send. If Settings wasn't open at that moment, the user saw nothing when they later navigated there.
- Fix: `.catch()` on the timeout call; `_sendUpdateStatus()` helper caches the last status in `_lastUpdateStatus`; new `get-update-status` IPC handler + preload exposure; SettingsView seeds from the cached value on mount.
- `autoUpdater.logger` is now wired to the console for easier diagnosis.

**Release assets (v1.0.0 GitHub release)**
- `latest.yml` was never uploaded to the v1.0.0 GitHub release, so every update check produced a silent 404. Fixed by properly publishing v1.1.0 with all required assets (`latest.yml`, installer, blockmap) via `electron-builder --publish always`.

---

## [1.0.1] — 2026-05-14 *(integrated into v1.1.0)*

23 bugs found and fixed in a full codebase scan:

**Security**
- `auth.py`: replaced `!=` credential comparison with `secrets.compare_digest()` to prevent timing-based credential probing.
- `setup.py`: `GET /setup/config` no longer returns plaintext passwords; replaced with `passwordConfigured: bool` flags for all subsystems.

**Backend — correctness**
- `api.py`: `vcenter` was excluded from the health-status aggregation loop; overall status could be `ok` even when vCenter was `critical`.
- `api.py`: replaced single shared lock with per-cache-key `asyncio.Lock` in `cached()` decorator to prevent thundering-herd stampedes.
- `api.py` / `checker.py`: replaced deprecated `asyncio.get_event_loop()` with `asyncio.get_running_loop()`.
- `vcenter.py`: `is_idle` and `is_oversized` flags are now gated on `power_state == "poweredOn"`; powered-off VMs were inflating idle/oversized counts.
- `veeam.py`: fixed double unit conversion — `capacityGB` field was being passed through `_gb()` a second time, shrinking reported repo sizes by 1 000×.
- `aruba.py`: added offset-based pagination loops to `_fetch_switches()` and `_fetch_aps()`; environments with >1 000 devices silently returned only the first page.
- `vcenter_perf.py`: exception handler used `vm.config.name` without guarding against `config = None`; replaced with `getattr(getattr(vm, 'config', None), 'name', repr(vm))`.
- `aruba_direct.py`: replaced fixed `time.sleep(wait)` in `_ssh_run()` with a deadline-based recv loop that extends on each chunk; slow switches caused premature timeout.

**Backend — stability**
- `ilo.py`: added early-return guard before `ThreadPoolExecutor(max_workers=min(len(hosts), 8))`; zero hosts raised `ValueError: max_workers must be greater than 0`.
- `checker.py`: module-level `_active` set was written in a `ThreadPoolExecutor` thread and read from the async event loop without a lock; added `threading.Lock`.
- `checker.py`: alert loop called `asyncio.sleep()` before the first `run_check()`, delaying initial alerts by the full interval; moved check first.

**Frontend — correctness**
- `ArubaView.jsx`: `wirelessFetched` flag was `useState` (asynchronous, causes re-render) instead of `useRef`; lazy wireless fetch could fire multiple times.
- `SurgeView.jsx`: added `typeof Chart === 'undefined'` guard to show a fallback message when Chart.js CDN is unavailable; fixed division-by-zero when `totalMin = 0` in sparkline step calculation.
- `ReportModal.jsx`: VM name, cluster, and other user-controlled strings in the `document.write()` print window were not HTML-escaped; added `esc()` helper to prevent XSS via maliciously-named VMs.
- `DNSView.jsx`: `setLoading(true)` was missing from the `useEffect` fetch path when `propData` is absent; view showed stale data with no spinner on re-mount.

**Frontend — reliability**
- `AlertsView.jsx`: `Promise.all([api.alertStatus(), api.alertHistory()])` was not wrapped in try/catch; a single rejection left the component in a permanent loading state.
- `App.jsx`: iLO data had no auto-refresh interval; added 120-second poll to keep Hosts view current without requiring a manual refresh.

**Electron**
- `main.js`: `stopBackend()` used a fire-and-forget `spawn('taskkill')` on Windows (process could outlive the app); replaced with synchronous `process.kill(proc.pid)`. Removed a duplicate `stopBackend()` call from the `window-all-closed` handler that caused a double-kill race.

---

## [1.0.0] — 2026-05-12

Initial release.

### Features
- **Overview dashboard** — unified health summary across all subsystems with optimization score, top recommendations, and 24-hour trend sparklines.
- **VMware vCenter** — cluster and VM inventory, CPU/RAM utilisation, idle and over-provisioned VM detection, right-sizing report with CSV export and print-to-PDF.
- **VM surge detection** — cyclic CPU/RAM spike detection using rolling-average smoothing and interval clustering; configurable threshold and lookback window.
- **VM snapshots** — per-VM snapshot age, depth, and size tracking.
- **Aruba networking** — Central-managed and direct-connected (AOS-CX REST + SSH ProCurve fallback) switches with port heatmap; wireless AP inventory from Aruba Central and standalone Mobility Controllers.
- **HPE Alletra 6000** — array health, capacity, dedup/compression efficiency, and per-volume drill-down.
- **Veeam Backup & Replication** — job status, repository utilisation, per-job session history heatmap.
- **HPE iLO / Redfish** — per-host power, thermals, fan status, and IML error log; manual iLO→ESXi hostname mapping.
- **DNS health monitoring** — server reachability and hostname resolution checks.
- **Performance/Watt** — power efficiency view correlating iLO power draw with vCenter CPU utilisation.
- **Alerts** — configurable thresholds with webhook notifications (Slack, Teams, generic JSON); active breach badge in the sidebar.
- **Historical trends** — SQLite-backed snapshots every 15 minutes; sparklines on the overview.
- **Live log viewer** — in-memory backend log buffer with level filtering.
- **Settings** — full in-app configuration with per-subsystem connection testing, config export/import, and `.env` editor.
- **First-time setup wizard** — guided configuration on first launch.
- **API key authentication** — all backend endpoints protected; timing-safe comparison.
- **Auto-updater** — GitHub Releases-based update delivery via `electron-updater`.
- **Windows installer** — NSIS installer with Start Menu shortcut, per-user install, and differential updates.
