# Changelog

All notable changes to Infra Glassplane are documented here.

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
