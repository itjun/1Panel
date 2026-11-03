#!/usr/bin/env python3
"""在已登录的 GNOME Wayland 会话中检查真实窗口的 app_id 和已安装图标。"""

import argparse
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, Gio, Gtk


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("binary", type=Path)
args = parser.parse_args()
binary = args.binary.resolve(strict=True)
desktop_id = "com.itjun.panel"

Gtk.init()
desktop = Gio.DesktopAppInfo.new(desktop_id + ".desktop")
assert desktop is not None, "未安装 com.itjun.panel.desktop"
theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default())
assert desktop.get_string("Icon") == "1Panel", "桌面入口的图标名称不符"
assert theme.has_icon("1Panel"), "GTK 找不到 1Panel 图标"

# 使用临时用户目录和独立 D-Bus，不读取用户配置、不与已有实例抢锁。
with tempfile.TemporaryDirectory(prefix="1panel-desktop-qa-") as tmp:
    env = dict(os.environ, HOME=tmp, XDG_CONFIG_HOME=tmp + "/config",
               XDG_CACHE_HOME=tmp + "/cache", XDG_DATA_HOME=tmp + "/data",
               GDK_BACKEND="wayland", WAYLAND_DEBUG="client")
    with open(Path(tmp) / "wayland.log", "w+") as log:
        proc = subprocess.Popen(["dbus-run-session", "--", str(binary)],
                                env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
        log.seek(0)
        ids = re.findall(r'xdg_toplevel[^\n]*\.set_app_id\("([^"]+)"\)', log.read())
        assert ids, "未捕获到 Wayland 窗口的 app_id"
        assert all(value == desktop_id for value in ids), f"窗口标识与桌面入口不符：{ids}"

print(f"PASS: Wayland app_id={desktop_id}，桌面入口和 GTK 图标可用")
