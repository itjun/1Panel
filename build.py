#!/usr/bin/env python3
#
# build.py
# 一键重新部署 1Panel（自动判断 Windows / macOS / Linux）:
#   强杀旧进程 → 清理 → 编译（agent + 前端 + Go）→ 安装 → 启动
#
#   Windows: 产出 bin/1Panel.exe，创建开始菜单快捷方式后启动
#   macOS:   产出 bin/1Panel.app，覆盖安装到 /Applications 后启动
#   Linux:   产出 bin/1Panel，用户级安装到 ~/.local（免 sudo）后启动
#
# 用法: python build.py
# 依赖: wails3、bun；Windows 下 go/wails3/bun 不在 PATH 时会自动探测常见安装位置补全；
#       macOS 另需 open/pkill，Linux 另需 pkill（procps 自带）

import os
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager

# Windows 控制台默认 GBK，中文输出会乱码；强制 UTF-8 输出
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

APP_NAME = "1Panel"
BIN_DIR = "bin"
APP_BUNDLE = f"{BIN_DIR}/{APP_NAME}.app"
WIN_EXE = f"{BIN_DIR}/{APP_NAME}.exe"
LINUX_BIN = f"{BIN_DIR}/{APP_NAME}"
INSTALL_DIR = f"/Applications/{APP_NAME}.app"
LSREGISTER = ("/System/Library/Frameworks/CoreServices.framework/Frameworks/"
              "LaunchServices.framework/Support/lsregister")

IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform == "linux"

# Linux 用户级安装位置（免 sudo）：任务栏图标靠 desktop 文件与 GTK application id 匹配
LINUX_INSTALL_BIN = os.path.expanduser(f"~/.local/bin/{APP_NAME}")
LINUX_DESKTOP_SRC = "build/linux/com.itjun.panel.desktop"
LINUX_DESKTOP_INSTALL = os.path.expanduser("~/.local/share/applications/com.itjun.panel.desktop")
LINUX_ICON_SRC = "build/appicon.png"
LINUX_ICON_INSTALL = os.path.expanduser(f"~/.local/share/icons/hicolor/128x128/apps/{APP_NAME}.png")
LINUX_LAUNCH_LOG = os.path.expanduser(f"~/.local/share/{APP_NAME}/1panel.log")

# Windows 开始菜单快捷方式（当前用户级，免管理员）
WIN_LNK_DIR = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs")
WIN_LNK = os.path.join(WIN_LNK_DIR, f"{APP_NAME}.lnk")

# 每次打包清：Go 产物。frontend/dist 与 .vite 缓存保留——task 按内容指纹
# 判断，前端无改动时整段跳过 vite；需要强制全量重建前端时手动删这两处。
CLEAN_PATHS = [
    BIN_DIR,
]

# 传给 wails3 的环境：运行时快照（ensure_path 补全 PATH 之后再取， import 期
# 的模块级快照会定格在补全前，导致子进程仍找不到 go/wails3/bun）
def wails_env():
    return {**os.environ, "PACKAGE_MANAGER": "bun"}

# Windows 下常见安装位置（用于 PATH 缺失时自动探测补全）
WIN_TOOL_DIRS = [
    r"C:\Go\bin",
    r"C:\Program Files\Go\bin",            # go.dev MSI / winget 默认安装位置
    os.path.expanduser(r"~\sdk\go\bin"),       # golang.org/dl 官方 zip 解压约定位置
    os.path.expanduser(r"~\go\bin"),           # go install 产物（wails3、task 等）
    os.path.expanduser(r"~\.bun\bin"),
    os.path.expanduser(r"~\scoop\apps\go\current\bin"),
    os.path.expanduser(r"~\AppData\Local\Programs\Go\bin"),
]

# 记录哪些工具是探测补全进来的，构建结束后提示用户
FOUND_TOOLS = {}


def ensure_path():
    """Windows 下把 go/wails3/bun 所在目录补进 PATH，避免'系统找不到指定的文件'"""
    if not IS_WINDOWS:
        return
    missing = [t for t in ("wails3", "go", "bun") if shutil.which(t) is None]
    if not missing:
        return
    added = []
    for d in WIN_TOOL_DIRS:
        if os.path.isdir(d):
            os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]
            added.append(d)
    for t in missing:
        if shutil.which(t):
            FOUND_TOOLS[t] = shutil.which(t)
    if missing and not all(shutil.which(t) for t in missing):
        found = "、".join(f"{t}={FOUND_TOOLS[t]}" for t in missing if t in FOUND_TOOLS)
        lost = "、".join(t for t in missing if t not in FOUND_TOOLS)
        print(f"!! PATH 缺少 {lost}", file=sys.stderr)
        if found:
            print(f"   已自动补全 {found}", file=sys.stderr)
        sys.exit(1)
    print(f"==> PATH 自动补全: {', '.join(added)}")

# go:embed all:bin 要求目录始终存在；只清交叉编译产物，再留占位文件
AGENTRES_BIN = "internal/agentres/bin"


# 阶段耗时记录：(阶段名, 秒)，构建结束后汇总输出
STAGE_TIMES = []


@contextmanager
def stage(name):
    """计时所包裹的构建阶段，结束时记录耗时"""
    start = time.perf_counter()
    try:
        yield
    finally:
        STAGE_TIMES.append((name, time.perf_counter() - start))


def print_stage_report():
    """输出各阶段耗时与占总耗时的比例"""
    total = sum(sec for _, sec in STAGE_TIMES)
    print()
    print("======================================")
    print(f"  阶段耗时统计（总计 {total:.1f}s）")
    print("======================================")
    for name, sec in STAGE_TIMES:
        # 中文名按 2 列宽计算，补空格让表格对齐
        width = sum(2 if ord(c) > 0x2E80 else 1 for c in name)
        name = name + " " * (16 - width)
        pct = sec / total * 100 if total else 0.0
        print(f"  {name}{sec:6.1f}s  {pct:5.1f}%")


def clean():
    paths = list(CLEAN_PATHS)
    print("==> 清理旧构建产物与缓存")
    for path in paths:
        if os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
            print(f"    删除 {path}/")
        else:
            print(f"    跳过 {path}/（不存在）")
    # 不删 spanel-agent-*：源码未变时沿用，避免每次打包都交叉编译并升版本。
    # 目录必须始终非空（//go:embed all:bin 编不了空目录）。
    kept_agent = []
    if os.path.isdir(AGENTRES_BIN):
        for name in os.listdir(AGENTRES_BIN):
            if name.startswith("spanel-agent-"):
                kept_agent.append(name)
                continue
            os.remove(os.path.join(AGENTRES_BIN, name))
        if kept_agent:
            print(f"    保留 {AGENTRES_BIN}/ 已有 {len(kept_agent)} 个 agent 产物")
        else:
            print(f"    清空 {AGENTRES_BIN}/ 非产物文件")
    os.makedirs(AGENTRES_BIN, exist_ok=True)
    placeholder = os.path.join(AGENTRES_BIN, ".gitkeep")
    open(placeholder, "w").close()
    print(f"    写入占位 {placeholder}（go:embed 需要非空目录）")


def ensure_bun():
    if shutil.which("bun"):
        return
    print(
        "未找到 bun。请先安装：curl -fsSL https://bun.sh/install | bash",
        file=sys.stderr,
    )
    sys.exit(1)


def run_wails(*args: str) -> None:
    subprocess.run(["wails3", *args], check=True, env=wails_env())


def build():
    ensure_bun()
    with stage("清理旧产物"):
        clean()
    with stage("编译 agent"):
        print("==> [1/2] 编译内嵌 agent 产物")
        print("==> wails3 task agent:build")
        run_wails("task", "agent:build")
    with stage("编译前端与 Go"):
        if IS_WINDOWS:
            # Windows 分发形态是裸 exe（README：CI 同样用 windows:build + zip）
            print(f"==> [2/2] bun + vite 打包前端，再编译 Go，产出 {WIN_EXE}")
            print("==> wails3 task windows:build")
            run_wails("task", "windows:build")
        elif IS_MAC:
            print(f"==> [2/2] bun + vite 打包前端，再编译 Go，打包 {APP_BUNDLE}")
            print("==> wails3 task package")
            run_wails("task", "package")
        else:
            # 不走 linux:package：那会拉 linuxdeploy 打 AppImage/deb/rpm，
            # 用户级安装只需要裸二进制 + desktop/图标
            print(f"==> [2/2] bun + vite 打包前端，再编译 Go，产出 {LINUX_BIN}")
            print("==> wails3 task linux:build")
            run_wails("task", "linux:build")


def _wait_until(gone, timeout=3.0, interval=0.1):
    """轮询等待条件成立；SIGKILL 后进程通常 <0.3s 退出，比固定 sleep(1) 快"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if gone():
            return
        time.sleep(interval)


def _win_app_running() -> bool:
    proc = subprocess.run(
        ["tasklist", "/FI", f"IMAGENAME eq {APP_NAME}.exe", "/NH"],
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return f"{APP_NAME}.exe".lower() in (proc.stdout or "").lower()


def stop_running():
    """强杀正在运行的 1Panel：覆盖安装/重启前先停，避免占用旧二进制。
    杀完轮询等真正退出（文件锁/端口随之释放），比固定等 1s 更快也更稳。"""
    if IS_WINDOWS:
        # 先枚举进程再 kill，拿到 PID 便于确认；taskkill /IM 需要进程名
        proc = subprocess.run(
            ["taskkill", "/F", "/IM", f"{APP_NAME}.exe"],
            capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )
        if proc.returncode == 0:
            print(f"==> 已强杀正在运行的 {APP_NAME}")
            _wait_until(lambda: not _win_app_running())
        else:
            print(f"==> 没有正在运行的 {APP_NAME}")
        return
    if IS_MAC:
        # /Applications 与 bin/ 下的副本都按路径特征匹配
        kill_cmd = ["pkill", "-9", "-f", f"{APP_NAME}.app/Contents/MacOS"]
        check_cmd = ["pgrep", "-f", f"{APP_NAME}.app/Contents/MacOS"]
    else:
        # 按进程名精确匹配：repo 直跑与 ~/.local/bin 已安装副本同名
        kill_cmd = ["pkill", "-9", "-x", APP_NAME]
        check_cmd = ["pgrep", "-x", APP_NAME]
    proc = subprocess.run(kill_cmd, capture_output=True)
    if proc.returncode == 0:
        print(f"==> 已强杀正在运行的 {APP_NAME}")
        _wait_until(lambda: subprocess.run(check_cmd, capture_output=True).returncode != 0)
    else:
        print(f"==> 没有正在运行的 {APP_NAME}")


def install_win_shortcut():
    """创建开始菜单快捷方式（当前用户，免管理员），指向仓库内 bin/1Panel.exe。
    用系统自带 PowerShell 走 WScript.Shell COM，不依赖 PyWin32。"""
    exe = os.path.abspath(WIN_EXE)
    workdir = os.path.dirname(exe)
    os.makedirs(WIN_LNK_DIR, exist_ok=True)
    # 路径一律用 PS 单引号字面量，含空格不需要额外转义
    ps_script = "\n".join([
        "$ws = New-Object -ComObject WScript.Shell",
        f"$lnk = $ws.CreateShortcut('{WIN_LNK}')",
        f"$lnk.TargetPath = '{exe}'",
        f"$lnk.WorkingDirectory = '{workdir}'",
        f"$lnk.IconLocation = '{exe},0'",
        f"$lnk.Description = '{APP_NAME} 运维管理'",
        "$lnk.Save()",
    ])
    print(f"==> 创建开始菜单快捷方式 {WIN_LNK}")
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0 or not os.path.exists(WIN_LNK):
        msg = (proc.stderr or proc.stdout or "").strip()
        print(f"!! 快捷方式创建失败（不影响后续启动）：{msg}", file=sys.stderr)


def install_linux():
    """用户级安装（免 sudo）：二进制 + desktop 项 + 图标装到 ~/.local"""
    print(f"==> 安装二进制到 {LINUX_INSTALL_BIN}")
    os.makedirs(os.path.dirname(LINUX_INSTALL_BIN), exist_ok=True)
    shutil.copy2(LINUX_BIN, LINUX_INSTALL_BIN)
    os.chmod(LINUX_INSTALL_BIN, 0o755)

    print(f"==> 写入 {LINUX_DESKTOP_INSTALL}")
    with open(LINUX_DESKTOP_SRC, encoding="utf-8") as f:
        lines = f.readlines()
    with open(LINUX_DESKTOP_INSTALL, "w", encoding="utf-8") as f:
        for line in lines:
            # Exec 指向安装后的绝对路径（模板里是 /usr/local/bin 形态的 1Panel）
            f.write(f"Exec={LINUX_INSTALL_BIN}\n" if line.startswith("Exec=") else line)

    print(f"==> 安装图标到 {LINUX_ICON_INSTALL}")
    os.makedirs(os.path.dirname(LINUX_ICON_INSTALL), exist_ok=True)
    shutil.copy2(LINUX_ICON_SRC, LINUX_ICON_INSTALL)

    # 有就刷新缓存，缺失不报错（GNOME 会自行扫描）
    for cmd in (
        ["update-desktop-database", os.path.dirname(LINUX_DESKTOP_INSTALL)],
        ["gtk-update-icon-cache", "-q", "-t", "-f",
         os.path.dirname(os.path.dirname(LINUX_ICON_INSTALL))],
    ):
        if shutil.which(cmd[0]):
            subprocess.run(cmd, capture_output=True)


def install():
    if IS_WINDOWS:
        install_win_shortcut()
    elif IS_MAC:
        print(f"==> 覆盖安装到 {INSTALL_DIR}")
        shutil.rmtree(INSTALL_DIR, ignore_errors=True)
        shutil.copytree(APP_BUNDLE, INSTALL_DIR)
        # 重新登记，Dock/「应用程序」/聚焦才会丢掉旧图标缓存
        subprocess.run([LSREGISTER, "-f", INSTALL_DIR], capture_output=True)
    else:
        install_linux()


def _graphical_session_env():
    """从当前图形会话补齐显示相关环境变量。

    build.py 可能被没有图形环境的 shell 调起(agent / cron / ssh)：Wayland 下
    缺 WAYLAND_DISPLAY 应用起不来，X11 下缺 DISPLAY 会退到无头。这里通过
    loginctl 找到活动图形会话的 Leader 进程，从 /proc/<pid>/environ 继承显示
    变量（仅补缺失项，不覆盖调用方已有值）。拿不到会话时原样返回。"""
    inherit_keys = (
        "WAYLAND_DISPLAY", "DISPLAY", "XDG_SESSION_TYPE",
        "XDG_RUNTIME_DIR", "XDG_CURRENT_DESKTOP", "DBUS_SESSION_BUS_ADDRESS",
    )
    env = {}
    try:
        sessions = subprocess.run(
            ["loginctl", "list-sessions", "--no-legend"],
            capture_output=True, text=True, timeout=5,
        ).stdout.splitlines()
        for line in sessions:
            fields = line.split()
            if len(fields) < 2:
                continue
            session_id = fields[0]
            info = subprocess.run(
                ["loginctl", "show-session", session_id, "-p", "Type", "-p", "Leader"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            props = dict(
                l.split("=", 1) for l in info.strip().splitlines() if "=" in l
            )
            if props.get("Type") not in ("wayland", "x11"):
                continue
            leader = props.get("Leader", "")
            with open(f"/proc/{leader}/environ", "rb") as f:
                for item in f.read().split(b"\0"):
                    if b"=" not in item:
                        continue
                    key, _, value = item.partition(b"=")
                    key = key.decode("utf-8", "replace")
                    if key in inherit_keys and key not in env:
                        env[key] = value.decode("utf-8", "replace")
            if env:
                break
    except Exception as exc:  # 会话探测失败不阻塞启动，仅提示
        print(f"    图形会话探测失败（{exc}），沿用调用方环境", file=sys.stderr)
    return env


def launch():
    if IS_WINDOWS:
        # os.startfile 以 shell 默认方式启动 exe（工作目录 = 项目根）
        target = os.path.abspath(WIN_EXE)
        print(f"==> 启动 {target}")
        os.startfile(target)
    elif IS_MAC:
        print(f"==> 启动 {INSTALL_DIR}")
        print("==> open " + INSTALL_DIR)
        subprocess.run(["open", INSTALL_DIR], check=True)
    else:
        # 分离会话后台启动，stdout/stderr 落盘日志便于排查"没起来"
        # 无图形环境的调用方（agent/cron/ssh）自动继承当前图形会话的显示变量
        env = {**os.environ, **_graphical_session_env()}
        backend = "Wayland" if env.get("WAYLAND_DISPLAY") else (
            "X11" if env.get("DISPLAY") else "无显示环境（应用可能无法出窗口）")
        print(f"==> 启动 {LINUX_INSTALL_BIN}（显示协议: {backend}，日志: {LINUX_LAUNCH_LOG}）")
        os.makedirs(os.path.dirname(LINUX_LAUNCH_LOG), exist_ok=True)
        with open(LINUX_LAUNCH_LOG, "ab") as log:
            subprocess.Popen(
                [LINUX_INSTALL_BIN],
                stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                start_new_session=True, cwd=os.path.expanduser("~"), env=env,
            )


def main():
    if not (IS_WINDOWS or IS_MAC or IS_LINUX):
        print(f"不支持的平台: {sys.platform}", file=sys.stderr)
        sys.exit(1)
    # Windows 下先补全 PATH（go/wails3/bun）
    ensure_path()

    with stage("强杀旧进程"):
        stop_running()
    build()
    with stage("安装"):
        install()
    with stage("启动应用"):
        launch()
    print_stage_report()


if __name__ == "__main__":
    main()
