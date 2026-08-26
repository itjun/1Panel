#!/usr/bin/env python3
#
# build.py
# 交互式编译打包部署 1Pannel:
#   1 - 编译打包启动          → 编译 agent + 前端 + Go，打包 .app 后在 bin/ 直接启动
#   2 - 拷贝到应用程序并启动  → 覆盖式安装到 /Applications 并启动
#
# 用法:
#   ./build.py        # 交互式菜单选择
#   ./build.py 1      # 直接执行选项 1
#   ./build.py 2      # 直接执行选项 2
# 每次打包前自动清理旧构建产物（bin/、agentres/bin、dist）与 vite 缓存，
# 确保从头构建、旧内容不污染新产物。
# 依赖: wails3（构建）、open/pkill（macOS）

import os
import shutil
import subprocess
import sys
import time

APP_NAME = "1Pannel"
BIN_DIR = "bin"
APP_BUNDLE = f"{BIN_DIR}/{APP_NAME}.app"
INSTALL_DIR = f"/Applications/{APP_NAME}.app"


def run(cmd):
    print(f"==> {' '.join(cmd)}")
    subprocess.run(cmd, check=True)



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
    run(["wails3", "task", "agent:build"])
    print(f"==> [2/2] 编译前端 + Go，打包 {APP_BUNDLE}")
    run(["wails3", "task", "package"])


def stop_running():
    # 停止正在运行的 1Pannel（覆盖安装前必须，避免进程占用旧二进制）
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


def launch(path):
    print(f"==> 启动 {path}")
    run(["open", path])


def print_menu():
    print("======================================")
    print("  1Pannel 打包部署")
    print("======================================")
    print("  1 - 编译打包启动（bin/ 本地运行）")
    print("  2 - 拷贝到应用程序并启动（覆盖式安装）")
    print("======================================")


def main():
    choice = sys.argv[1] if len(sys.argv) > 1 else ""
    if not choice:
        print_menu()
        choice = input("请选择 [1/2]: ").strip()

    if choice == "1":
        build()
        stop_running()
        launch(APP_BUNDLE)
    elif choice == "2":
        build()
        stop_running()
        install()
        launch(INSTALL_DIR)
    else:
        print(f"无效选择: {choice}（可选 1 或 2）", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
