#!/usr/bin/env python3
#
# build.py
# 交互式编译打包部署 1Pannel:
#   1 - 编译打包启动          → 编译 agent + 前端 + Go，打包后在 bin/ 直接启动
#                                 (macOS 产出 .app；Windows 产出 1Pannel.exe)
#   2 - 拷贝到应用程序并启动  → 覆盖式安装到 /Applications 并启动（仅 macOS）
#
# 用法:
#   ./build.py        # 交互式菜单选择
#   ./build.py 1      # 直接执行选项 1
#   ./build.py 2      # 直接执行选项 2
# 选项 1：清 bin/、dist、vite 缓存后本地启动。
# 选项 2：全量清理（含 node_modules、.task）再用 bun + vite 彻底重打包，覆盖安装到 /Applications。
# 依赖: wails3、bun；macOS 另需 open/pkill

import os
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager

APP_NAME = "1Pannel"
BIN_DIR = "bin"
APP_BUNDLE = f"{BIN_DIR}/{APP_NAME}.app"
WIN_EXE = f"{BIN_DIR}/{APP_NAME}.exe"
INSTALL_DIR = f"/Applications/{APP_NAME}.app"

IS_WINDOWS = sys.platform == "win32"


# 每次打包都清：Go 产物、vite dist、vite 预构建缓存
CLEAN_PATHS = [
    BIN_DIR,
    "frontend/dist",
    "frontend/node_modules/.vite",
]

# 选项 2 额外清：bun 依赖与 task 指纹，强制 bun install + 全量任务重跑
FULL_CLEAN_PATHS = [
    "frontend/node_modules",
    ".task",
]

PACKAGE_ENV = {**os.environ, "PACKAGE_MANAGER": "bun"}

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


def clean(full: bool = False):
    paths = list(CLEAN_PATHS)
    if full:
        print("==> 全量清理（彻底重打包）")
        paths = FULL_CLEAN_PATHS + paths
    else:
        print("==> 清理旧构建产物与缓存")
    # node_modules 包含 .vite，全量时不必先单独删 .vite
    if full:
        paths = [p for p in paths if p != "frontend/node_modules/.vite"]
    for path in paths:
        if os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
            print(f"    删除 {path}/")
        else:
            print(f"    跳过 {path}/（不存在）")
    # agent 交叉编译产物全部删掉。bin/ 必须马上再放一个占位文件：
    # //go:embed all:bin 不能编空目录，下一步 go run ./cmd/agentversion 会失败。
    if os.path.isdir(AGENTRES_BIN):
        for name in os.listdir(AGENTRES_BIN):
            os.remove(os.path.join(AGENTRES_BIN, name))
        print(f"    清空 {AGENTRES_BIN}/")
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
    subprocess.run(["wails3", *args], check=True, env=PACKAGE_ENV)


def build(full: bool = False):
    ensure_bun()
    with stage("清理旧产物"):
        clean(full=full)
    with stage("编译 agent"):
        print("==> [1/2] 编译内嵌 agent 产物")
        print("==> wails3 task agent:build")
        run_wails("task", "agent:build")
    if IS_WINDOWS:
        # Windows 分发形态是裸 exe（README：CI 同样用 windows:build + zip），
        # package 走 NSIS 安装器，非本脚本目标
        with stage("编译前端与 Go"):
            print(f"==> [2/2] bun + vite 打包前端，再编译 Go，产出 {WIN_EXE}")
            print("==> wails3 task windows:build")
            run_wails("task", "windows:build")
    else:
        with stage("编译前端与 Go"):
            print(f"==> [2/2] bun + vite 打包前端，再编译 Go，打包 {APP_BUNDLE}")
            print("==> wails3 task package")
            run_wails("task", "package")


def stop_running():
    # 先停掉正在运行的 1Pannel，再编译/覆盖安装，避免占用旧二进制
    if IS_WINDOWS:
        # 返回码非 0 = 没有运行中的实例，与 macOS pkill 分支同语义
        proc = subprocess.run(
            ["taskkill", "/F", "/IM", f"{APP_NAME}.exe"], capture_output=True
        )
        if proc.returncode == 0:
            print(f"==> 已停止正在运行的 {APP_NAME}")
            time.sleep(1)
        else:
            print(f"==> 没有正在运行的 {APP_NAME}")
        return
    proc = subprocess.run(
        ["pkill", "-f", f"{APP_NAME}.app/Contents/MacOS"], capture_output=True
    )
    if proc.returncode == 0:
        print(f"==> 已停止正在运行的 {APP_NAME}")
        time.sleep(1)
    else:
        print(f"==> 没有正在运行的 {APP_NAME}")


def install():
    print(f"==> 覆盖安装到 {INSTALL_DIR}")
    shutil.rmtree(INSTALL_DIR, ignore_errors=True)
    shutil.copytree(APP_BUNDLE, INSTALL_DIR)


def launch_win():
    # Windows：os.startfile 以 shell 默认方式启动 exe（工作目录 = 项目根）
    target = os.path.abspath(WIN_EXE)
    print(f"==> 启动 {target}")
    os.startfile(target)


def launch_mac(path):
    print(f"==> 启动 {path}")
    print("==> open " + path)
    subprocess.run(["open", path], check=True)


def print_menu():
    print("======================================")
    print("  1Pannel 打包部署")
    print("======================================")
    print("  1 - 编译打包启动（bin/ 本地运行）")
    if not IS_WINDOWS:
        print("  2 - 全量清理后打包，覆盖安装到应用程序并启动")
    print("======================================")


def main():
    choice = sys.argv[1] if len(sys.argv) > 1 else ""
    if not choice:
        print_menu()
        choice = input("请选择 [1/2]: ").strip()

    if choice == "1":
        with stage("停止旧进程"):
            stop_running()
        build()
        with stage("启动应用"):
            if IS_WINDOWS:
                launch_win()
            else:
                launch_mac(APP_BUNDLE)
    elif choice == "2":
        if IS_WINDOWS:
            # Windows 没有 /Applications 概念，应用即 bin/ 下单个 exe
            print("选项 2（覆盖安装到 /Applications）仅 macOS 支持；Windows 直接运行选项 1 即可", file=sys.stderr)
            sys.exit(1)
        with stage("停止旧进程"):
            stop_running()
        build(full=True)
        with stage("停止旧进程"):
            stop_running()
        with stage("覆盖安装"):
            install()
        with stage("启动应用"):
            launch_mac(INSTALL_DIR)
    else:
        print(f"无效选择: {choice}（可选 1 或 2）", file=sys.stderr)
        sys.exit(1)
    print_stage_report()


if __name__ == "__main__":
    main()
