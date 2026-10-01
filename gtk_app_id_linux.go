//go:build linux && cgo && !gtk3 && !android && !server

package main

/*
#cgo pkg-config: gtk4

// Wails v3.0.0-beta.14 在 pkg/application/linux_cgo.go 的 appNew 里用
// org.wails.<sanitize(Name)> 调用 gtk_application_new。sanitizeAppName 会先给
// 前导数字加下划线，再 strings.Trim 掉首尾下划线，于是 "1Panel" 变成
// org.wails.1panel。GTK 要求 id 的每一段都不能以数字开头，gtk_application_new
// 断言失败，进程在出窗口前以 exit code 1 退出。
//
// beta.14 的 LinuxOptions 没有单独的 application id 字段。这里用链接器 --wrap
// 只在 id 非法时换成 com.itjun.panel（com.itjun.1panel 同样因数字开头被拒绝）。
// 合法 id 原样通过，因此 Wails 以后若自行修好，这里不再介入。
// Options.Name 仍是 1Panel，通知来源、关于对话框和窗口标题都不变。
#cgo LDFLAGS: -Wl,--wrap=gtk_application_new

#include <gtk/gtk.h>

static const char linux_gtk_application_id[] = "com.itjun.panel";

extern GtkApplication *__real_gtk_application_new(const char *application_id, GApplicationFlags flags);

GtkApplication *__wrap_gtk_application_new(const char *application_id, GApplicationFlags flags) {
	if (application_id != NULL && !g_application_id_is_valid(application_id)) {
		application_id = linux_gtk_application_id;
	}
	return __real_gtk_application_new(application_id, flags);
}

const char *linuxGTKApplicationIDC(void) {
	return linux_gtk_application_id;
}
*/
import "C"
import "unsafe"

func linuxGTKApplicationID() string {
	return C.GoString(C.linuxGTKApplicationIDC())
}

func gtkApplicationIDValid(id string) bool {
	c := C.CString(id)
	defer C.free(unsafe.Pointer(c))
	return C.g_application_id_is_valid(c) != 0
}
