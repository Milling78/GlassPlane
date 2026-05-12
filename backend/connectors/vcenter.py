"""
vCenter connector — uses pyVmomi to pull compute utilisation data.
Identifies idle VMs (avg CPU < 5%) and oversized VMs (alloc >> peak).
"""

import ssl
import logging
from typing import Optional

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim

from config import get_settings
from models.schemas import VMSummary, ClusterSummary, VCenterSummary, HealthStatus

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


def _query_vm_cpu_avg(perf_mgr, vm) -> Optional[float]:
    """Return average CPU usage % over the last hour (sampled at 20s intervals)."""
    try:
        metric_id = vim.PerformanceManager.MetricId(
            counterId=_find_counter_id(perf_mgr, "cpu", "usage", "average"),
            instance=""
        )
        spec = vim.PerformanceManager.QuerySpec(
            maxSample=180,  # 1 hour at 20s
            entity=vm,
            metricId=[metric_id],
            intervalId=20
        )
        result = perf_mgr.QueryPerf(querySpec=[spec])
        if result and result[0].value:
            vals = [v.value[0] / 100.0 for v in result[0].value if v.value]
            return sum(vals) / len(vals) if vals else None
    except Exception as e:
        logger.debug(f"Perf query failed for {vm.name}: {e}")
    return None


def _find_counter_id(perf_mgr, group: str, name: str, rollup: str) -> int:
    for c in perf_mgr.perfCounter:
        if c.groupInfo.key == group and c.nameInfo.key == name and c.rollupType == rollup:
            return c.key
    raise ValueError(f"Counter {group}/{name}/{rollup} not found")


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

        vms: list[VMSummary] = []
        for vm in raw_vms:
            if vm.config is None:
                continue

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

            avg_cpu = _query_vm_cpu_avg(perf_mgr, vm)
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
