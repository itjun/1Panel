//go:build darwin

package localsys

/*
#cgo CFLAGS: -Wno-deprecated-declarations
#include <mach/mach.h>
#include <mach/mach_host.h>
#include <mach/host_info.h>
#include <mach/processor_info.h>

static int localsys_cpu_ticks(natural_t *user, natural_t *system, natural_t *idle, natural_t *nice) {
	host_cpu_load_info_data_t info;
	mach_msg_type_number_t count = HOST_CPU_LOAD_INFO_COUNT;
	kern_return_t kr = host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, (host_info_t)&info, &count);
	if (kr != KERN_SUCCESS) {
		return -1;
	}
	*user = info.cpu_ticks[CPU_STATE_USER];
	*system = info.cpu_ticks[CPU_STATE_SYSTEM];
	*idle = info.cpu_ticks[CPU_STATE_IDLE];
	*nice = info.cpu_ticks[CPU_STATE_NICE];
	return 0;
}

// localsys_per_cpu_ticks 按逻辑核填充 tick；调用方保证数组长度 ≥ max_cpus。
// 成功返回 0，*out_count 为实际核数。
static int localsys_per_cpu_ticks(
	natural_t *users,
	natural_t *systems,
	natural_t *idles,
	natural_t *nices,
	unsigned int max_cpus,
	unsigned int *out_count
) {
	natural_t cpu_count = 0;
	processor_info_array_t info_array = NULL;
	mach_msg_type_number_t info_count = 0;
	kern_return_t kr = host_processor_info(
		mach_host_self(),
		PROCESSOR_CPU_LOAD_INFO,
		&cpu_count,
		&info_array,
		&info_count
	);
	if (kr != KERN_SUCCESS || info_array == NULL) {
		return -1;
	}
	unsigned int n = cpu_count;
	if (n > max_cpus) {
		n = max_cpus;
	}
	processor_cpu_load_info_data_t *load = (processor_cpu_load_info_data_t *)info_array;
	for (unsigned int i = 0; i < n; i++) {
		users[i] = load[i].cpu_ticks[CPU_STATE_USER];
		systems[i] = load[i].cpu_ticks[CPU_STATE_SYSTEM];
		idles[i] = load[i].cpu_ticks[CPU_STATE_IDLE];
		nices[i] = load[i].cpu_ticks[CPU_STATE_NICE];
	}
	*out_count = n;
	vm_deallocate(mach_task_self(), (vm_address_t)info_array, info_count * sizeof(integer_t));
	return 0;
}
*/
import "C"

import (
	"sync"
	"time"
)

const maxLogicalCPUs = 128

var (
	cpuMu     sync.Mutex
	cpuPrevOK bool
	cpuPrevU  uint64
	cpuPrevS  uint64
	cpuPrevI  uint64
	cpuPrevN  uint64
	cpuPrevAt time.Time

	perCPUPrevOK bool
	perCPUPrevU  [maxLogicalCPUs]uint64
	perCPUPrevS  [maxLogicalCPUs]uint64
	perCPUPrevI  [maxLogicalCPUs]uint64
	perCPUPrevN  [maxLogicalCPUs]uint64
	perCPUPrevNCPU int
	perCPUPrevAt time.Time
)

// sampleCPUPercent 两次采样差分得到整机 CPU 使用率；首次调用会 sleep 120ms。
func sampleCPUPercent() float64 {
	cpuMu.Lock()
	defer cpuMu.Unlock()

	u, s, i, n, ok := readCPUTicks()
	if !ok {
		return 0
	}
	now := time.Now()
	if !cpuPrevOK || now.Sub(cpuPrevAt) > 5*time.Second {
		cpuPrevU, cpuPrevS, cpuPrevI, cpuPrevN = u, s, i, n
		cpuPrevAt = now
		cpuPrevOK = true
		time.Sleep(120 * time.Millisecond)
		u2, s2, i2, n2, ok2 := readCPUTicks()
		if !ok2 {
			return 0
		}
		u, s, i, n = u2, s2, i2, n2
	}
	du := u - cpuPrevU
	ds := s - cpuPrevS
	di := i - cpuPrevI
	dn := n - cpuPrevN
	cpuPrevU, cpuPrevS, cpuPrevI, cpuPrevN = u, s, i, n
	cpuPrevAt = now
	return ticksToPercent(du, ds, di, dn)
}

// sampleCPUClusterPercents 按逻辑核差分，再按 P/E 簇汇总。
// Apple Silicon 上 host_processor_info 的核序通常是：先性能核、再能效核。
// perfN/effN 为 0 时仅返回整机 total，perf/eff 为 0。
func sampleCPUClusterPercents(perfN, effN int) (total, perf, eff float64) {
	_, total, perf, eff = samplePerCPUPercents(perfN, effN)
	return total, perf, eff
}

// samplePerCPUPercents 按逻辑核差分，返回每核使用率与 P/E 簇汇总。
// 与 sampleCPUClusterPercents 共用差分状态，避免重复 sleep。
func samplePerCPUPercents(perfN, effN int) (cores []CPUCoreStat, total, perf, eff float64) {
	cpuMu.Lock()
	defer cpuMu.Unlock()

	users, systems, idles, nices, n, ok := readPerCPUTicks()
	if !ok || n <= 0 {
		return nil, 0, 0, 0
	}
	now := time.Now()
	if !perCPUPrevOK || n != perCPUPrevNCPU || now.Sub(perCPUPrevAt) > 5*time.Second {
		copy(perCPUPrevU[:n], users[:n])
		copy(perCPUPrevS[:n], systems[:n])
		copy(perCPUPrevI[:n], idles[:n])
		copy(perCPUPrevN[:n], nices[:n])
		perCPUPrevNCPU = n
		perCPUPrevAt = now
		perCPUPrevOK = true
		time.Sleep(120 * time.Millisecond)
		users2, systems2, idles2, nices2, n2, ok2 := readPerCPUTicks()
		if !ok2 || n2 != n {
			return nil, 0, 0, 0
		}
		users, systems, idles, nices = users2, systems2, idles2, nices2
	}

	percents := make([]float64, n)
	var duAll, dsAll, diAll, dnAll uint64
	var duP, dsP, diP, dnP uint64
	var duE, dsE, diE, dnE uint64
	for i := 0; i < n; i++ {
		du := users[i] - perCPUPrevU[i]
		ds := systems[i] - perCPUPrevS[i]
		di := idles[i] - perCPUPrevI[i]
		dn := nices[i] - perCPUPrevN[i]
		percents[i] = ticksToPercent(du, ds, di, dn)
		duAll += du
		dsAll += ds
		diAll += di
		dnAll += dn
		if perfN > 0 && effN > 0 && perfN+effN <= n {
			if i < perfN {
				duP += du
				dsP += ds
				diP += di
				dnP += dn
			} else if i < perfN+effN {
				duE += du
				dsE += ds
				diE += di
				dnE += dn
			}
		}
	}
	copy(perCPUPrevU[:n], users[:n])
	copy(perCPUPrevS[:n], systems[:n])
	copy(perCPUPrevI[:n], idles[:n])
	copy(perCPUPrevN[:n], nices[:n])
	perCPUPrevNCPU = n
	perCPUPrevAt = now

	cores = BuildCPUCoreStats(percents, perfN, effN)
	total = ticksToPercent(duAll, dsAll, diAll, dnAll)
	if perfN > 0 && effN > 0 && perfN+effN <= n {
		perf = ticksToPercent(duP, dsP, diP, dnP)
		eff = ticksToPercent(duE, dsE, diE, dnE)
	}
	return cores, total, perf, eff
}

func ticksToPercent(du, ds, di, dn uint64) float64 {
	total := du + ds + di + dn
	if total == 0 {
		return 0
	}
	used := float64(du+ds+dn) / float64(total) * 100
	if used < 0 {
		return 0
	}
	if used > 100 {
		return 100
	}
	return used
}

func readCPUTicks() (user, system, idle, nice uint64, ok bool) {
	var u, s, i, n C.natural_t
	if C.localsys_cpu_ticks(&u, &s, &i, &n) != 0 {
		return 0, 0, 0, 0, false
	}
	return uint64(u), uint64(s), uint64(i), uint64(n), true
}

func readPerCPUTicks() (users, systems, idles, nices []uint64, n int, ok bool) {
	var cu, cs, ci, cn [maxLogicalCPUs]C.natural_t
	var count C.uint
	if C.localsys_per_cpu_ticks(&cu[0], &cs[0], &ci[0], &cn[0], maxLogicalCPUs, &count) != 0 {
		return nil, nil, nil, nil, 0, false
	}
	n = int(count)
	if n <= 0 {
		return nil, nil, nil, nil, 0, false
	}
	users = make([]uint64, n)
	systems = make([]uint64, n)
	idles = make([]uint64, n)
	nices = make([]uint64, n)
	for i := 0; i < n; i++ {
		users[i] = uint64(cu[i])
		systems[i] = uint64(cs[i])
		idles[i] = uint64(ci[i])
		nices[i] = uint64(cn[i])
	}
	return users, systems, idles, nices, n, true
}
