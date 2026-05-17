"""
Windows Remote Desktop Services connector.
Fetches session and host health data by running a PowerShell script locally.

Priority order:
  1. RD Connection Broker cmdlets (Get-RDUserSession / Get-RDSessionHost) — requires
     RemoteDesktop PS module (RSAT-RDS-Tools) and Broker FQDN in config.
  2. Direct per-host mode — qwinsta + CIM against each configured RDSH hostname.
     Works without any RSAT modules; needs WinRM/DCOM access to the TS hosts.
"""

import json
import logging
import os
import subprocess
import tempfile

from config import get_settings
from models.schemas import RDSHostSummary, RDSSummary, RDSUserSession, HealthStatus

logger = logging.getLogger(__name__)

# ── PowerShell script ─────────────────────────────────────────────────────────
# Written to a temp .ps1 file at call time to avoid shell-escaping issues.

_PS_SCRIPT = r"""
param([string]$Broker="",[string]$HostList="",[int]$WarnPct=75,[int]$CritPct=90)
$ErrorActionPreference='SilentlyContinue'
$out=[ordered]@{method="unconfigured";hosts=@();sessions=@();error=$null}

function Get-HostData([string]$h){
    $d=[ordered]@{hostname=$h;status="Unreachable";active_sessions=0;disconnected_sessions=0;cpu_pct=$null;ram_pct=$null;load_pct=$null}
    try{
        $lines=(& qwinsta /server:$h 2>$null)|Select-Object -Skip 1
        foreach($ln in $lines){
            if($ln.Length -lt 48){continue}
            $remaining=$ln.Substring(40)
            if($remaining -match '^\s*(\d+)\s+(Active|Disc)'){
                if($Matches[2] -eq 'Active'){$d.active_sessions++}else{$d.disconnected_sessions++}
            }
        }
        $d.status="Available"
    }catch{}
    try{
        $cpu=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -ComputerName $h -Filter "Name='_Total'" -OperationTimeoutSec 8)
        if($cpu){$d.cpu_pct=[math]::Round([double]$cpu.PercentProcessorTime,1)}
    }catch{}
    try{
        $os=(Get-CimInstance Win32_OperatingSystem -ComputerName $h -OperationTimeoutSec 8)
        if($os -and $os.TotalVisibleMemorySize -gt 0){
            $d.ram_pct=[math]::Round((1-$os.FreePhysicalMemory/$os.TotalVisibleMemorySize)*100,1)
        }
    }catch{}
    return $d
}

function Get-Sessions([string]$h){
    $list=@()
    try{
        $lines=(& qwinsta /server:$h 2>$null)|Select-Object -Skip 1
        foreach($ln in $lines){
            if($ln.Length -lt 48){continue}
            $userName=$ln.Substring(18,22).Trim()
            $remaining=$ln.Substring(40)
            if($userName -ne '' -and $remaining -match '^\s*(\d+)\s+(Active|Disc)'){
                $list+=@{
                    username=$userName
                    state=if($Matches[2] -eq 'Active'){'Active'}else{'Disconnected'}
                    host=$h;session_id=[int]$Matches[1]
                    domain=$null;idle_minutes=$null;client_name=$null
                }
            }
        }
    }catch{}
    return $list
}

# Try RD Connection Broker cmdlets
$brokerOk=$false
if($Broker -ne ""){
    try{
        Import-Module RemoteDesktop -ErrorAction Stop
        $cols=Get-RDSessionCollection -ConnectionBroker $Broker -ErrorAction Stop
        foreach($col in $cols){
            $rdHosts=Get-RDSessionHost -CollectionName $col.CollectionName -ConnectionBroker $Broker
            foreach($rdh in $rdHosts){
                $d=Get-HostData -h $rdh.SessionHost
                if($null -ne $rdh.LoadIndexLoad){$d.load_pct=[math]::Round([double]$rdh.LoadIndexLoad,1)}
                $nc=$rdh.NewConnectionAllowed
                if($nc -in @('Yes',$true)){$d.status='Available'}
                elseif($nc -in @('No',$false)){$d.status='Unavailable'}
                $out.hosts+=$d
            }
        }
        foreach($col in $cols){
            $rdSess=Get-RDUserSession -CollectionName $col.CollectionName -ConnectionBroker $Broker
            foreach($s in $rdSess){
                $st=switch($s.SessionState){
                    'STATE_ACTIVE'{'Active'}
                    'STATE_DISCONNECTED'{'Disconnected'}
                    default{[string]$s.SessionState}
                }
                $idleMin=$null
                try{
                    if($s.IdleTime -and [string]$s.IdleTime -ne '00:00:00'){
                        $ts=[TimeSpan]::Parse($s.IdleTime)
                        $idleMin=[int]$ts.TotalMinutes
                    }
                }catch{}
                $out.sessions+=@{
                    username=$s.UserName;domain=$s.DomainName;state=$st
                    host=$s.HostServer;session_id=$s.UnifiedSessionID
                    idle_minutes=$idleMin;client_name=$null
                }
            }
        }
        $out.method="broker"
        $brokerOk=$true
    }catch{
        $out.error=$_.Exception.Message
        $out.method="broker_error"
    }
}

# Direct mode — no broker or broker failed
if(-not $brokerOk){
    $hlist=@($HostList -split ',')| ForEach-Object{$_.Trim()}|Where-Object{$_ -ne ""}
    foreach($h in $hlist){
        $out.hosts+=Get-HostData -h $h
        $out.sessions+=Get-Sessions -h $h
    }
    if($hlist.Count -gt 0){$out.method="direct"}
}

$out|ConvertTo-Json -Depth 4 -Compress
"""


def fetch_rds_summary() -> RDSSummary:
    s = get_settings()
    broker = s.rds_broker.strip()
    host_list = s.rds_hosts.strip()

    if not broker and not host_list:
        return RDSSummary(
            broker="", host_count=0, total_active=0, total_disconnected=0,
            total_sessions=0, hosts=[], sessions=[],
            status=HealthStatus.OK, method="unconfigured",
        )

    ps_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".ps1", delete=False, encoding="utf-8"
        ) as f:
            f.write(_PS_SCRIPT)
            ps_path = f.name

        result = subprocess.run(
            [
                "powershell", "-NonInteractive", "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", ps_path,
                "-Broker", broker,
                "-HostList", host_list,
                "-WarnPct", str(int(s.rds_warn_load_pct)),
                "-CritPct", str(int(s.rds_crit_load_pct)),
            ],
            capture_output=True, text=True, timeout=120,
        )

        stdout = result.stdout.strip()
        if not stdout:
            stderr = result.stderr.strip()[:200]
            raise RuntimeError(f"No output from PowerShell script. stderr: {stderr}")

        data = json.loads(stdout)

    except (subprocess.TimeoutExpired, json.JSONDecodeError, RuntimeError) as e:
        logger.warning(f"RDS fetch failed: {e}")
        return RDSSummary(
            broker=broker, host_count=0, total_active=0, total_disconnected=0,
            total_sessions=0, hosts=[], sessions=[],
            status=HealthStatus.WARNING, method="error",
        )
    finally:
        if ps_path:
            try:
                os.unlink(ps_path)
            except OSError:
                pass

    hosts: list[RDSHostSummary] = []
    sessions: list[RDSUserSession] = []

    for h in data.get("hosts") or []:
        active = int(h.get("active_sessions") or 0)
        disc = int(h.get("disconnected_sessions") or 0)
        hosts.append(RDSHostSummary(
            hostname=h.get("hostname", ""),
            status=h.get("status", "Unknown"),
            active_sessions=active,
            disconnected_sessions=disc,
            total_sessions=active + disc,
            cpu_pct=_safe_float(h.get("cpu_pct")),
            ram_pct=_safe_float(h.get("ram_pct")),
            load_pct=_safe_float(h.get("load_pct")),
        ))

    for sess in data.get("sessions") or []:
        username = (sess.get("username") or "").strip()
        if not username:
            continue
        sessions.append(RDSUserSession(
            username=username,
            domain=sess.get("domain") or None,
            state=sess.get("state", "Unknown"),
            host=sess.get("host", ""),
            idle_minutes=_safe_int(sess.get("idle_minutes")),
            session_id=_safe_int(sess.get("session_id")),
            client_name=sess.get("client_name") or None,
        ))

    # Deduplicate sessions (broker + direct can overlap)
    seen: set[tuple] = set()
    unique_sessions: list[RDSUserSession] = []
    for sess in sessions:
        key = (sess.username.lower(), sess.host.lower(), sess.state)
        if key not in seen:
            seen.add(key)
            unique_sessions.append(sess)
    sessions = sorted(unique_sessions, key=lambda x: (x.state != "Active", x.username.lower()))

    hosts.sort(key=lambda h: h.hostname.lower())

    total_active = sum(h.active_sessions for h in hosts)
    total_disc = sum(h.disconnected_sessions for h in hosts)

    # Overall health: critical if any host unreachable, warning if CPU high or disconnected sessions piled up
    worst = HealthStatus.OK
    for h in hosts:
        status_lc = h.status.lower()
        if status_lc == "unreachable":
            worst = HealthStatus.WARNING
        if h.cpu_pct is not None:
            if h.cpu_pct >= s.rds_crit_load_pct:
                worst = HealthStatus.CRITICAL
                break
            elif h.cpu_pct >= s.rds_warn_load_pct and worst != HealthStatus.CRITICAL:
                worst = HealthStatus.WARNING

    return RDSSummary(
        broker=broker,
        host_count=len(hosts),
        total_active=total_active,
        total_disconnected=total_disc,
        total_sessions=total_active + total_disc,
        hosts=hosts,
        sessions=sessions,
        status=worst,
        method=data.get("method", "unknown"),
    )


def _safe_float(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _safe_int(v) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None
