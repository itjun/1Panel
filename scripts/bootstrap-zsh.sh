#!/bin/sh
# 1Panel remote zsh setup. Run as the SSH login user, never sudo this whole script.
# --inspect is read-only. --apply preserves .zshrc and writes an owned include.
set -eu
umask 077
BASE="$HOME/.local/share/1panel/zsh"
CONFIG="$BASE/setup.zsh"
THEME_ROOT="$BASE/oh-my-zsh"
OMZ_SHA256='4bbd395f4a81b8bc66a6a02804a46236ed13643a3ac22082c843fcfbcf3a767e'
OMZ_COMMIT='106f9874a22ec8cfa1e69ae8e1143d8720f087dc'
ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"
BEGIN='# >>> 1Panel zsh >>>'
END='# <<< 1Panel zsh <<<'
HIGHLIGHT=1
SUGGEST=1
CORRECTION=0
DEFAULT_SHELL=0
BASE_PACKAGES=0
APT_LOCK_TIMEOUT="${ONEPANEL_APT_LOCK_TIMEOUT:-300}"
case "$APT_LOCK_TIMEOUT" in ''|*[!0-9]*) printf '%s\n' '[错误] APT 锁等待秒数必须为 0–300 的整数。' >&2; exit 1 ;; esac
[ "${#APT_LOCK_TIMEOUT}" -le 3 ] && [ "$APT_LOCK_TIMEOUT" -le 300 ] || { printf '%s\n' '[错误] APT 锁等待秒数必须为 0–300 的整数。' >&2; exit 1; }
ACTION=apply
WORK=''
BACKUP=''
COMMITTED=0
clone_pid=''
timer_pid=''

log() { printf '%s\n' "$*"; }
die() { log "[错误] $*" >&2; exit 1; }
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
privileged() {
  if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi
}
login_shell() {
  if command -v getent >/dev/null 2>&1; then
    getent passwd "$(id -un)" | cut -d: -f7
  else
    awk -F: -v u="$(id -un)" '$1==u {print $7}' /etc/passwd
  fi
}
manager() {
  for pm in apt-get dnf yum apk; do
    if command -v "$pm" >/dev/null 2>&1; then printf '%s' "$pm"; return; fi
  done
  printf 'unsupported'
}
plugin_path() {
  name="$1"
  for dir in "$BASE/plugins/$name" "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/$name" "/usr/share/$name" "/usr/share/zsh/plugins/$name"; do
    if [ -f "$dir/$name.zsh" ]; then printf '%s' "$dir/$name.zsh"; return; fi
  done
}
framework_path() {
  for dir in "${ZSH:-$HOME/.oh-my-zsh}" "$HOME/.oh-my-zsh" "$BASE/oh-my-zsh-full" "$BASE/oh-my-zsh"; do
    if [ -r "$dir/oh-my-zsh.sh" ] && [ -r "$dir/lib/cli.zsh" ] && [ -r "$dir/lib/completion.zsh" ]; then printf '%s' "$dir"; return; fi
  done
}
inspect() {
  printf 'os=%s\n' "$(uname -s)"
  if [ -r /etc/os-release ]; then
    . /etc/os-release
    printf 'distribution=%s\n' "${PRETTY_NAME:-${ID:-Linux}}"
  fi
  printf 'user=%s\nhome=%s\nshell=%s\nmanager=%s\nzshrc=%s\n' "$(id -un)" "$HOME" "$(login_shell)" "$(manager)" "$ZSHRC"
  if command -v zsh >/dev/null 2>&1; then printf 'zsh=%s\n' "$(zsh --version)"; fi
  if [ "$(id -u)" = 0 ] || (command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null); then printf 'privileged=true\n'; fi
  if command -v git >/dev/null 2>&1; then printf 'git=true\n'; fi
  framework="$(framework_path)"
  if [ -n "$framework" ]; then printf 'ohMyZsh=true\nohMyZshRoot=%s\n' "$framework"; fi
  if [ -n "$(plugin_path zsh-syntax-highlighting)" ]; then printf 'highlighting=true\n'; fi
  if [ -n "$(plugin_path zsh-autosuggestions)" ]; then printf 'suggestions=true\n'; fi
  if [ -f "$CONFIG" ] && [ -f "$ZSHRC" ] && grep -Fqx "$BEGIN" "$ZSHRC" && grep -Fqx "[ ! -f $(quote "$CONFIG") ] || source $(quote "$CONFIG")" "$ZSHRC"; then
    printf 'managed=true\n'
    if grep -Fqx 'ZSH_THEME="ys"' "$CONFIG"; then printf 'theme=ys\n'; fi
    for feature in highlighting suggestions correction; do
      if grep -Fqx "# feature:$feature" "$CONFIG"; then printf '%sEnabled=true\n' "$feature"; fi
    done
  fi
  latest=''
  for backup_script in "$BASE"/backups/*/restore.sh; do
    [ -f "$backup_script" ] || continue
    if [ -z "$latest" ] || [ "$backup_script" -nt "$latest" ]; then latest="$backup_script"; fi
  done
  if [ -n "$latest" ]; then printf 'restoreCommand=sh %s\n' "$(quote "$latest")"; fi
}
cleanup() {
  result=$?
  trap - EXIT
  [ -z "$clone_pid" ] || kill "$clone_pid" 2>/dev/null || true
  [ -z "$timer_pid" ] || kill "$timer_pid" 2>/dev/null || true
  if [ "$result" -ne 0 ] && [ "$COMMITTED" = 1 ] && [ -n "$BACKUP" ]; then
    log '[恢复] 配置验证失败，恢复本次修改前的配置'
    sh "$BACKUP/restore.sh" || log "[警告] 自动恢复失败，请执行: sh $(quote "$BACKUP/restore.sh")"
  fi
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  rmdir "$BASE/.lock" 2>/dev/null || true
  exit "$result"
}
apt_update_with_wait() {
  started="$(date +%s)"
  while :; do
    apt_result=0
    privileged env LC_ALL=C apt-get update > "$WORK/apt-update.log" 2>&1 || apt_result=$?
    cat "$WORK/apt-update.log"
    [ "$apt_result" != 0 ] || return 0
    if ! grep -Eq 'Could not get lock .*([Rr]esource temporarily unavailable|held by process)' "$WORK/apt-update.log"; then
      die 'APT 软件索引更新失败，请检查上方的软件源或网络错误。'
    fi
    elapsed=$(( $(date +%s) - started ))
    [ "$elapsed" -lt "$APT_LOCK_TIMEOUT" ] || die "APT 索引锁等待超过 $APT_LOCK_TIMEOUT 秒，请等待其他更新任务完成后重试。"
    delay=5
    remaining=$(( APT_LOCK_TIMEOUT - elapsed ))
    [ "$remaining" -ge "$delay" ] || delay="$remaining"
    log "[等待] 其他 APT 更新任务占用索引锁，${delay} 秒后重试（最多 $APT_LOCK_TIMEOUT 秒）"
    sleep "$delay"
  done
}
install_deps() {
  need=''
  if [ "$BASE_PACKAGES" = 1 ]; then
    # Base software bundle from itjun-tools/debian/init.sh, using existing sources.
    # chsh is split into a separate package on RPM and Alpine distributions.
    need='openssh-server vim curl wget sudo tree ca-certificates zsh git'
    case "$(manager)" in
      apt-get) need="$need htop btop" ;;
      dnf|yum) need="$need util-linux-user" ;;
      apk) need='openssh vim curl wget sudo tree ca-certificates zsh git shadow' ;;
    esac
  else
    command -v zsh >/dev/null 2>&1 || need="$need zsh"
    # ys uses Git for its prompt; missing plugins are fetched from official sources.
    command -v git >/dev/null 2>&1 || need="$need git ca-certificates"
  fi
  [ -n "$need" ] || return 0
  if [ "$(id -u)" != 0 ]; then
    command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null || die '安装系统依赖需要 root 或免密 sudo，请在终端安装依赖后重新检测。'
  fi
  log "[依赖] 安装:$need"
  # These package names are a fixed internal list, never user input.
  case "$(manager)" in
    apt-get)
      apt_update_with_wait
      log "[APT] 安装锁繁忙时自动等待，最多 $APT_LOCK_TIMEOUT 秒；锁释放后继续安装"
      privileged env DEBIAN_FRONTEND=noninteractive LC_ALL=C apt-get -o "DPkg::Lock::Timeout=$APT_LOCK_TIMEOUT" install -y $need
      ;;
    dnf|yum) privileged "$(manager)" install -y $need ;;
    apk) privileged apk add $need ;;
    *) die '暂不支持当前包管理器，请先在终端安装 zsh 和 git。' ;;
  esac
  if [ "$BASE_PACKAGES" = 1 ]; then
    log '[软件] itjun-tools 基础软件、zsh 和 Git 安装完成'
    if command -v systemctl >/dev/null 2>&1; then
      service=sshd
      [ "$(manager)" != apt-get ] || service=ssh
      privileged systemctl enable "$service" || die 'SSH 开机启动设置失败，软件已保留，请检查服务后重试。'
      log "[服务] $service 已设为开机启动"
    elif command -v rc-update >/dev/null 2>&1; then
      privileged rc-update add sshd default || die 'SSH 开机启动设置失败，软件已保留，请检查服务后重试。'
      log '[服务] sshd 已加入默认启动级别'
    else
      log '[提示] 当前系统未使用 systemd 或 OpenRC；SSH 服务开机启动需在终端检查。'
    fi
  fi
}
clone_repository() {
  component="$1"
  url="$2"
  dest="$3"
  staging="$WORK/$component"
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 5 90 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 clone --depth=1 "$url" "$staging" || die "下载 $component 失败或超时，请检查主机访问 GitHub 的网络后重试。"
    mv "$staging" "$dest"
    return
  fi
  git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 clone --depth=1 "$url" "$staging" &
  clone_pid=$!
  (
    trap 'kill "$sleeper" 2>/dev/null || true; exit' TERM INT HUP
    sleep 90 &
    sleeper=$!
    wait "$sleeper"
    kill "$clone_pid" 2>/dev/null || true
  ) >/dev/null 2>&1 &
  timer_pid=$!
  clone_result=0
  wait "$clone_pid" || clone_result=$?
  kill "$timer_pid" 2>/dev/null || true
  wait "$timer_pid" 2>/dev/null || true
  clone_pid=''
  timer_pid=''
  [ "$clone_result" = 0 ] || die "下载 $component 失败或超时，请检查主机访问 GitHub 的网络后重试。"
  mv "$staging" "$dest"
}
install_plugin() {
  plugin="$1"
  if [ -n "$(plugin_path "$plugin")" ]; then log "[插件] 已存在: $plugin"; return; fi
  dest="$BASE/plugins/$plugin"
  [ ! -e "$dest" ] || die "目录存在但插件不完整，请检查: $dest"
  log "[插件] 安装官方源码: $plugin"
  case "$plugin" in
    zsh-autosuggestions) plugin_checksum='20665e469e720e674964a66854d5534b9af78cdfd438512746ecd1ade8e819ce' ;;
    zsh-syntax-highlighting) plugin_checksum='6e8258a74e6f3cac03e1bb5ee72504bc4d819904e9aa742d62f60833168db265' ;;
    *) die "未知插件: $plugin" ;;
  esac
  archive="$WORK/$plugin.tar.gz"
  local_archive="$(dirname "$0")/zsh-plugins/$plugin/$plugin.tar.gz"
  if command -v materialize_zsh_plugin >/dev/null 2>&1; then
    materialize_zsh_plugin "$plugin" > "$archive" || die "读取内置插件失败: $plugin"
  elif [ -f "$local_archive" ]; then
    cp "$local_archive" "$archive"
  else
    clone_repository "$plugin" "https://github.com/zsh-users/$plugin.git" "$dest"
    [ -f "$dest/$plugin.zsh" ] || die "插件文件缺失: $plugin"
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    checksum="$(sha256sum "$archive" | cut -d' ' -f1)"
  else
    checksum="$(shasum -a 256 "$archive" | cut -d' ' -f1)"
  fi
  [ "$checksum" = "$plugin_checksum" ] || die "插件安装包校验失败: ${plugin}；未写入配置。"
  mkdir "$WORK/$plugin"
  tar -xzf "$archive" --strip-components=1 -C "$WORK/$plugin" || die "插件安装包解压失败: $plugin"
  [ -f "$WORK/$plugin/$plugin.zsh" ] || die "插件文件缺失: $plugin"
  mv "$WORK/$plugin" "$dest"
}
install_oh_my_zsh() {
  framework="$(framework_path)"
  if [ -z "$framework" ]; then
    framework="$HOME/.oh-my-zsh"
    # Keep partial directories and custom plugin files intact.
    [ ! -e "$framework" ] || framework="$BASE/oh-my-zsh-full"
    [ ! -e "$framework" ] || die "Oh My Zsh 目录存在但框架不完整，请检查: $framework"
    log '[Oh My Zsh] 安装完整官方框架（含全部内置插件、主题和工具）'
    archive="$WORK/oh-my-zsh.tar.gz"
    if command -v materialize_oh_my_zsh >/dev/null 2>&1; then
      materialize_oh_my_zsh > "$archive"
    elif [ -f "$(dirname "$0")/oh-my-zsh/oh-my-zsh.tar.gz" ]; then
      cp "$(dirname "$0")/oh-my-zsh/oh-my-zsh.tar.gz" "$archive"
    elif command -v curl >/dev/null 2>&1; then
      curl --fail --location --connect-timeout 10 --max-time 90 "https://codeload.github.com/ohmyzsh/ohmyzsh/tar.gz/$OMZ_COMMIT" -o "$archive" || die '下载 Oh My Zsh 失败，请检查网络后重试。'
    elif command -v wget >/dev/null 2>&1; then
      wget --timeout=20 --tries=2 "https://codeload.github.com/ohmyzsh/ohmyzsh/tar.gz/$OMZ_COMMIT" -O "$archive" || die '下载 Oh My Zsh 失败，请检查网络后重试。'
    else
      die '缺少 curl 或 wget，无法下载完整 Oh My Zsh。'
    fi
    if command -v sha256sum >/dev/null 2>&1; then
      checksum="$(sha256sum "$archive" | cut -d' ' -f1)"
    else
      checksum="$(shasum -a 256 "$archive" | cut -d' ' -f1)"
    fi
    [ "$checksum" = "$OMZ_SHA256" ] || die 'Oh My Zsh 安装包校验失败，未写入配置。'
    mkdir "$WORK/oh-my-zsh"
    tar -xzf "$archive" --strip-components=1 -C "$WORK/oh-my-zsh" || die 'Oh My Zsh 安装包解压失败。'
    [ -f "$WORK/oh-my-zsh/oh-my-zsh.sh" ] && [ -f "$WORK/oh-my-zsh/lib/cli.zsh" ] || die 'Oh My Zsh 框架文件缺失。'
    mv "$WORK/oh-my-zsh" "$framework"
  fi
  THEME_ROOT="$framework"
  for asset in themes/ys.zsh-theme lib/git.zsh lib/async_prompt.zsh lib/functions.zsh plugins/svn/svn.plugin.zsh; do
    [ -f "$THEME_ROOT/$asset" ] || die "ys 主题依赖缺失，请检查: $THEME_ROOT/$asset"
  done
  log "[Oh My Zsh] 完整框架就绪: $THEME_ROOT"
  log '[主题] ys 就绪'
}
backup_config() {
  BACKUP="$(mktemp -d "$BASE/backups/$(date +%Y%m%d-%H%M%S).XXXXXX")"
  [ ! -f "$ZSHRC" ] || cp -p "$ZSHRC" "$BACKUP/zshrc"
  [ ! -f "$CONFIG" ] || cp -p "$CONFIG" "$BACKUP/setup.zsh"
  old_shell="$(login_shell)"
  {
    printf '#!/bin/sh\nset -eu\n'
    printf 'rc=%s\nconfig=%s\nbackup=%s\n' "$(quote "$ZSHRC")" "$(quote "$CONFIG")" "$(quote "$BACKUP")"
    printf 'if [ -f "$backup/zshrc" ]; then cp -p "$backup/zshrc" "$rc"; else rm -f "$rc"; fi\n'
    printf 'if [ -f "$backup/setup.zsh" ]; then cp -p "$backup/setup.zsh" "$config"; else rm -f "$config"; fi\n'
    if [ "$DEFAULT_SHELL" = 1 ]; then
      printf 'if [ "$(id -u)" = 0 ]; then chsh -s %s %s; else sudo -n chsh -s %s %s; fi\n' "$(quote "$old_shell")" "$(quote "$(id -un)")" "$(quote "$old_shell")" "$(quote "$(id -un)")"
    fi
    printf 'printf "已恢复本次修改前的配置，请重新登录。\\n"\n'
  } > "$BACKUP/restore.sh"
  log "[备份] $BACKUP"
  log "[恢复命令] sh $(quote "$BACKUP/restore.sh")"
}
write_config() {
  {
    printf '# Managed by 1Panel. Personal configuration and PATH stay in .zshrc.\n'
    printf 'ZSH_THEME="ys"\nautoload -Uz colors add-zsh-hook\ncolors\nzmodload zsh/terminfo\nsetopt PROMPT_SUBST\n'
    # Load the complete framework once; keep any existing plugin list.
    printf 'if (( ! $+functions[_omz_source] )); then\n  if [[ ! -f "${ZSH:-}/oh-my-zsh.sh" ]]; then export ZSH=%s; fi\n  typeset -ga plugins\n  (( ${#plugins} )) || plugins=(git svn)\n  typeset -A _1panel_original_aliases\n  _1panel_original_aliases=("${(@kv)aliases}")\n  source "$ZSH/oh-my-zsh.sh"\n  for _1panel_alias in "${(@k)_1panel_original_aliases}"; do\n    aliases[$_1panel_alias]=${_1panel_original_aliases[$_1panel_alias]}\n  done\n  unset _1panel_original_aliases _1panel_alias\nfi\n' "$(quote "$THEME_ROOT")"
    # Existing framework installations may not have the svn plugin enabled.
    printf 'if (( ! $+functions[git_prompt_info] )); then\n  source %s\n  source %s\nfi\n' "$(quote "$THEME_ROOT/lib/async_prompt.zsh")" "$(quote "$THEME_ROOT/lib/git.zsh")"
    printf 'if (( ! $+functions[svn_prompt_info] )); then\n  if (( ! $+functions[omz_urldecode] )); then source %s; fi\n  source %s\nfi\n' "$(quote "$THEME_ROOT/lib/functions.zsh")" "$(quote "$THEME_ROOT/plugins/svn/svn.plugin.zsh")"
    printf 'source %s\nRPROMPT=""\n' "$(quote "$THEME_ROOT/themes/ys.zsh-theme")"
    if [ "$SUGGEST" = 1 ]; then
      printf '# feature:suggestions\n'
      printf 'HISTFILE=${HISTFILE:-$HOME/.zsh_history}\n(( HISTSIZE >= 10000 )) || HISTSIZE=10000\n(( SAVEHIST >= 10000 )) || SAVEHIST=10000\nsetopt APPEND_HISTORY HIST_IGNORE_SPACE\n'
      printf 'ZSH_AUTOSUGGEST_STRATEGY=(history)\n'
      printf 'if (( ! $+functions[_zsh_autosuggest_start] )); then source %s; fi\n' "$(quote "$(plugin_path zsh-autosuggestions)")"
    fi
    # Must load last, after the autosuggestion widgets.
    if [ "$HIGHLIGHT" = 1 ]; then
      printf '# feature:highlighting\n'
      printf 'if (( ! $+functions[_zsh_highlight] )); then source %s; fi\n' "$(quote "$(plugin_path zsh-syntax-highlighting)")"
    fi
    if [ "$CORRECTION" = 1 ]; then
      printf '# feature:correction\nunsetopt correctall\nsetopt correct\n'
    else
      printf '# Spell correction is disabled by default, including Oh My Zsh options.\nunsetopt correct correctall\n'
    fi
  } > "$WORK/setup.zsh"
  if [ -f "$ZSHRC" ]; then
    awk -v b="$BEGIN" -v e="$END" '$0==b {skip=1;next} $0==e {skip=0;next} !skip {print}' "$ZSHRC" > "$WORK/zshrc"
  else
    : > "$WORK/zshrc"
  fi
  {
    printf '%s\n' "$BEGIN"
    printf '[ ! -f %s ] || source %s\n' "$(quote "$CONFIG")" "$(quote "$CONFIG")"
    printf '%s\n' "$END"
  } >> "$WORK/zshrc"
  zsh -n "$WORK/setup.zsh" || die '生成的插件配置未通过语法检查。'
  zsh -n "$WORK/zshrc" || die '原 .zshrc 存在语法错误，请修复后重试；本次未写入配置。'
  # Keep the existing rc inode and symlink target, including its original permissions.
  COMMITTED=1
  cat "$WORK/setup.zsh" > "$CONFIG"
  cat "$WORK/zshrc" > "$ZSHRC"
  log '[配置] 已保留个人配置，并在末尾加载 1Panel 插件配置'
  zsh -dfi -c 'source "$1"; [[ "$ZSH_THEME" == ys && -n "$PROMPT" && -f "$ZSH/oh-my-zsh.sh" ]] || exit 1; (( $+functions[_omz_source] && $+functions[omz] && $+functions[git_prompt_info] && $+functions[svn_prompt_info] )) || exit 1; [[ ! -o correctall ]] || exit 1; if [ "$2" = 1 ]; then [[ -o correct ]] || exit 1; else [[ ! -o correct ]] || exit 1; fi; if [ "$3" = 1 ]; then (( $+functions[_zsh_autosuggest_start] )) || exit 1; fi; if [ "$4" = 1 ]; then (( $+functions[_zsh_highlight] )) || exit 1; fi' -- "$CONFIG" "$CORRECTION" "$SUGGEST" "$HIGHLIGHT" || die '框架、主题或插件加载验证失败。'
  log '[验证] 完整 Oh My Zsh、ys 主题、配置语法和所选功能加载验证通过'
}
apply() {
  [ "$(uname -s)" = Linux ] || die '当前仅支持远程 Linux 主机。'
  [ "$(manager)" != unsupported ] || die '支持 apt、dnf、yum、apk；其他发行版暂不支持自动初始化。'
  [ -d "${ZDOTDIR:-$HOME}" ] || die 'zsh 配置目录不存在。'
  if [ -L "$ZSHRC" ] && [ ! -e "$ZSHRC" ]; then die '.zshrc 指向不存在的目标，请先修复符号链接。'; fi
  if [ -e "$ZSHRC" ]; then
    [ -f "$ZSHRC" ] && [ -w "$ZSHRC" ] || die '.zshrc 不是可写的普通文件。'
    awk -v b="$BEGIN" -v e="$END" '$0==b {if (inside) exit 1;inside=1} $0==e {if (!inside) exit 1;inside=0} END {if (inside) exit 1}' "$ZSHRC" || die '1Panel 配置标记不完整，请先检查 .zshrc。'
  fi
  mkdir -p "$BASE/plugins" "$BASE/backups"
  mkdir "$BASE/.lock" 2>/dev/null || die "已有初始化任务或残留锁: $BASE/.lock；确认没有任务运行后移除该空目录。"
  trap cleanup EXIT
  trap 'exit 130' INT TERM HUP
  WORK="$(mktemp -d "$BASE/.work.XXXXXX")"
  log "[开始] $(hostname) · $(id -un)"
  install_deps
  install_oh_my_zsh
  [ "$SUGGEST" != 1 ] || install_plugin zsh-autosuggestions
  [ "$HIGHLIGHT" != 1 ] || install_plugin zsh-syntax-highlighting
  if [ "$DEFAULT_SHELL" = 1 ]; then
    command -v chsh >/dev/null 2>&1 || die '缺少 chsh，请取消设为默认 Shell 后重试。'
    [ "$(id -u)" = 0 ] || (command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null) || die '切换默认 Shell 需要 root 或免密 sudo。'
  fi
  backup_config
  write_config
  if [ "$DEFAULT_SHELL" = 1 ]; then
    privileged chsh -s "$(command -v zsh)" "$(id -un)" || die '切换默认 Shell 失败。'
    [ "$(login_shell)" = "$(command -v zsh)" ] || die '默认 Shell 未生效。'
    log '[Shell] 默认 Shell 已设为 zsh，重新登录后生效'
  fi
  COMMITTED=0
  log '[完成] 重新登录或运行 zsh 即可使用；恢复命令见上方日志'
}
for arg in "$@"; do
  case "$arg" in
    --inspect) ACTION=inspect ;;
    --apply) ACTION=apply ;;
    --no-highlighting) HIGHLIGHT=0 ;;
    --no-suggestions) SUGGEST=0 ;;
    --no-correction) CORRECTION=0 ;;
    --correction) CORRECTION=1 ;;
    --default-shell) DEFAULT_SHELL=1 ;;
    --base-packages) BASE_PACKAGES=1 ;;
    *) die "未知参数: $arg" ;;
  esac
done
case "$ACTION" in inspect) inspect ;; apply) apply ;; esac
