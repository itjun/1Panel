/**
 * 浏览器看板 HTTP API（只读）。与桌面 Wails 绑定解耦。
 */
import type { agentcli, monitor } from "@/api";

export type BoardHostBrief = {
  name: string;
  hostName: string;
};

export type BoardGroupInfo = {
  name: string;
  boardTitle: string;
  hosts: BoardHostBrief[] | null;
};

export type BoardHTTPSettings = {
  hostAppNotifySubs: Record<string, string[]> | null;
};

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "GET", credentials: "same-origin" });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const boardHttpApi = {
  group: (group: string) => getJSON<BoardGroupInfo>(`/api/board/${encodeURIComponent(group)}`),
  settings: () => getJSON<BoardHTTPSettings>("/api/board/settings"),
  overview: (group: string, host: string) =>
    getJSON<monitor.Overview>(
      `/api/board/${encodeURIComponent(group)}/hosts/${encodeURIComponent(host)}/overview`,
    ),
  disks: (group: string, host: string) =>
    getJSON<monitor.DiskInfo[]>(
      `/api/board/${encodeURIComponent(group)}/hosts/${encodeURIComponent(host)}/disks`,
    ),
  range: (group: string, host: string, from: number, to: number, src = "auto") => {
    const q = new URLSearchParams({
      from: String(from),
      to: String(to),
      src,
    });
    return getJSON<agentcli.RangeResponse>(
      `/api/board/${encodeURIComponent(group)}/hosts/${encodeURIComponent(host)}/range?${q}`,
    );
  },
  watchInstances: (group: string, host: string) =>
    getJSON<agentcli.JavaAppInstance[]>(
      `/api/board/${encodeURIComponent(group)}/hosts/${encodeURIComponent(host)}/watch-instances`,
    ),
};

/** 路径段是否像合法分组名（两位数字前缀 + ASCII）。 */
export function looksLikeGroupPath(segment: string): boolean {
  return /^[0-9]{2}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(segment);
}

/** 从 pathname 解析看板分组名；非看板路径返回空。 */
export function boardGroupFromPath(pathname: string): string {
  const raw = (pathname || "/").replace(/\/+$/, "") || "/";
  if (raw === "/" || raw.startsWith("/api/") || raw.startsWith("/assets/")) {
    return "";
  }
  const seg = raw.replace(/^\//, "");
  if (!seg || seg.includes("/")) return "";
  if (!looksLikeGroupPath(seg)) return "";
  return seg;
}
