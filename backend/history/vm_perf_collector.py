"""
Background VM performance collector.
Every vm_perf_interval_seconds, connects to vCenter, samples the latest
CPU% and RAM% for every powered-on VM, and writes one row per VM to the
vm_perf table.  The surge calculator reads from that table instead of
querying vCenter in real time.
"""

import asyncio
import logging
import ssl
import time

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim

from config import get_settings
import history.store as store

logger = logging.getLogger(__name__)

_BATCH = 50   # VMs per QueryPerf call — keeps individual requests manageable


def _collect_once() -> int:
    s = get_settings()
    if not s.vcenter_host:
        return 0

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    si = SmartConnect(
        host=s.vcenter_host,
        user=s.vcenter_user,
        pwd=s.vcenter_password,
        port=s.vcenter_port,
        sslContext=ctx,
    )
    try:
        content  = si.content
        perf_mgr = content.perfManager

        cpu_id = ram_id = None
        for c in perf_mgr.perfCounter:
            if c.groupInfo.key == "cpu" and c.nameInfo.key == "usage" and c.rollupType == "average":
                cpu_id = c.key
            if c.groupInfo.key == "mem" and c.nameInfo.key == "usage" and c.rollupType == "average":
                ram_id = c.key

        if cpu_id is None or ram_id is None:
            logger.warning("VM perf collector: CPU or RAM counter not found in vCenter")
            return 0

        container = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True
        )
        vms = [
            vm for vm in container.view
            if vm.runtime.powerState == vim.VirtualMachinePowerState.poweredOn
            and vm.config is not None
        ]
        container.Destroy()

        # Build metadata map: vm object → row fields
        meta: dict = {}
        for vm in vms:
            cluster_name = "standalone"
            host_obj = vm.runtime.host
            if host_obj and hasattr(host_obj, "parent"):
                parent = host_obj.parent
                if isinstance(parent, vim.ClusterComputeResource):
                    cluster_name = parent.name
            meta[vm] = {
                "vm_id":   vm.config.uuid,
                "vm_name": vm.config.name,
                "cluster": cluster_name,
                "host":    host_obj.name if host_obj else "",
            }

        ts    = time.time()
        rows: list[dict] = []

        for i in range(0, len(vms), _BATCH):
            batch = vms[i : i + _BATCH]
            # Use maxSample only — no startTime/endTime — which is the correct pattern
            # for real-time (intervalId=20) queries. Specifying a time window that
            # extends beyond the 1-hour real-time buffer causes vCenter to return empty.
            specs = [
                vim.PerformanceManager.QuerySpec(
                    entity=vm,
                    metricId=[
                        vim.PerformanceManager.MetricId(counterId=cpu_id, instance=""),
                        vim.PerformanceManager.MetricId(counterId=ram_id, instance=""),
                    ],
                    intervalId=20,
                    maxSample=3,
                )
                for vm in batch
            ]
            try:
                results = perf_mgr.QueryPerf(querySpec=specs) or []
            except Exception as e:
                logger.warning(f"VM perf batch {i//_BATCH}: {e}")
                continue

            for result in results:
                vm = result.entity
                m  = meta.get(vm)
                if not m:
                    continue

                cpu_pct = ram_pct = None
                for series in (result.value or []):
                    if not series.value:
                        continue
                    if series.id.counterId == cpu_id:
                        cpu_pct = round(series.value[-1] / 100.0, 1)
                    elif series.id.counterId == ram_id:
                        ram_pct = round(series.value[-1] / 100.0, 1)

                if cpu_pct is not None or ram_pct is not None:
                    rows.append({**m, "ts": ts, "cpu_pct": cpu_pct, "ram_pct": ram_pct})

        store.write_vm_perf(s.db_path, rows)
        store.prune_vm_perf(s.db_path, s.vm_perf_retention_days)
        logger.debug(f"VM perf: {len(rows)}/{len(vms)} VMs written")
        return len(rows)

    finally:
        Disconnect(si)


async def vm_perf_loop() -> None:
    logger.info("VM perf collector started")
    while True:
        try:
            s = get_settings()
            if s.vcenter_host:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, _collect_once)
            await asyncio.sleep(s.vm_perf_interval_seconds)
        except asyncio.CancelledError:
            logger.info("VM perf collector stopped")
            raise
        except Exception as e:
            logger.error(f"VM perf collector error: {e}")
            await asyncio.sleep(60)
