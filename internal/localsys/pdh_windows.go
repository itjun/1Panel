//go:build windows

package localsys

import (
	"math"
	"unsafe"

	"golang.org/x/sys/windows"
)

// PDH（性能数据助手）直调封装，用于 \System\Processor Queue Length ——
// Windows 没有 Unix loadavg 的直接等价物，处理器队列长度是最接近的指标。
// 这里取「瞬时值」计数器，一次收集即可读取，无需两次采样。
var (
	modPdh                   = windows.NewLazySystemDLL("pdh.dll")
	procPdhOpenQuery         = modPdh.NewProc("PdhOpenQuery")
	procPdhAddEnglishCounter = modPdh.NewProc("PdhAddEnglishCounterW")
	procPdhCollectQueryData  = modPdh.NewProc("PdhCollectQueryData")
	procPdhGetFormattedValue = modPdh.NewProc("PdhGetFormattedCounterValue")
	procPdhCloseQuery        = modPdh.NewProc("PdhCloseQuery")
)

const (
	pdhFmtDouble      = 0x00000200
	pdhCounterTypeRaw = 0x00000000 // PERF_SIZE_LARGE|PERF_TYPE_NUMBER|PERF_NUMBER_RAW 等，返回值忽略
)

// pdhFmtValue 对应 PDH_FMT_COUNTERVALUE（x64：CStatus + 8 字节联合体）。
type pdhFmtValue struct {
	CStatus  uint32
	_        uint32
	Double   float64
}

// processorQueueLength 读取 \System\Processor Queue Length；失败返回 false。
func processorQueueLength() (float64, bool) {
	if err := modPdh.Load(); err != nil {
		return 0, false
	}
	var query uintptr
	if r0, _, _ := procPdhOpenQuery.Call(0, 0, uintptr(unsafe.Pointer(&query))); r0 != 0 {
		return 0, false
	}
	defer procPdhCloseQuery.Call(query)

	path, _ := windows.UTF16PtrFromString(`\System\Processor Queue Length`)
	var counter uintptr
	if r0, _, _ := procPdhAddEnglishCounter.Call(
		query,
		uintptr(unsafe.Pointer(path)),
		0,
		uintptr(unsafe.Pointer(&counter))); r0 != 0 {
		return 0, false
	}
	if r0, _, _ := procPdhCollectQueryData.Call(query); r0 != 0 {
		return 0, false
	}
	var val pdhFmtValue
	var ctype uint32
	r0, _, _ := procPdhGetFormattedValue.Call(
		counter,
		pdhFmtDouble,
		uintptr(unsafe.Pointer(&ctype)),
		uintptr(unsafe.Pointer(&val)))
	if r0 != 0 || val.CStatus != 0 {
		return 0, false
	}
	if math.IsNaN(val.Double) || math.IsInf(val.Double, 0) || val.Double < 0 {
		return 0, false
	}
	return val.Double, true
}
