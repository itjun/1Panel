//go:build linux && cgo && !gtk3 && !android && !server

package app

/*
#cgo pkg-config: gtk4

// Wails v3.0.0-beta.14 的 GTK4 保存框（pkg/application/linux_cgo.go 的
// runSaveFileDialog）拿到了 SetFilename，但没有传给 GtkFileDialog。
// GTK3 路径会调用 gtk_file_chooser_set_current_name，GTK4 路径直接
// gtk_file_dialog_save，Name 栏因此是空的。macOS / Windows 不受影响。
//
// 这里用链接器 --wrap 在 gtk_file_dialog_save 之前补上
// gtk_file_dialog_set_initial_name。xdg-desktop-portal 的保存框读的就是
// 这个 initial name（current_name）。没设置建议名时不改对话框，Wails
// 以后若自行修好，直接调用仍保持原行为。本文件到时可删除。
#cgo LDFLAGS: -Wl,--wrap=gtk_file_dialog_save

#include <gtk/gtk.h>

static GMutex pending_save_name_mu;
static char *pending_save_name;

void set_linux_pending_save_name(const char *name) {
	g_mutex_lock(&pending_save_name_mu);
	g_free(pending_save_name);
	pending_save_name = NULL;
	if (name != NULL && name[0] != '\0') {
		pending_save_name = g_strdup(name);
	}
	g_mutex_unlock(&pending_save_name_mu);
}

char *linux_pending_save_name_copy(void) {
	char *copy;
	g_mutex_lock(&pending_save_name_mu);
	copy = g_strdup(pending_save_name != NULL ? pending_save_name : "");
	g_mutex_unlock(&pending_save_name_mu);
	return copy;
}

extern void __real_gtk_file_dialog_save(GtkFileDialog *dialog,
	GtkWindow *parent, GCancellable *cancellable,
	GAsyncReadyCallback callback, gpointer user_data);

void __wrap_gtk_file_dialog_save(GtkFileDialog *dialog,
	GtkWindow *parent, GCancellable *cancellable,
	GAsyncReadyCallback callback, gpointer user_data) {
	g_mutex_lock(&pending_save_name_mu);
	if (pending_save_name != NULL) {
		gtk_file_dialog_set_initial_name(dialog, pending_save_name);
	}
	g_mutex_unlock(&pending_save_name_mu);
	__real_gtk_file_dialog_save(dialog, parent, cancellable, callback, user_data);
}
*/
import "C"
import "unsafe"

func setLinuxSaveInitialName(name string) {
	cName := C.CString(name)
	defer C.free(unsafe.Pointer(cName))
	C.set_linux_pending_save_name(cName)
}

func linuxPendingSaveName() string {
	c := C.linux_pending_save_name_copy()
	if c == nil {
		return ""
	}
	defer C.g_free(C.gpointer(unsafe.Pointer(c)))
	return C.GoString(c)
}
