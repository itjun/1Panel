//go:build linux && cgo && !gtk3 && !android && !server

package main

/*
// 修复 Linux 四角拖拽缩放时窗口乱飞。
//
// Wails v3.0.0-beta.14 的 Linux 缩放链路存在两处缺陷（pkg/application/
// webview_window.go 的 "wails:resize:" 分支直接调 startResize，未像
// "wails:drag" 那样经 InvokeSync 派发到主线程）：
//
//  1. gdk_toplevel_begin_resize 在消息处理 goroutine 上被调用，而非 GTK
//     主线程；
//  2. 它读取的 w.drag 坐标由主线程 GTK 手势回调写入，双方无同步。webkit
//     在事件 target 阶段同步执行页面 JS，invoke 消息常抢在手势 bubble
//     阶段之前到达，于是读到上一次按压的陈旧坐标。
//
// 窗口管理器（实测 mutter）以消息里的坐标作为交互缩放的锚点，锚点错多少，
// 首个移动事件窗口就瞬移多少。拖左上/右上/左下角时窗口位置随之改变，
// 陈旧锚点偏差动辄数百像素，表现为「乱飞」；纯右/下角只偏尺寸，偶发尺寸
// 突跳。
//
// 这里按 gtk_app_id_linux.go 的先例用链接器 --wrap 拦截
// gdk_toplevel_begin_resize：把真实调用投递到 GTK 主循环（g_idle_add 从
// 任意线程调用是安全的），并在 X11 下用 XQueryPointer 查询当前真实指针
// 位置作为锚点，彻底不依赖 wails 传入的坐标与时间戳。Wayland 下
// begin_resize 不使用 x/y（按 serial 生效），维持原参数原语义，仅纠正
// 线程。Wails 修好该链路后本文件可直接删除。
//
// GDK 内部对 begin_resize 的调用走 GdkToplevel 接口 vtable，不经导出
// 符号，不受 --wrap 影响。
#cgo pkg-config: gtk4 x11
#cgo LDFLAGS: -Wl,--wrap=gdk_toplevel_begin_resize

#include <gtk/gtk.h>
#include <gdk/x11/gdkx.h>
#include <X11/Xlib.h>

extern void __real_gdk_toplevel_begin_resize(GdkToplevel *toplevel,
    GdkSurfaceEdge edge, GdkDevice *device, int button,
    double x, double y, guint32 timestamp);

typedef struct {
	GdkToplevel *toplevel;
	GdkSurfaceEdge edge;
	GdkDevice *device;
	int button;
	double x;
	double y;
} idle_resize_ctx;

static gboolean idle_begin_resize(gpointer user) {
	idle_resize_ctx *ctx = user;
	GdkSurface *surface = GDK_SURFACE(ctx->toplevel);
	double x = ctx->x, y = ctx->y;
	if (GDK_IS_X11_DISPLAY(gdk_surface_get_display(surface))) {
		GdkDisplay *display = gdk_surface_get_display(surface);
		Display *xd;
		Window root, child, xid;
		int rx, ry, wx, wy;
		unsigned int mask;
		G_GNUC_BEGIN_IGNORE_DEPRECATIONS
		xd = gdk_x11_display_get_xdisplay(display);
		xid = gdk_x11_surface_get_xid(surface);
		G_GNUC_END_IGNORE_DEPRECATIONS
		if (XQueryPointer(xd, xid, &root, &child, &rx, &ry, &wx, &wy, &mask)) {
			// wx/wy 是相对 surface 的坐标，与 GDK 期望的入参一致；
			// GDK 内部会再转换成 root 坐标发给 WM。
			x = wx;
			y = wy;
		}
	}
	__real_gdk_toplevel_begin_resize(ctx->toplevel, ctx->edge, ctx->device,
	                                 ctx->button, x, y, GDK_CURRENT_TIME);
	g_object_unref(ctx->toplevel);
	g_free(ctx);
	return G_SOURCE_REMOVE;
}

void __wrap_gdk_toplevel_begin_resize(GdkToplevel *toplevel,
    GdkSurfaceEdge edge, GdkDevice *device, int button,
    double x, double y, guint32 timestamp) {
	(void)timestamp;
	idle_resize_ctx *ctx = g_new(idle_resize_ctx, 1);
	ctx->toplevel = toplevel;
	ctx->edge = edge;
	ctx->device = device;
	ctx->button = button;
	ctx->x = x;
	ctx->y = y;
	g_object_ref(toplevel);
	g_idle_add(idle_begin_resize, ctx);
}
*/
import "C"
