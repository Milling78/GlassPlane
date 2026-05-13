"""
vCenter connector — uses pyVmomi to pull compute utilisation data.
Uses the property collector API to bulk-fetch all VM and host properties
in a handful of RPCs rather than one per object per property.
"""

import ssl
import logging
from datetime import datetime, timezone
from typing import Optional

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim, vmodl

from config import get_settings
from models.schemas import (
    VMSummary, ClusterSummary, VCenterSummary,
    ESXiHostDetail, SnapshotDetail, VMSnapshotSummary, HealthStatus,
)

logger = logging.getLogger(__name__)

IDLE_CPU_THRESHOLD_PCT      = 5.0
OVERSIZED_CPU_THRESHOLD_PCT = 20.0
OVERSIZED_RAM_THRESHOLD_PCT = 40.0
PERF_BATCH                  = 64   # max QuerySpec per QueryPerf call
PERF_SAMPLES                = 60   # 60 × 20s = 20-min rolling avg (sufficient for idle detection)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_ssl_context() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


_counter_id_cache: dict[tuple, int] = {}


def _find_counter_id(perf_mgr, group: str, name: str, rollup: str) -> int:
    key = (group, name, rollup)
    if key in _counter_id_cache:
        return _counter_id_cache[key]
    for c in perf_mgr.perfCounter:
        if c.groupInfo.key == group and c.nameInfo.key == name and c.rollupType == rollup:
            _counter_id_cache[key] = c.key
            return c.key
    raise ValueError(f"Counter {group}/{name}/{rollup} not found")


def _collect_properties(content, obj_type, paths: list[str]) -> dict:
    """
    Fetch the given property paths for all objects of obj_type in a single
    RetrieveProperties RPC.  Returns {ManagedObject: {path: value}}.
    """
    view = content.viewManager.CreateContainerView(content.rootFolder, [obj_type], True)
    refs = list(view.view)
    view.Destroy()
    if not refs:
        return {}

    obj_specs = [
        vmodl.query.PropertyCollector.ObjectSpec(obj=r, skip=False)
        for r in refs
    ]
    prop_spec = vmodl.query.PropertyCollector.PropertySpec(
        type=obj_type, all=False, pathSet=paths,
    )
    filter_spec = vmodl.query.PropertyCollector.FilterSpec(
        objectSet=obj_specs, propSet=[prop_spec],
    )
    results = content.propertyCollector.RetrieveProperties(specSet=[filter_spec])
    return {
        oc.obj: {p.name: p.val for p in (oc.propSet or [])}
        for oc in (results or [])
    }


def _batch_cpu_avg(perf_mgr, vm_refs: list) -> dict:
    """
    Fetch 1-hour average CPU% for every VM in a single (chunked) QueryPerf call.
    Returns {vm_ref: avg_pct}.
    """
    if not vm_refs:
        return {}
    try:
        counter_id = _find_counter_id(perf_mgr, "cpu", "usage", "average")
        metric_id  = vim.PerformanceManager.MetricId(counterId=counter_id, instance="")
    except Exception as e:
        logger.warning(f"CPU counter lookup failed: {e}")
        return {}

    out: dict = {}
    for i in range(0, len(vm_refs), PERF_BATCH):
        chunk = vm_refs[i:i + PERF_BATCH]
        specs = [
            vim.PerformanceManager.QuerySpec(
                maxSample=PERF_SAMPLES, entity=vm, metricId=[metric_id], intervalId=20,
            )
            for vm in chunk
        ]
        try:
            for r in perf_mgr.QueryPerf(querySpec=specs):
                vals = [v / 100.0 for series in r.value for v in series.value if v is not None]
                if vals:
                    out[r.entity] = sum(vals) / len(vals)
        except Exception as e:
            logger.warning(f"QueryPerf chunk {i}-{i + PERF_BATCH} failed: {e}")
    return out


# ── Main fetch ────────────────────────────────────────────────────────────────

def fetch_vcenter_summary() -> VCenterSummary:
    s   = get_settings()
    ctx = _build_ssl_context()
    logger.info(f"Connecting to vCenter at {s.vcenter_host}")

    si = SmartConnect(
        host=s.vcenter_host, user=s.vcenter_user,
        pwd=s.vcenter_password, port=s.vcenter_port, sslContext=ctx,
    )
    try:
        content  = si.content
        perf_mgr = content.perfManager

        # ── 1. Bulk-fetch all VM properties (1 RPC) ───────────────────────
        vm_props = _collect_properties(content, vim.VirtualMachine, [
            "config.uuid", "config.name", "config.cpuAllocation",
            "summary.config.numCpu", "summary.config.memorySizeMB",
            "summary.runtime.powerState", "summary.runtime.host",
            "summary.quickStats.overallCpuUsage",
            "summary.quickStats.guestMemoryUsage",
            "summary.storage.committed", "summary.storage.uncommitted",
        ])

        # ── 2. Bulk-fetch all host properties (1 RPC) ────────────────────
        host_props = _collect_properties(content, vim.HostSystem, [
            "name", "parent",
            "summary.hardware.cpuMhz", "summary.hardware.numCpuCores",
            "summary.hardware.memorySize",
            "summary.quickStats.overallCpuUsage",
            "summary.quickStats.overallMemoryUsage",
        ])

        # ── 3. Bulk-fetch cluster names (1 RPC) ───────────────────────────
        cluster_props = _collect_properties(content, vim.ClusterComputeResource, ["name"])
        cluster_name_map = {ref._moId: p.get("name", "unknown") for ref, p in cluster_props.items()}

        # Build host_moId -> (host_name, cluster_name)
        host_info: dict[str, tuple[str, str]] = {}
        for ref, p in host_props.items():
            parent = p.get("parent")
            if isinstance(parent, vim.ClusterComputeResource):
                cname = cluster_name_map.get(parent._moId, "unknown")
            else:
                cname = "standalone"
            host_info[ref._moId] = (p.get("name", "unknown"), cname)

        # ── 4. Batch QueryPerf for CPU history (ceil(N/64) RPCs) ─────────
        valid_refs = [r for r, p in vm_props.items() if p.get("config.uuid")]
        avg_cpu_map = _batch_cpu_avg(perf_mgr, valid_refs)

        # ── 5. Build VMSummary list ───────────────────────────────────────
        vms: list[VMSummary] = []
        for vm_ref, p in vm_props.items():
            if not p.get("config.uuid"):
                continue

            num_cpu       = p.get("summary.config.numCpu", 1) or 1
            cpu_alloc_obj = p.get("config.cpuAllocation")
            reservation   = (getattr(cpu_alloc_obj, "reservation", None) or 1000)
            # reservation == -1 means "unlimited" in vSphere — treat as generous 1000 MHz/core
            if reservation <= 0:
                reservation = 1000
            cpu_alloc_mhz = num_cpu * reservation
            ram_alloc_mb  = p.get("summary.config.memorySizeMB") or 0
            power_state   = str(p.get("summary.runtime.powerState", "unknown"))
            host_ref      = p.get("summary.runtime.host")
            cpu_used_mhz  = float(p.get("summary.quickStats.overallCpuUsage") or 0)
            ram_used_mb   = float(p.get("summary.quickStats.guestMemoryUsage") or 0)

            cpu_util = (cpu_used_mhz / cpu_alloc_mhz * 100) if cpu_alloc_mhz else 0
            ram_util = (ram_used_mb  / ram_alloc_mb  * 100) if ram_alloc_mb  else 0

            avg_cpu      = avg_cpu_map.get(vm_ref)
            is_idle      = (avg_cpu is not None and avg_cpu < IDLE_CPU_THRESHOLD_PCT) \
                           or (cpu_util < IDLE_CPU_THRESHOLD_PCT)
            is_oversized = (cpu_util < OVERSIZED_CPU_THRESHOLD_PCT
                            and ram_util < OVERSIZED_RAM_THRESHOLD_PCT)

            host_name    = "unknown"
            cluster_name = "standalone"
            if host_ref:
                host_name, cluster_name = host_info.get(host_ref._moId, ("unknown", "standalone"))

            committed    = p.get("summary.storage.committed") or 0
            uncommitted  = p.get("summary.storage.uncommitted") or 0
            datastore_gb = (committed + uncommitted) / (1024 ** 3)

            vms.append(VMSummary(
                vm_id=p["config.uuid"],
                name=p.get("config.name", ""),
                power_state=power_state,
                cpu_allocated_mhz=cpu_alloc_mhz,
                cpu_used_mhz=cpu_used_mhz,
                cpu_util_pct=round(cpu_util, 1),
                ram_allocated_mb=ram_alloc_mb,
                ram_used_mb=ram_used_mb,
                ram_util_pct=round(ram_util, 1),
                datastore_gb=round(datastore_gb, 2),
                host=host_name,
                cluster=cluster_name,
                is_idle=is_idle,
                is_oversized=is_oversized,
            ))

        # ── 6. Cluster rollups (per-cluster resource usage) ──────────────
        clusters: list[ClusterSummary] = []
        for cl_ref, cp in cluster_props.items():
            cl_name = cp.get("name", "unknown")
            try:
                usage = cl_ref.GetResourceUsage()
                cluster_vms = [v for v in vms if v.cluster == cl_name]
                clusters.append(ClusterSummary(
                    name=cl_name,
                    host_count=len([h for h, (_, cn) in host_info.items() if cn == cl_name]),
                    total_cpu_ghz=round(usage.cpuCapacityMHz / 1000, 2),
                    used_cpu_ghz=round(usage.cpuUsedMHz / 1000, 2),
                    cpu_util_pct=round(usage.cpuUsedMHz / usage.cpuCapacityMHz * 100, 1) if usage.cpuCapacityMHz else 0,
                    total_ram_gb=round(usage.memCapacityMB / 1024, 1),
                    used_ram_gb=round(usage.memUsedMB / 1024, 1),
                    ram_util_pct=round(usage.memUsedMB / usage.memCapacityMB * 100, 1) if usage.memCapacityMB else 0,
                    vm_count=len(cluster_vms),
                    idle_vm_count=sum(1 for v in cluster_vms if v.is_idle),
                    oversized_vm_count=sum(1 for v in cluster_vms if v.is_oversized),
                    status=HealthStatus.OK,
                ))
            except Exception as e:
                logger.warning(f"Cluster {cl_name} resource usage failed: {e}")

        idle_vms      = [v for v in vms if v.is_idle]
        oversized_vms = [v for v in vms if v.is_oversized]
        wasted_cpu    = sum((v.cpu_allocated_mhz - v.cpu_used_mhz) / 1000 for v in oversized_vms)
        wasted_ram    = sum((v.ram_allocated_mb  - v.ram_used_mb)  / 1024 for v in oversized_vms)

        return VCenterSummary(
            clusters=clusters,
            vms=vms,
            total_vms=len(vms),
            powered_on=sum(1 for v in vms if v.power_state == "poweredOn"),
            idle_vms=len(idle_vms),
            oversized_vms=len(oversized_vms),
            wasted_cpu_ghz=round(wasted_cpu, 2),
            wasted_ram_gb=round(wasted_ram, 1),
        )
    finally:
        Disconnect(si)


# ── Snapshots ─────────────────────────────────────────────────────────────────

def _age_days(dt: datetime) -> float:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0


def _snapshot_size_map(layout_ex) -> dict[str, int]:
    try:
        if not layout_ex or not layout_ex.snapshot:
            return {}
        files = layout_ex.file or []
        result = {}
        for sl in layout_ex.snapshot:
            mo_id     = sl.key._moId
            size      = sum(files[k].size for k in (sl.dataKey or []) if k < len(files))
            result[mo_id] = size
        return result
    except Exception:
        return {}


def _collect_snapshot_tree(snap_list, size_map: dict, depth: int = 0) -> list[SnapshotDetail]:
    details: list[SnapshotDetail] = []
    for snap in snap_list:
        age   = _age_days(snap.createTime)
        mo_id = snap.snapshot._moId
        size_bytes = size_map.get(mo_id)
        details.append(SnapshotDetail(
            name=snap.name,
            description=snap.description or "",
            created_at=snap.createTime.isoformat(),
            age_days=round(age, 1),
            size_gb=round(size_bytes / (1024 ** 3), 2) if size_bytes is not None else None,
            depth=depth,
        ))
        details.extend(_collect_snapshot_tree(snap.childSnapshotList, size_map, depth + 1))
    return details


def fetch_vm_snapshots() -> list[VMSnapshotSummary]:
    s   = get_settings()
    ctx = _build_ssl_context()
    si  = SmartConnect(
        host=s.vcenter_host, user=s.vcenter_user,
        pwd=s.vcenter_password, port=s.vcenter_port, sslContext=ctx,
    )
    try:
        content = si.content

        # Bulk-fetch snapshot-relevant properties
        vm_props = _collect_properties(content, vim.VirtualMachine, [
            "config.uuid", "config.name",
            "snapshot", "layoutEx",
            "summary.runtime.host",
        ])

        host_props = _collect_properties(content, vim.HostSystem, ["name", "parent"])
        cluster_props = _collect_properties(content, vim.ClusterComputeResource, ["name"])
        cluster_name_map = {ref._moId: p.get("name", "unknown") for ref, p in cluster_props.items()}
        host_info: dict[str, tuple[str, str]] = {}
        for ref, p in host_props.items():
            parent = p.get("parent")
            cname  = cluster_name_map.get(parent._moId, "unknown") if isinstance(parent, vim.ClusterComputeResource) else "standalone"
            host_info[ref._moId] = (p.get("name", "unknown"), cname)

        results: list[VMSnapshotSummary] = []
        for vm_ref, p in vm_props.items():
            if not p.get("config.uuid") or not p.get("snapshot"):
                continue
            size_map = _snapshot_size_map(p.get("layoutEx"))
            snaps    = _collect_snapshot_tree(p["snapshot"].rootSnapshotList, size_map)
            if not snaps:
                continue

            ages      = [s.age_days for s in snaps]
            sizes     = [s.size_gb  for s in snaps if s.size_gb is not None]
            host_ref  = p.get("summary.runtime.host")
            host_name, cluster_name = host_info.get(host_ref._moId, ("unknown", "standalone")) if host_ref else ("unknown", "standalone")

            results.append(VMSnapshotSummary(
                vm_id=p["config.uuid"],
                vm_name=p.get("config.name", ""),
                host=host_name,
                cluster=cluster_name,
                snapshot_count=len(snaps),
                oldest_days=round(max(ages), 1),
                newest_days=round(min(ages), 1),
                total_size_gb=round(sum(sizes), 2) if sizes else None,
                snapshots=snaps,
            ))

        results.sort(key=lambda r: r.oldest_days, reverse=True)
        return results
    finally:
        Disconnect(si)


# ── ESXi hosts ────────────────────────────────────────────────────────────────

def fetch_vcenter_hosts() -> list[ESXiHostDetail]:
    s   = get_settings()
    ctx = _build_ssl_context()
    si  = SmartConnect(
        host=s.vcenter_host, user=s.vcenter_user,
        pwd=s.vcenter_password, port=s.vcenter_port, sslContext=ctx,
    )
    try:
        content = si.content

        # Bulk-fetch host properties
        host_props = _collect_properties(content, vim.HostSystem, [
            "name", "parent",
            "summary.hardware.cpuMhz", "summary.hardware.numCpuCores",
            "summary.hardware.memorySize",
            "summary.quickStats.overallCpuUsage",
            "summary.quickStats.overallMemoryUsage",
        ])
        cluster_props    = _collect_properties(content, vim.ClusterComputeResource, ["name"])
        cluster_name_map = {ref._moId: p.get("name", "unknown") for ref, p in cluster_props.items()}

        # Count powered-on VMs per host
        vm_props = _collect_properties(content, vim.VirtualMachine, [
            "config.uuid", "summary.runtime.host", "summary.runtime.powerState",
        ])
        host_vm_count: dict[str, int] = {}
        for _, p in vm_props.items():
            if p.get("config.uuid") and str(p.get("summary.runtime.powerState")) == "poweredOn":
                h = p.get("summary.runtime.host")
                if h:
                    host_vm_count[h._moId] = host_vm_count.get(h._moId, 0) + 1

        results: list[ESXiHostDetail] = []
        for ref, p in host_props.items():
            cpu_mhz    = p.get("summary.hardware.cpuMhz", 0) or 0
            num_cores  = p.get("summary.hardware.numCpuCores", 0) or 0
            total_mhz  = cpu_mhz * num_cores
            used_mhz   = int(p.get("summary.quickStats.overallCpuUsage") or 0)
            mem_bytes  = p.get("summary.hardware.memorySize") or 0
            total_ram_mb = int(mem_bytes // (1024 * 1024))
            used_ram_mb  = int(p.get("summary.quickStats.overallMemoryUsage") or 0)

            parent = p.get("parent")
            cluster_name = cluster_name_map.get(parent._moId, "unknown") if isinstance(parent, vim.ClusterComputeResource) else "standalone"

            results.append(ESXiHostDetail(
                name=p.get("name", "unknown"),
                cluster=cluster_name,
                cpu_total_mhz=total_mhz,
                cpu_used_mhz=used_mhz,
                cpu_util_pct=round(used_mhz / total_mhz * 100, 1) if total_mhz else 0.0,
                ram_total_mb=total_ram_mb,
                ram_used_mb=used_ram_mb,
                ram_util_pct=round(used_ram_mb / total_ram_mb * 100, 1) if total_ram_mb else 0.0,
                vm_count=host_vm_count.get(ref._moId, 0),
            ))

        return results
    finally:
        Disconnect(si)
