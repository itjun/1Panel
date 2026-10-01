package agentinstall

import "strings"

// 运行方式：systemd 走 unit；supervisor 为无 systemd 主机（容器 / OpenRC / sysvinit）的自带守护循环
const (
	InitSystemd    = "systemd"
	InitSupervisor = "supervisor"
)

// remoteCtl 远端统一控制脚本：面板的启动 / 停止 / 状态 / 补拉起都只调用它
const remoteCtl = "/usr/local/bin/spanel-agent-ctl"

// ctlTemplate spanel-agent-ctl 的 POSIX sh 实现（兼容 busybox）。
// 约束：
//   - pid 文件放 /run（0644），状态用 /proc 判断而非 kill -0，普通用户也能查 status
//   - active 要求守护循环和 agent 进程同时在：二进制坏掉反复崩溃时报 inactive，安装流程才会回滚
//   - 守护循环经 setsid + nohup 脱离 SSH 会话，断开连接不会收到 SIGHUP
//   - nice / ionice 先试跑一次再用，容器里没权限时不会让 agent 起不来
//   - 不能出现单独一行 SPANEL_CTL（安装脚本用它做 heredoc 结束符）
const ctlTemplate = `#!/bin/sh
# spanel-agent 运行控制（由 1Panel 面板生成，重装会覆盖）
MODE=__MODE__
BIN=/usr/local/bin/spanel-agent
CTL=/usr/local/bin/spanel-agent-ctl
DATA=/var/lib/spanel-agent
LOG="$DATA/agent.log"
LOG_MAX=5242880
if [ -d /run ]; then PIDF=/run/spanel-agent.pid; else PIDF=/var/run/spanel-agent.pid; fi
TAG="# spanel-agent"

sup_alive() {
  [ -f "$PIDF" ] || return 1
  p=$(cat "$PIDF" 2>/dev/null)
  [ -n "$p" ] && [ -d "/proc/$p" ] || return 1
  tr '\000' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q '_loop'
}

agent_alive() {
  for d in /proc/[0-9]*; do
    [ "$(cat "$d/comm" 2>/dev/null)" = "spanel-agent" ] && return 0
  done
  return 1
}

kill_agents() {
  for d in /proc/[0-9]*; do
    [ "$(cat "$d/comm" 2>/dev/null)" = "spanel-agent" ] && kill "${d#/proc/}" 2>/dev/null
  done
  return 0
}

do_status() {
  if [ "$MODE" = systemd ]; then
    s=$(systemctl is-active spanel-agent 2>/dev/null)
    echo "${s:-inactive}"
  elif sup_alive && agent_alive; then
    echo active
  else
    echo inactive
  fi
}

do_stop() {
  if [ "$MODE" = systemd ]; then
    systemctl stop spanel-agent 2>/dev/null
    return 0
  fi
  if [ -f "$PIDF" ]; then
    p=$(cat "$PIDF" 2>/dev/null)
    [ -n "$p" ] && kill "$p" 2>/dev/null
    rm -f "$PIDF"
  fi
  sleep 1
  kill_agents
  return 0
}

do_start() {
  if [ "$MODE" = systemd ]; then
    systemctl daemon-reload
    systemctl enable spanel-agent >/dev/null 2>&1
    systemctl restart spanel-agent
    return $?
  fi
  do_stop
  mkdir -p "$DATA" && chmod 700 "$DATA"
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup "$CTL" _loop </dev/null >>"$LOG" 2>&1 &
  else
    nohup "$CTL" _loop </dev/null >>"$LOG" 2>&1 &
  fi
  sleep 1
  sup_alive
}

do_loop() {
  echo $$ > "$PIDF"
  chmod 644 "$PIDF" 2>/dev/null
  { echo 500 > /proc/self/oom_score_adj; } 2>/dev/null
  export GOMEMLIMIT=64MiB
  PRE=""
  ionice -c3 true >/dev/null 2>&1 && PRE="ionice -c3"
  nice -n 10 true >/dev/null 2>&1 && PRE="$PRE nice -n 10"
  child=""
  trap '[ -n "$child" ] && kill "$child" 2>/dev/null; exit 0' TERM INT HUP
  while :; do
    if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt "$LOG_MAX" ]; then : > "$LOG"; fi
    $PRE "$BIN" &
    child=$!
    wait "$child"
    sleep 3
  done
}

install_hooks() {
  [ "$MODE" = supervisor ] || return 0
  if command -v rc-update >/dev/null 2>&1 && [ -d /etc/local.d ]; then
    printf '#!/bin/sh\n%s ensure >/dev/null 2>&1\n' "$CTL" > /etc/local.d/spanel-agent.start
    chmod 755 /etc/local.d/spanel-agent.start
    rc-update add local default >/dev/null 2>&1
  fi
  if command -v crontab >/dev/null 2>&1; then
    { crontab -l 2>/dev/null | grep -v "$TAG"
      echo "@reboot $CTL ensure >/dev/null 2>&1 $TAG"
      echo "* * * * * $CTL ensure >/dev/null 2>&1 $TAG"
    } | crontab - 2>/dev/null
  fi
  return 0
}

uninstall_hooks() {
  rm -f /etc/local.d/spanel-agent.start
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q "$TAG"; then
    crontab -l 2>/dev/null | grep -v "$TAG" | crontab - 2>/dev/null
  fi
  return 0
}

case "$1" in
  start) do_start ;;
  stop) do_stop ;;
  status) do_status ;;
  ensure)
    if [ "$(do_status)" = active ]; then echo ok; else do_start; echo started; fi ;;
  _loop) do_loop ;;
  install-hooks) install_hooks ;;
  uninstall-hooks) uninstall_hooks ;;
  *) echo "usage: $0 start|stop|status|ensure|install-hooks|uninstall-hooks" >&2; exit 2 ;;
esac
`

// ctlScriptFor 生成指定运行方式的控制脚本
func ctlScriptFor(mode string) string {
	if mode != InitSystemd {
		mode = InitSupervisor
	}
	return strings.ReplaceAll(ctlTemplate, "__MODE__", mode)
}
