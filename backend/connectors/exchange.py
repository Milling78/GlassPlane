"""
MS Exchange connector — Exchange Management Shell via PowerShell remoting.
Connects to http://<server>/PowerShell/ (Exchange Remote PS endpoint).
Requires an account with View-Only Organization Management or higher.
"""

import json
import logging
import os
import subprocess
import tempfile

from config import get_settings
from models.schemas import (
    ExchangeSummary, ExchangeMailboxDB, ExchangeQueue,
    ExchangeServerSummary, HealthStatus,
)

logger = logging.getLogger(__name__)

_PS_SCRIPT = r"""
param(
    [string]$Server,
    [string]$User,
    [string]$Password,
    [string]$Domain = ""
)

$ErrorActionPreference = "Stop"

try {
    $SecPass = ConvertTo-SecureString $Password -AsPlainText -Force
    $CredUser = if ($Domain) { "$Domain\$User" } else { $User }
    $Cred = New-Object System.Management.Automation.PSCredential($CredUser, $SecPass)

    $sessOpts = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
    $session = New-PSSession `
        -ConfigurationName Microsoft.Exchange `
        -ConnectionUri "http://$Server/PowerShell/" `
        -Authentication Kerberos `
        -Credential $Cred `
        -SessionOption $sessOpts `
        -ErrorAction Stop

    $data = Invoke-Command -Session $session -ScriptBlock {
        $servers = @()
        try {
            $servers = Get-ExchangeServer -Status | ForEach-Object {
                [PSCustomObject]@{
                    Name    = $_.Name
                    Version = $_.AdminDisplayVersion.ToString()
                    Roles   = $_.ServerRole.ToString()
                }
            }
        } catch {}

        $databases = @()
        try {
            $databases = Get-MailboxDatabase -Status | ForEach-Object {
                $db = $_
                $sizeMB = 0; $wsMB = 0
                try { $sizeMB = [math]::Round($db.DatabaseSize.ToBytes() / 1MB, 0) } catch {}
                try { $wsMB  = [math]::Round($db.AvailableNewMailboxSpace.ToBytes() / 1MB, 0) } catch {}
                [PSCustomObject]@{
                    Name         = $db.Name
                    Server       = if ($db.Server) { $db.Server.Name } else { "" }
                    Mounted      = $db.Mounted
                    SizeMB       = $sizeMB
                    WhitespaceMB = $wsMB
                    MailboxCount = $db.MailboxCount
                }
            }
        } catch {}

        $dagName = ""
        try {
            $dags = Get-DatabaseAvailabilityGroup
            if ($dags) { $dagName = ($dags | Select-Object -First 1).Name }
        } catch {}

        $copyStatus = @()
        try {
            $copyStatus = Get-MailboxDatabaseCopyStatus * | ForEach-Object {
                [PSCustomObject]@{
                    Name            = $_.DatabaseName
                    Status          = $_.Status.ToString()
                    CopyQueueLength = $_.CopyQueueLength
                }
            }
        } catch {}

        $queues = @()
        try {
            $queues = Get-Queue | ForEach-Object {
                [PSCustomObject]@{
                    Identity     = $_.Identity.ToString()
                    DeliveryType = $_.DeliveryType.ToString()
                    MessageCount = $_.MessageCount
                    Status       = $_.Status.ToString()
                    NextHop      = $_.NextHopDomain
                }
            }
        } catch {}

        $components = @()
        try {
            foreach ($srv in $servers) {
                $states = Get-ServerComponentState -Identity $srv.Name |
                    Select-Object Component, @{N='State';E={$_.State.ToString()}}
                $components += [PSCustomObject]@{ Server = $srv.Name; States = $states }
            }
        } catch {}

        @{
            Servers     = $servers
            Databases   = $databases
            DagName     = $dagName
            CopyStatus  = $copyStatus
            Queues      = $queues
            Components  = $components
        }
    }

    Remove-PSSession $session -ErrorAction SilentlyContinue
    $data | ConvertTo-Json -Depth 6
} catch {
    @{ Error = $_.Exception.Message } | ConvertTo-Json -Depth 2
}
"""


def _safe_float(val, divisor=1):
    try:
        return round(float(val) / divisor, 2) if val is not None else None
    except (TypeError, ValueError):
        return None


def _safe_int(val):
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def fetch_exchange_summary() -> ExchangeSummary:
    s = get_settings()
    if not s.exchange_server or not s.exchange_user or not s.exchange_password:
        return ExchangeSummary(
            status=HealthStatus.UNKNOWN,
            method="unconfigured",
        )

    ps_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".ps1", mode="w",
                                         encoding="utf-8", delete=False) as f:
            f.write(_PS_SCRIPT)
            ps_path = f.name

        result = subprocess.run(
            [
                "powershell", "-NonInteractive", "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", ps_path,
                "-Server",   s.exchange_server,
                "-User",     s.exchange_user,
                "-Password", s.exchange_password,
                "-Domain",   s.exchange_domain or "",
            ],
            capture_output=True, text=True, timeout=60,
        )

        raw = result.stdout.strip()
        if not raw:
            stderr = result.stderr.strip()[:300]
            logger.error(f"Exchange PS returned no output. stderr: {stderr}")
            return ExchangeSummary(status=HealthStatus.UNKNOWN, method="error")

        data = json.loads(raw)

        if "Error" in data:
            logger.error(f"Exchange PS error: {data['Error']}")
            return ExchangeSummary(status=HealthStatus.UNKNOWN, method="error")

        # ── Servers ──────────────────────────────────────────────────────────
        raw_components: dict[str, dict] = {}
        for comp_entry in (data.get("Components") or []):
            if not isinstance(comp_entry, dict):
                continue
            srv_name = comp_entry.get("Server", "")
            states = comp_entry.get("States") or []
            if isinstance(states, dict):
                states = [states]
            active = sum(1 for st in states if isinstance(st, dict) and st.get("State", "").lower() == "active")
            inactive = sum(1 for st in states if isinstance(st, dict) and st.get("State", "").lower() != "active")
            raw_components[srv_name] = {"active": active, "inactive": inactive}

        servers: list[ExchangeServerSummary] = []
        for srv in (data.get("Servers") or []):
            if not isinstance(srv, dict):
                continue
            name = srv.get("Name", "")
            comp = raw_components.get(name, {})
            servers.append(ExchangeServerSummary(
                name=name,
                version=srv.get("Version", ""),
                roles=srv.get("Roles", ""),
                components_active=comp.get("active", 0),
                components_inactive=comp.get("inactive", 0),
            ))

        # ── Copy status lookup ────────────────────────────────────────────────
        copy_lookup: dict[str, dict] = {}
        for cs in (data.get("CopyStatus") or []):
            if not isinstance(cs, dict):
                continue
            db_name = cs.get("Name", "")
            copy_lookup.setdefault(db_name, {"status": cs.get("Status", "Unknown"),
                                              "queue": _safe_int(cs.get("CopyQueueLength")) or 0})

        # ── Databases ─────────────────────────────────────────────────────────
        databases: list[ExchangeMailboxDB] = []
        for db in (data.get("Databases") or []):
            if not isinstance(db, dict):
                continue
            db_name = db.get("Name", "")
            cs = copy_lookup.get(db_name, {})
            databases.append(ExchangeMailboxDB(
                name=db_name,
                server=db.get("Server", ""),
                mounted=bool(db.get("Mounted", False)),
                size_gb=_safe_float(db.get("SizeMB"), 1024),
                whitespace_gb=_safe_float(db.get("WhitespaceMB"), 1024),
                mailbox_count=_safe_int(db.get("MailboxCount")),
                copy_status=cs.get("status", "Unknown"),
                copy_queue_length=cs.get("queue", 0),
            ))

        # ── Queues ────────────────────────────────────────────────────────────
        queues: list[ExchangeQueue] = []
        for q in (data.get("Queues") or []):
            if not isinstance(q, dict):
                continue
            queues.append(ExchangeQueue(
                identity=q.get("Identity", ""),
                delivery_type=q.get("DeliveryType", ""),
                message_count=_safe_int(q.get("MessageCount")) or 0,
                status=q.get("Status", ""),
                next_hop=q.get("NextHop") or None,
            ))
        queues.sort(key=lambda q: q.message_count, reverse=True)

        # ── Health ────────────────────────────────────────────────────────────
        dismounted = sum(1 for db in databases if not db.mounted)
        mounted    = sum(1 for db in databases if db.mounted)
        total_q    = sum(q.message_count for q in queues)
        max_q      = max((q.message_count for q in queues), default=0)

        health = HealthStatus.OK
        if dismounted > 0 or max_q >= s.exchange_transport_crit_queue:
            health = HealthStatus.CRITICAL
        elif max_q >= s.exchange_transport_warn_queue:
            health = HealthStatus.WARNING
        elif any(db.copy_status not in ("Healthy", "Unknown", "") for db in databases):
            health = HealthStatus.WARNING

        return ExchangeSummary(
            servers=servers,
            databases=databases,
            queues=queues,
            dag_name=data.get("DagName") or "",
            total_queued=total_q,
            databases_mounted=mounted,
            databases_dismounted=dismounted,
            status=health,
            method="remote_ps",
        )

    except subprocess.TimeoutExpired:
        logger.error("Exchange PS timed out")
        return ExchangeSummary(status=HealthStatus.UNKNOWN, method="error")
    except json.JSONDecodeError as e:
        logger.error(f"Exchange PS JSON parse error: {e}")
        return ExchangeSummary(status=HealthStatus.UNKNOWN, method="error")
    except Exception as e:
        logger.error(f"Exchange connector error: {e}", exc_info=True)
        return ExchangeSummary(status=HealthStatus.UNKNOWN, method="error")
    finally:
        if ps_path and os.path.exists(ps_path):
            try:
                os.unlink(ps_path)
            except OSError:
                pass
