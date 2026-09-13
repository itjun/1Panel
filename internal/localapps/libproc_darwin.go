//go:build darwin

package localapps

/*
#cgo CFLAGS: -Wno-deprecated-declarations
#include <libproc.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/proc_info.h>

static int localapps_pid_path(int pid, char *buf, int size) {
	return proc_pidpath(pid, buf, (uint32_t)size);
}

static int localapps_pid_rusage_v2(int pid, struct rusage_info_v2 *info) {
	return proc_pid_rusage(pid, RUSAGE_INFO_V2, (rusage_info_t *)info);
}

static int localapps_list_threads(int pid, uint64_t *buf, int bufbytes) {
	return proc_pidinfo(pid, PROC_PIDLISTTHREADS, 0, buf, bufbytes);
}

static int localapps_thread_info(int pid, uint64_t tid, struct proc_threadinfo *info) {
	return proc_pidinfo(pid, PROC_PIDTHREADID64INFO, tid, info, (int)sizeof(*info));
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

const thUsageScale = 1000.0

// libprocPidPath 返回进程可执行路径；失败返回空串。
func libprocPidPath(pid int) string {
	buf := make([]byte, C.PROC_PIDPATHINFO_MAXSIZE)
	n := C.localapps_pid_path(C.int(pid), (*C.char)(unsafe.Pointer(&buf[0])), C.int(len(buf)))
	if n <= 0 {
		return ""
	}
	// n 是写入的字节数（不含 NUL）；保险起见按 C 字符串截断
	path := C.GoString((*C.char)(unsafe.Pointer(&buf[0])))
	return path
}

// libprocDiskIO 读累计磁盘读写字节；失败返回 ok=false。
func libprocDiskIO(pid int) (readBytes, writeBytes uint64, ok bool) {
	var info C.struct_rusage_info_v2
	ret := C.localapps_pid_rusage_v2(C.int(pid), &info)
	if ret < 0 {
		return 0, 0, false
	}
	return uint64(info.ri_diskio_bytesread), uint64(info.ri_diskio_byteswritten), true
}

// libprocThreads 列出进程线程；失败返回 nil（调用方退化到 ps -M）。
func libprocThreads(pid int) []ThreadNode {
	// 先探测需要的缓冲区大小：返回值为写入字节数；若 buffer 不够可能返回所需大小或负值
	const maxThreads = 4096
	ids := make([]uint64, maxThreads)
	nbytes := C.localapps_list_threads(
		C.int(pid),
		(*C.uint64_t)(unsafe.Pointer(&ids[0])),
		C.int(maxThreads*8),
	)
	if nbytes <= 0 {
		return nil
	}
	n := int(nbytes) / 8
	if n > maxThreads {
		n = maxThreads
	}
	out := make([]ThreadNode, 0, n)
	for i := 0; i < n; i++ {
		tid := ids[i]
		if tid == 0 {
			// 缓冲未写满或无效项；跳过以免前端 thr:pid:0 键冲突
			continue
		}
		var info C.struct_proc_threadinfo
		ret := C.localapps_thread_info(C.int(pid), C.uint64_t(tid), &info)
		if ret <= 0 {
			out = append(out, ThreadNode{TID: tid})
			continue
		}
		name := C.GoString(&info.pth_name[0])
		cpu := float64(info.pth_cpu_usage) * 100.0 / thUsageScale
		out = append(out, ThreadNode{
			TID:   tid,
			Name:  name,
			CPU:   cpu,
			State: threadStateName(int(info.pth_run_state)),
		})
	}
	return out
}

func threadStateName(state int) string {
	switch state {
	case int(C.TH_STATE_RUNNING):
		return "running"
	case int(C.TH_STATE_STOPPED):
		return "stopped"
	case int(C.TH_STATE_WAITING):
		return "waiting"
	case int(C.TH_STATE_UNINTERRUPTIBLE):
		return "uninterruptible"
	case int(C.TH_STATE_HALTED):
		return "halted"
	default:
		return fmt.Sprintf("state-%d", state)
	}
}
