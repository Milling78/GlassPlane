"""
vCenter connector — uses pyVmomi to pull compute utilisation data.
Identifies idle VMs (avg CPU < 5%) and oversized VMs (alloc >> peak).
"""

import ssl
import logging
from datetime import datetime, timezone
from typing import Optional

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim

from config import get_settings
from models.schemas import VMSummary, ClusterSummary, VCenterSummary, ESXiHostDetail, SnapshotDetail, VMSnapshotSummary, HealthStatus

logger = logging.getLogger(__name__)

IDLE_CPU_THRESHOLD_PCT = 5.0        # VM avg CPU% below this = idle
OVERSIZED_CPU_THRESHOLD_PCT = 20.0  # VM peak CPU% below this = oversized
OVERSIZED_RAM_THRESHOLD_PCT = 40.0  # VM peak RAM% below this = oversized


def _build_ssl_context() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _get_perf_manager(si):
    return si.content.perfManager


def _find_counter_id(perf_mgr, group: str, name: str, rollup: str) -> int:
    for c in perf_mgr.perfCounter:
        if c.groupInfo.key == group and c.nameInfo.key == name and c.rollupType == rollup:
            return c.key
    raise ValueError(f"Counter {group}/{name}/{rollup} not found")


def _batch_cpu_avg(perf_mgr, vms: list) -> dict:
    """Single QueryPerf call covering all VMs. Returns {vim.VirtualMachine: avg_cpu_pct}."""
    if not vms:
        return {}
    try:
        counter_id = _find_counter_id(perf_mgr, "cpu", "usage", "average")
        metric_id  = vim.PerformanceManager.MetricId(counterId=counter_id, instance="")
        specs = [
            vim.PerformanceManager.QuerySpec(
                maxSample=180, entity=vm, metricId=[metric_id], intervalId=20
            )
            for vm in vms
        ]
        results = perf_mgr.QueryPerf(querySpec=specs)
        out: dict = {}
        for r in results:
            vals = []
            for series in r.value:
                vals.extend(v / 100.0 for v in series.value if v is not None)
            if vals:
                out[r.entity] = sum(vals) / len(vals)
        return out
    except Exception as e:
        logger.warning(f"Batch perf query failed: {e}")
        return {}


def fetch_vcenter_summary() -> VCenterSummary:
    settings = get_settings()
    ctx = _build_ssl_context()

    logger.info(f"Connecting to vCenter at {settings.vcenter_host}")
    si = SmartConnect(
        host=settings.vcenter_host,
        user=settings.vcenter_user,
        pwd=settings.vcenter_password,
        port=settings.vcenter_port,
        sslContext=ctx
    )

    try:
        content = si.content
        perf_mgr = _get_perf_manager(si)

        container = content.viewManager.CreateContainerView(
            content.rootFolder,
            [vim.VirtualMachine],
            True
        )
        raw_vms = container.view
        container.Destroy()

        # Filter VMs with valid config, then fetch all perf data in one batch call
        valid_vms = [vm for vm in raw_vms if vm.config is not None]
        avg_cpu_map = _batch_cpu_avg(perf_mgr, valid_vms)

        vms: list[VMSummary] = []
        for vm in valid_vms:
            summary = vm.summary
            config = summary.config
            runtime = summary.runtime
            quick = summary.quickStats

            cpu_alloc_mhz = config.numCpu * (
                vm.config.cpuAllocation.reservation or 1000
            )
            ram_alloc_mb = config.memorySizeMB
            cpu_used_mhz = float(quick.overallCpuUsage or 0)
            ram_used_mb = float(quick.guestMemoryUsage or 0)

            cpu_util = (cpu_used_mhz / cpu_alloc_mhz * 100) if cpu_alloc_mhz else 0
            ram_util = (ram_used_mb / ram_alloc_mb * 100) if ram_alloc_mb else 0

            avg_cpu = avg_cpu_map.get(vm)
            is_idle = (avg_cpu is not None and avg_cpu < IDLE_CPU_THRESHOLD_PCT) \
                      or (cpu_util < IDLE_CPU_THRESHOLD_PCT)
            is_oversized = cpu_util < OVERSIZED_CPU_THRESHOLD_PCT \
                           and ram_util < OVERSIZED_RAM_THRESHOLD_PCT

            # Resolve cluster name
            host_obj = runtime.host
            cluster_name = "standalone"
            if host_obj and hasattr(host_obj, "parent"):
                parent = host_obj.parent
                if isinstance(parent, vim.ClusterComputeResource):
                    cluster_name = parent.name

            datastore_gb = 0.0
            for ds in vm.storage.perDatastoreUsage if vm.storage else []:
                datastore_gb += (ds.committed + ds.uncommitted) / (1024 ** 3)

            vms.append(VMSummary(
                vm_id=vm.config.uuid,
                name=config.name,
                power_state=str(runtime.powerState),
                cpu_allocated_mhz=cpu_alloc_mhz,
                cpu_used_mhz=cpu_used_mhz,
                cpu_util_pct=round(cpu_util, 1),
                ram_allocated_mb=ram_alloc_mb,
                ram_used_mb=ram_used_mb,
                ram_util_pct=round(ram_util, 1),
                datastore_gb=round(datastore_gb, 2),
                host=host_obj.name if host_obj else "unknown",
                cluster=cluster_name,
                is_idle=is_idle,
                is_oversized=is_oversized
            ))

        # Build cluster-level rollups
        clusters_raw = content.viewManager.CreateContainerView(
            content.rootFolder,
            [vim.ClusterComputeResource],
            True
        )
        clusters: list[ClusterSummary] = []
        for cl in clusters_raw.view:
            usage = cl.GetResourceUsage()
            cluster_vms = [v for v in vms if v.cluster == cl.name]
            clusters.append(ClusterSummary(
                name=cl.name,
                host_count=len(cl.host),
                total_cpu_ghz=round(usage.cpuCapacityMHz / 1000, 2),
                used_cpu_ghz=round(usage.cpuUsedMHz / 1000, 2),
                cpu_util_pct=round(usage.cpuUsedMHz / usage.cpuCapacityMHz * 100, 1) if usage.cpuCapacityMHz else 0,
                total_ram_gb=round(usage.memCapacityMB / 1024, 1),
                used_ram_gb=round(usage.memUsedMB / 1024, 1),
                ram_util_pct=round(usage.memUsedMB / usage.memCapacityMB * 100, 1) if usage.memCapacityMB else 0,
                vm_count=len(cluster_vms),
                idle_vm_count=sum(1 for v in cluster_vms if v.is_idle),
                oversized_vm_count=sum(1 for v in cluster_vms if v.is_oversized),
                status=HealthStatus.OK
            ))
        clusters_raw.Destroy()

        idle_vms = [v for v in vms if v.is_idle]
        oversized_vms = [v for v in vms if v.is_oversized]

        wasted_cpu = sum(
            (v.cpu_allocated_mhz - v.cpu_used_mhz) / 1000
            for v in oversized_vms
        )
        wasted_ram = sum(
            (v.ram_allocated_mb - v.ram_used_mb) / 1024
            for v in oversized_vms
        )

        return VCenterSummary(
            clusters=clusters,
            vms=vms,
            total_vms=len(vms),
            powered_on=sum(1 for v in vms if v.power_state == "poweredOn"),
            idle_vms=len(idle_vms),
            oversized_vms=len(oversized_vms),
            wasted_cpu_ghz=round(wasted_cpu, 2),
            wasted_ram_gb=round(wasted_ram, 1)
        )
    finally:
        Disconnect(si)


def _age_days(dt: datetime) -> float:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0


def _snapshot_size_map(vm) -> dict[str, int]:
    """Return {snapshot_moref_id: size_bytes} using layoutEx delta-file data."""
    try:
        lex = vm.layoutEx
        if not lex or not lex.snapshot:
            return {}
        files = lex.file or []
        result = {}
        for sl in lex.snapshot:
            mo_id = sl.key._moId
            size  = sum(files[k].size for k in (sl.dataKey or []) if k < len(files))
            result[mo_id] = size
        return result
    except Exception:
        return {}


def _collect_snapshot_tree(snap_list, size_map: dict, depth: int = 0) -> list[SnapshotDetail]:
    details: list[SnapshotDetail] = []
    for snap in snap_list:
        age  = _age_days(snap.createTime)
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
    """Return all VMs that have at least one snapshot, with per-snapshot detail."""
    settings = get_settings()
    ctx = _build_ssl_context()
    si = SmartConnect(
        host=settings.vcenter_host, user=settings.vcenter_user,
        pwd=settings.vcenter_password, port=settings.vcenter_port, sslContext=ctx,
    )
    try:
        content = si.content
        vm_view = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True
        )
        results: list[VMSnapshotSummary] = []
        for vm in vm_view.view:
            if vm.config is None or vm.snapshot is None:
                continue

            size_map = _snapshot_size_map(vm)
            snaps    = _collect_snapshot_tree(vm.snapshot.rootSnapshotList, size_map)
            if not snaps:
                continue

            ages      = [s.age_days for s in snaps]
            sizes     = [s.size_gb for s in snaps if s.size_gb is not None]
            total_gb  = round(sum(sizes), 2) if sizes else None

            host_obj     = vm.summary.runtime.host
            cluster_name = "standalone"
            if host_obj and isinstance(host_obj.parent, vim.ClusterComputeResource):
                cluster_name = host_obj.parent.name

            results.append(VMSnapshotSummary(
                vm_id=vm.config.uuid,
                vm_name=vm.config.name,
                host=host_obj.name if host_obj else "unknown",
                cluster=cluster_name,
                snapshot_count=len(snaps),
                oldest_days=round(max(ages), 1),
                newest_days=round(min(ages), 1),
                total_size_gb=total_gb,
                snapshots=snaps,
            ))
        vm_view.Destroy()
        results.sort(key=lambda r: r.oldest_days, reverse=True)
        return results
    finally:
        Disconnect(si)


def fetch_vcenter_hosts() -> list[ESXiHostDetail]:
    """Return per-ESXi-host hardware and utilisation metrics."""
    settings = get_settings()
    ctx = _build_ssl_context()

    si = SmartConnect(
        host=settings.vcenter_host,
        user=settings.vcenter_user,
        pwd=settings.vcenter_password,
        port=settings.vcenter_port,
        sslContext=ctx
    )
    try:
        content = si.content

        # Count powered-on VMs per ESXi host
        vm_view = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True
        )
        host_vm_count: dict[str, int] = {}
        for vm in vm_view.view:
            if vm.config and vm.summary.runtime.host:
                hn = vm.summary.runtime.host.name
                host_vm_count[hn] = host_vm_count.get(hn, 0) + 1
        vm_view.Destroy()

        host_view = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.HostSystem], True
        )
        results: list[ESXiHostDetail] = []
        for host in host_view.view:
            hw = host.summary.hardware
            qs = host.summary.quickStats
            if hw is None:
                continue

            total_mhz = hw.cpuMhz * hw.numCpuCores
            used_mhz  = int(qs.overallCpuUsage or 0)
            total_ram_mb = int(hw.memorySize // (1024 * 1024))
            used_ram_mb  = int(qs.overallMemoryUsage or 0)

            cluster_name = "standalone"
            if isinstance(host.parent, vim.ClusterComputeResource):
                cluster_name = host.parent.name

            results.append(ESXiHostDetail(
                name=host.name,
                cluster=cluster_name,
                cpu_total_mhz=total_mhz,
                cpu_used_mhz=used_mhz,
                cpu_util_pct=round(used_mhz / total_mhz * 100, 1) if total_mhz else 0.0,
                ram_total_mb=total_ram_mb,
                ram_used_mb=used_ram_mb,
                ram_util_pct=round(used_ram_mb / total_ram_mb * 100, 1) if total_ram_mb else 0.0,
                vm_count=host_vm_count.get(host.name, 0),
            ))
        host_view.Destroy()
        return results
    finally:
        Disconnect(si)
