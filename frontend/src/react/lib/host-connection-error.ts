import { formatErr } from "@/utils/format";

/** 只根据已知失败阶段给建议；裸超时不能据此断定 SSH 正常或 Agent 未安装。 */
export function hostConnectionError(error: unknown): { title: string; hint: string } {
  const detail = formatErr(error);
  if (/unable to authenticate|authentication failed|no supported methods remain|没有可用的认证方式|permission denied \(publickey/i.test(detail)) {
    return { title: "SSH 认证失败", hint: "核对主机的登录用户、密钥或密码。终端能连接时，也要确认 1Panel 使用的是同一份密钥。" };
  }
  if (/agent 未安装/i.test(detail)) {
    return { title: "Agent 未安装", hint: "未找到 Agent 凭据。请点击“检查 Agent”确认安装状态，再按检查结果处理。" };
  }
  if (/无 root 权限|sudo|读取 Agent 凭据/i.test(detail) && !/SSH 连接超时/.test(detail)) {
    return { title: "无法读取 Agent 凭据", hint: "检查登录用户是否能读取 Agent 凭据。普通用户需要 sudo 权限，或在主机设置中填写可用于提权的密码。" };
  }
  if (/administratively prohibited|port forwarding is disabled/i.test(detail)) {
    return { title: "SSH 转发被拒绝", hint: "Agent 通过 SSH 转发访问主机的 127.0.0.1:39190。请检查服务端是否允许 TCP 转发，以及登录用户是否受转发规则限制。" };
  }
  if (/agent 不可达|connect failed/i.test(detail)) {
    return { title: "Agent 端口不可达", hint: "请点击“检查 Agent”确认服务是否正在运行，以及 127.0.0.1:39190 是否在监听。端口不通不代表 Agent 未安装。" };
  }
  if (/HTTP 401|unauthorized|invalid token/i.test(detail)) {
    return { title: "Agent 认证失败", hint: "Agent 拒绝了当前凭据。请先重试连接；若仍失败，点击“检查 Agent”核对服务与凭据状态。" };
  }
  if (/SSH 连接超时|no route to host|network is unreachable|host is down/i.test(detail)) {
    return { title: /timeout|超时/i.test(detail) ? "SSH 连接超时" : "主机网络不可达", hint: "检查 VPN、网络路由和目标地址是否可达。终端 SSH 能连接时，核对应用中的地址、端口和代理配置；macOS 还可检查系统设置中的“本地网络”权限。" };
  }
  if (/connection refused/i.test(detail)) {
    return { title: "SSH 端口拒绝连接", hint: "核对主机地址和 SSH 端口，检查远端 SSH 服务是否运行，以及防火墙是否允许访问。" };
  }
  if (/deadline exceeded|timed? out|timeout|超时/i.test(detail)) {
    return { title: "连接或采集超时", hint: "检查 VPN 和网络是否稳定。终端 SSH 能连接时，点击“检查 Agent”，继续核对服务、SSH 转发和采集状态。" };
  }
  return { title: "连接或采集失败", hint: "请点击“检查 Agent”查看服务、通信和采集的具体结果，也可打开终端核对该主机的 SSH 连接。" };
}
