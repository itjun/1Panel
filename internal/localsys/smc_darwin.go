//go:build darwin

package localsys

/*
#cgo LDFLAGS: -framework IOKit -framework CoreFoundation
#include <stdint.h>
#include <string.h>
#include <IOKit/IOKitLib.h>

#define LOCALSYS_SMC_KERNEL_INDEX 2
#define LOCALSYS_SMC_CMD_READ_BYTES 5
#define LOCALSYS_SMC_CMD_READ_KEYINFO 9

typedef struct {
	char major;
	char minor;
	char build;
	char reserved[1];
	uint16_t release;
} localsys_SMCKeyData_vers_t;

typedef struct {
	uint16_t version;
	uint16_t length;
	uint32_t cpuPLimit;
	uint32_t gpuPLimit;
	uint32_t memPLimit;
} localsys_SMCKeyData_pLimitData_t;

typedef struct {
	uint32_t dataSize;
	uint32_t dataType;
	char dataAttributes;
} localsys_SMCKeyData_keyInfo_t;

typedef char localsys_SMCBytes_t[32];

typedef struct {
	uint32_t key;
	localsys_SMCKeyData_vers_t vers;
	localsys_SMCKeyData_pLimitData_t pLimitData;
	localsys_SMCKeyData_keyInfo_t keyInfo;
	char result;
	char status;
	char data8;
	uint32_t data32;
	localsys_SMCBytes_t bytes;
} localsys_SMCKeyData_t;

static uint32_t localsys_smc_key(const char *s) {
	return ((uint32_t)(unsigned char)s[0] << 24)
		| ((uint32_t)(unsigned char)s[1] << 16)
		| ((uint32_t)(unsigned char)s[2] << 8)
		| (uint32_t)(unsigned char)s[3];
}

static kern_return_t localsys_smc_call(io_connect_t conn, int index, localsys_SMCKeyData_t *in, localsys_SMCKeyData_t *out) {
	size_t inSize = sizeof(*in);
	size_t outSize = sizeof(*out);
	return IOConnectCallStructMethod(conn, index, in, inSize, out, &outSize);
}

static int localsys_smc_read_flt(io_connect_t conn, const char *key4, float *out) {
	localsys_SMCKeyData_t in, result;
	memset(&in, 0, sizeof(in));
	memset(&result, 0, sizeof(result));
	in.key = localsys_smc_key(key4);
	in.data8 = LOCALSYS_SMC_CMD_READ_KEYINFO;
	if (localsys_smc_call(conn, LOCALSYS_SMC_KERNEL_INDEX, &in, &result) != KERN_SUCCESS) {
		return -1;
	}
	uint32_t t = result.keyInfo.dataType;
	char type[5] = {
		(char)((t >> 24) & 0xff),
		(char)((t >> 16) & 0xff),
		(char)((t >> 8) & 0xff),
		(char)(t & 0xff),
		0,
	};
	if (strcmp(type, "flt ") != 0 || result.keyInfo.dataSize < 4) {
		return -1;
	}
	in.keyInfo.dataSize = result.keyInfo.dataSize;
	in.data8 = LOCALSYS_SMC_CMD_READ_BYTES;
	memset(&result, 0, sizeof(result));
	if (localsys_smc_call(conn, LOCALSYS_SMC_KERNEL_INDEX, &in, &result) != KERN_SUCCESS) {
		return -1;
	}
	float v = 0;
	memcpy(&v, result.bytes, sizeof(v));
	*out = v;
	return 0;
}

static int localsys_smc_avg_keys(io_connect_t conn, const char **keys, float *out_c) {
	float sum = 0;
	int n = 0;
	for (int i = 0; keys[i] != NULL; i++) {
		float v = 0;
		if (localsys_smc_read_flt(conn, keys[i], &v) != 0) {
			continue;
		}
		if (v < 1.0f || v > 120.0f) {
			continue;
		}
		sum += v;
		n++;
	}
	if (n <= 0) {
		return 0;
	}
	*out_c = sum / (float)n;
	return n;
}

// localsys_smc_temps 读取 CPU / GPU 温度（无 root）。成功写入对应指针；不可用时置 *ok=0。
static void localsys_smc_temps(float *cpu_c, int *cpu_ok, float *gpu_c, int *gpu_ok) {
	*cpu_ok = 0;
	*gpu_ok = 0;
	io_service_t service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"));
	if (!service) {
		return;
	}
	io_connect_t conn = 0;
	kern_return_t kr = IOServiceOpen(service, mach_task_self(), 0, &conn);
	IOObjectRelease(service);
	if (kr != KERN_SUCCESS || !conn) {
		return;
	}

	static const char *cpu_keys[] = {
		"Tp01", "Tp05", "Tp09", "Tp0D", "Tp0H", "Tp0L", "Tp0P", "Tp0T", "Tp0X",
		"Te05", "Te09", "Te0D", "Te0H", "Te0L", "Te0P",
		"TC0P", "TC0E", "TC0F",
		NULL,
	};
	static const char *gpu_keys[] = {
		"Tg0d", "Tg0e", "Tg0f", "Tg0g", "Tg0h",
		"Tg0P", "Tg1P", "Tg2P",
		"Tg0a", "Tg1a", "Tg2a", "Tg3a", "Tg4a", "Tg5a",
		"Tg0b", "Tg0c",
		NULL,
	};

	float c = 0, g = 0;
	if (localsys_smc_avg_keys(conn, cpu_keys, &c) > 0) {
		*cpu_c = c;
		*cpu_ok = 1;
	}
	if (localsys_smc_avg_keys(conn, gpu_keys, &g) > 0) {
		*gpu_c = g;
		*gpu_ok = 1;
	}
	IOServiceClose(conn);
}
*/
import "C"

import "math"

// readSystemTemps 经 AppleSMC 读取 CPU / GPU 相关温度。
func readSystemTemps() (cpu float64, cpuOK bool, gpu float64, gpuOK bool) {
	var cCPU, cGPU C.float
	var okCPU, okGPU C.int
	C.localsys_smc_temps(&cCPU, &okCPU, &cGPU, &okGPU)
	if okCPU != 0 {
		v := float64(cCPU)
		if !math.IsNaN(v) && !math.IsInf(v, 0) {
			cpu, cpuOK = v, true
		}
	}
	if okGPU != 0 {
		v := float64(cGPU)
		if !math.IsNaN(v) && !math.IsInf(v, 0) {
			gpu, gpuOK = v, true
		}
	}
	return cpu, cpuOK, gpu, gpuOK
}

func fillSystemTemps(o *Overview) {
	cpu, cpuOK, gpu, gpuOK := readSystemTemps()
	if cpuOK {
		v := cpu
		o.CpuTempC = &v
	}
	if gpuOK {
		v := gpu
		o.GpuTempC = &v
	}
	switch {
	case cpuOK && gpuOK:
		v := (cpu + gpu) / 2
		o.TempC = &v
	case cpuOK:
		v := cpu
		o.TempC = &v
	case gpuOK:
		v := gpu
		o.TempC = &v
	}
}
