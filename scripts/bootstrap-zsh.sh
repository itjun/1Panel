#!/usr/bin/env bash
#
# bootstrap-zsh.sh
# 一键在远程 Linux 主机上初始化 zsh 环境:
#   安装 zsh → 安装 Oh My Zsh → 主题 ys → 代码高亮插件 → 历史提示插件 → 写 .zshrc → 切默认 shell
#
# 网络策略: 优先 GitHub,失败自动回退镜像/代理(GitHub 不可达时仍能装完)。
# 目标系统: Debian/Ubuntu (apt)。需 sudo 权限安装 zsh/git/curl。
# 幂等: 可重复执行,已存在的组件会跳过,.zshrc 会被备份后刷新。
#
# 用法:
#   scp scripts/bootstrap-zsh.sh user@host:/tmp/ && ssh user@host 'bash /tmp/bootstrap-zsh.sh'
#   ssh user@host 'bash -s' < scripts/bootstrap-zsh.sh

set -euo pipefail

# === 网络源配置:依次尝试,首个成功即用;GitHub 不通自动走镜像 ===
# 若默认镜像不可用,自行替换下面 URL 即可。

# Oh My Zsh 主体: install.sh 与 ohmyzsh 仓库成对(用 | 分隔),保证全程同源,
# 避免 install.sh 从镜像下、却去 GitHub clone 主体的尴尬。
OHMYZSH_SOURCES=(
  "https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh|https://github.com/ohmyzsh/ohmyzsh.git"
  "https://gitee.com/mirrors/oh-my-zsh/raw/master/tools/install.sh|https://gitee.com/mirrors/oh-my-zsh.git"
)
# 插件: GitHub 优先,失败回退 gitclone 镜像 / gh-proxy 代理
PLUGIN_AUTOSUGGEST_URLS=(
  "https://github.com/zsh-users/zsh-autosuggestions"
  "https://gitclone.com/github.com/zsh-users/zsh-autosuggestions"
  "https://gh-proxy.com/https://github.com/zsh-users/zsh-autosuggestions"
)
PLUGIN_SYNTAX_HL_URLS=(
  "https://github.com/zsh-users/zsh-syntax-highlighting"
  "https://gitclone.com/github.com/zsh-users/zsh-syntax-highlighting"
  "https://gh-proxy.com/https://github.com/zsh-users/zsh-syntax-highlighting"
)

# 单个源的最大等待(秒),超时即切下一个源,避免 GitHub 不通时长时间卡死
PER_SOURCE_TIMEOUT=30

# 当前登录用户(脚本为该用户初始化 zsh)
TARGET_USER="$(id -un)"

# --- 临时文件清理: 任何退出情况(正常/出错/Ctrl+C)都删除,不残留 ---
TMP_FILES=()
cleanup() {
  for f in "${TMP_FILES[@]}"; do
    [ -e "$f" ] && rm -f "$f"
  done
}
trap cleanup EXIT

# --- 彩色输出 ---
info() { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m  %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31m[err ]\033[0m  %s\n' "$*" >&2; exit 1; }

# --- 1. 系统检查: 仅支持 Debian/Ubuntu (apt) ---
require_apt() {
  command -v apt-get >/dev/null 2>&1 || die "未检测到 apt-get,本脚本仅支持 Debian/Ubuntu。其他发行版请手动安装。"
  ok "系统检查通过 (apt)"
}

# --- 2. 安装系统依赖: zsh / git / curl (已装的不重装) ---
install_deps() {
  local need=()
  command -v zsh  >/dev/null 2>&1 || need+=(zsh)
  command -v git  >/dev/null 2>&1 || need+=(git)
  command -v curl >/dev/null 2>&1 || need+=(curl)
  if [ "${#need[@]}" -gt 0 ]; then
    info "安装依赖: ${need[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y "${need[@]}"
  fi
  ok "依赖就绪 (zsh/git/curl)"
}

# --- 3. 安装 Oh My Zsh (多源回退,install.sh 与 ohmyzsh 仓库全程同源) ---
install_ohmyzsh() {
  if [ -d "$HOME/.oh-my-zsh" ]; then
    ok "Oh My Zsh 已存在,跳过"
    return 0
  fi
  local installer
  installer="$(mktemp)"
  TMP_FILES+=("$installer")
  local entry install_url remote
  for entry in "${OHMYZSH_SOURCES[@]}"; do
    install_url="${entry%%|*}"
    remote="${entry##*|}"
    info "下载 install.sh ← $install_url"
    if curl -fsSL --connect-timeout 10 "$install_url" -o "$installer" 2>/dev/null; then
      # REMOTE 让 install.sh 从同一源 clone ohmyzsh 主体,避免 GitHub 不通时卡住
      if REMOTE="$remote" RUNZSH=no KEEP_ZSHRC=yes sh "$installer" </dev/null; then
        ok "Oh My Zsh 安装完成"
        return 0
      fi
      warn "Oh My Zsh 安装失败,尝试下一个源"
    else
      warn "下载 install.sh 失败,尝试下一个源"
    fi
  done
  die "Oh My Zsh 安装失败(GitHub/镜像均不可达,请检查网络)"
}

# --- 4. 安装插件 (多源回退,单个源限时,失败清理半成品) ---
install_plugin() {
  local name="$1"; shift
  local dest="$HOME/.oh-my-zsh/custom/plugins/$name"
  if [ -d "$dest" ]; then
    ok "插件已存在,跳过: $name"
    return 0
  fi
  local url
  for url in "$@"; do
    info "克隆插件: $name ← $url"
    if timeout "$PER_SOURCE_TIMEOUT" git clone --depth=1 "$url" "$dest"; then
      ok "插件安装完成: $name"
      return 0
    fi
    warn "克隆失败(或超时),尝试下一个源"
    rm -rf "$dest"
  done
  die "克隆插件失败: $name (GitHub/镜像均不可达)"
}

# --- 5. 写入 ~/.zshrc (已存在则备份,带时间戳) ---
write_zshrc() {
  local target="$HOME/.zshrc"
  if [ -f "$target" ]; then
    local bak="$target.bak.$(date +%Y%m%d%H%M%S)"
    cp "$target" "$bak"
    warn "已备份原 .zshrc -> $bak"
  fi
  cat > "$target" <<'ZSHRC'
# Managed by diteng-pannel bootstrap-zsh.sh
# 如需自定义配置,请在本文件末尾追加,避免覆盖上面的内容。

# Oh My Zsh
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="ys"

plugins=(
  git
  zsh-autosuggestions
  zsh-syntax-highlighting
)

source $ZSH/oh-my-zsh.sh
ZSHRC
  ok ".zshrc 已写入 (主题=ys, 插件=git/autosuggestions/syntax-highlighting)"
}

# --- 6. 切换默认 shell 到 zsh ---
change_default_shell() {
  local zsh_path current
  zsh_path="$(command -v zsh)"
  current="$(getent passwd "$TARGET_USER" | cut -d: -f7)"
  if [ "$current" = "$zsh_path" ]; then
    ok "默认 shell 已是 zsh"
    return 0
  fi
  info "切换默认 shell -> $zsh_path"
  if sudo chsh -s "$zsh_path" "$TARGET_USER" 2>/dev/null; then
    ok "默认 shell 已切换为 zsh"
  else
    warn "自动切换失败 (可能需要密码),请手动执行: chsh -s $zsh_path"
  fi
}

main() {
  info "目标用户: $TARGET_USER  主机: $(hostname)"
  require_apt
  install_deps
  install_ohmyzsh
  install_plugin zsh-autosuggestions "${PLUGIN_AUTOSUGGEST_URLS[@]}"
  install_plugin zsh-syntax-highlighting "${PLUGIN_SYNTAX_HL_URLS[@]}"
  write_zshrc
  change_default_shell
  ok "全部完成! 重新登录或执行 zsh 即可使用"
}

main "$@"
