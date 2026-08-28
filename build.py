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
# 每次打包前自动清理旧构建产物（bin/、agentres/bin、dist）与 vite 缓存，
# 确保从头构建、旧内容不污染新产物。
# 依赖: wails3（构建）；macOS 另需 open/pkill

import os
import shutil
import subprocess
import sys
import time

APP_NAME = "1Pannel"
BIN_DIR = "bin"
APP_BUNDLE = f"{BIN_DIR}/{APP_NAME}.app"
WIN_EXE = f"{BIN_DIR}/{APP_NAME}.exe"
INSTALL_DIR = f"/Applications/{APP_NAME}.app"

IS_WINDOWS = sys.platform == "win32"


# 构建产物与缓存目录：每次打包前清理，确保从头构建、旧内容不污染新产物
CLEAN_PATHS = [
    BIN_DIR,                            # Go 二进制 + .app bundle（含旧 dev.app）
    "frontend/dist",                    # 前端 vite 构建产物
    "frontend/node_modules/.vite",      # vite 依赖预构建缓存
]

# go:embed all:bin 要求目录始终存在；只清交叉编译产物，再留占位文件
AGENTRES_BIN = "internal/agentres/bin"


def clean():
    print("==> 清理旧构建产物与缓存")
    for path in CLEAN_PATHS:
        if os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
            print(f"    删除 {path}/")
    # agent 产物：删文件但保留目录（否则 go run ./cmd/agentversion 因 embed 失败）
    if os.path.isdir(AGENTRES_BIN):
        for name in os.listdir(AGENTRES_BIN):
            os.remove(os.path.join(AGENTRES_BIN, name))
        print(f"    清空 {AGENTRES_BIN}/")
    os.makedirs(AGENTRES_BIN, exist_ok=True)
    placeholder = os.path.join(AGENTRES_BIN, ".gitkeep")
    if not os.path.exists(placeholder):
        open(placeholder, "a").close()
        print(f"    保留 {placeholder}")


def build():
    clean()
    print("==> [1/2] 编译内嵌 agent 产物")
    print("==> wails3 task agent:build")
    subprocess.run(["wails3", "task", "agent:build"], check=True)
    if IS_WINDOWS:
        # Windows 分发形态是裸 exe（README：CI 同样用 windows:build + zip），
        # package 走 NSIS 安装器，非本脚本目标
        print(f"==> [2/2] 编译前端 + Go，产出 {WIN_EXE}")
        print("==> wails3 task windows:build")
        subprocess.run(["wails3", "task", "windows:build"], check=True)
    else:
        print(f"==> [2/2] 编译前端 + Go，打包 {APP_BUNDLE}")
        print("==> wails3 task package")
        subprocess.run(["wails3", "task", "package"], check=True)


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
        print("  2 - 拷贝到应用程序并启动（覆盖式安装）")
    print("======================================")


def main():
    choice = sys.argv[1] if len(sys.argv) > 1 else ""
    if not choice:
        print_menu()
        choice = input("请选择 [1/2]: ").strip()

    if choice == "1":
        stop_running()
        build()
        if IS_WINDOWS:
            launch_win()
        else:
            launch_mac(APP_BUNDLE)
    elif choice == "2":
        if IS_WINDOWS:
            # Windows 没有 /Applications 概念，应用即 bin/ 下单个 exe
            print("选项 2（覆盖安装到 /Applications）仅 macOS 支持；Windows 直接运行选项 1 即可", file=sys.stderr)
            sys.exit(1)
        stop_running()
        build()
        stop_running()
        install()
        launch_mac(INSTALL_DIR)
    else:
        print(f"无效选择: {choice}（可选 1 或 2）", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
