/** 把 unknown 错误（string / Error / 带 message 对象）格式化为可展示文本 */
export function formatErr(e: unknown): string {
  if (e == null) return "未知错误";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  const any = e as { message?: string };
  if (any.message) return any.message;
  return String(e);
}

/** agent 未安装 / 不可达：只应探一次，不当成持续连接告警 */
export function isAgentMissing(err: unknown): boolean {
  const s = formatErr(err);
  return s.includes("agent 未安装") || s.includes("agent 不可达");
}

/** agent 已连通但还没有 raw_metrics，不是连接失败 */
export function isAgentNoSample(err: unknown): boolean {
  return formatErr(err).includes("尚无采样数据");
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
export type ByteUnit = (typeof BYTE_UNITS)[number];

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(Math.max(i, 0), BYTE_UNITS.length - 1);
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(decimals))} ${BYTE_UNITS[idx]}`;
}

/** 磁盘容量：十进制（1000）单位，与 macOS「储存空间」口径一致 */
export function formatBytesSI(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1000;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(Math.max(i, 0), BYTE_UNITS.length - 1);
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(decimals))} ${BYTE_UNITS[idx]}`;
}

/**
 * 按最大值挑一个统一字节单位，给折线 Y 轴用（整轴同一单位，避免刻度 1,800,000,000 B）。
 * 空数据 / 不足 1 KB 时用 B。
 */
export function pickByteScale(maxBytes: number): { unit: ByteUnit; divisor: number } {
  if (!Number.isFinite(maxBytes) || maxBytes < 1024) {
    return { unit: "B", divisor: 1 };
  }
  const k = 1024;
  let i = Math.floor(Math.log(maxBytes) / Math.log(k));
  if (i < 0) i = 0;
  if (i >= BYTE_UNITS.length) i = BYTE_UNITS.length - 1;
  return { unit: BYTE_UNITS[i], divisor: Math.pow(k, i) };
}

/** Y 轴刻度：把原始字节换成 pickByteScale 的单位，不带后缀（单位在轴名上） */
export function formatScaledBytes(bytes: number, divisor: number, decimals?: number): string {
  if (!Number.isFinite(bytes) || bytes === 0) return "0";
  const n = bytes / (divisor || 1);
  if (!Number.isFinite(n)) return "0";
  const d =
    decimals != null
      ? decimals
      : divisor <= 1
        ? 0
        : Math.abs(n) >= 100
          ? 0
          : 1;
  return parseFloat(n.toFixed(d)).toString();
}

/**
 * 内存装机标识容量：Linux MemTotal 常略小于铭牌（BIOS/设备预留）。
 * 按 1024 进制算 GiB 后，取「不小于实测、且偏差 ≤12%」的最小常见档位（如 31.3 → 32G）。
 */
export function formatMemCapacity(bytes: number): string {
  if (!bytes || bytes <= 0) return "0G";
  const gib = bytes / (1024 * 1024 * 1024);
  const common = [
    1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024,
  ];
  for (const c of common) {
    if (c + 1e-9 < gib) continue;
    if ((c - gib) / c <= 0.12) {
      return `${c}G`;
    }
  }
  // 已超过最大档或偏差过大：回退精确值
  return formatBytes(bytes);
}

/** 进程运行时长等短格式：12s / 5m / 2.1h / 1.5d */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

export function formatDurationLong(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const secPerDay = 86400;
  const secPerYear = 365 * secPerDay;
  const secPerMonth = 30 * secPerDay;

  let remain = Math.floor(seconds);
  const years = Math.floor(remain / secPerYear);
  remain = remain % secPerYear;

  let months = 0;
  if (years > 0) {
    months = Math.floor(remain / secPerMonth);
    remain = remain % secPerMonth;
  }

  const d = Math.floor(remain / secPerDay);
  const h = Math.floor((remain % secPerDay) / 3600);
  const m = Math.floor((remain % 3600) / 60);
  const s = Math.floor(remain % 60);

  const parts: string[] = [];
  if (years > 0) {
    parts.push(`${years}年`);
    parts.push(`${months}月`);
    parts.push(`${d}天`);
  } else if (d > 0) {
    parts.push(`${d}天`);
  }
  if (h > 0 || d > 0 || years > 0) parts.push(`${h}小时`);
  if (m > 0 || h > 0 || d > 0 || years > 0) parts.push(`${m}分钟`);
  parts.push(`${s}秒`);
  return parts.join(" ");
}

export function bytesToKBps(deltaBytes: number, deltaMs: number): number {
  if (deltaMs <= 0 || deltaBytes < 0) return 0;
  return deltaBytes / 1024 / (deltaMs / 1000);
}

export function formatRateKBps(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(2)} MB/s`;
  if (kbps >= 1) return `${kbps.toFixed(2)} KB/s`;
  return `${(kbps * 1024).toFixed(0)} B/s`;
}

/**
 * 将 ls/stat 风格权限串（如 drwxr-xr-x / -rw-r--r--）转为 1Panel 风格八进制（0755 / 0644）。
 * 非法输入返回空串。
 */
export function modeToOctal(mode: string): string {
  if (!mode || typeof mode !== "string") return "";
  // 取后 9 位 rwx 段（跳过类型位 d/-/l 等）
  const m = mode.trim();
  let perms = m;
  if (m.length === 10) perms = m.slice(1);
  else if (m.length === 9 && !/^[dlcbps-]/.test(m)) perms = m;
  else if (m.length >= 10) perms = m.slice(-9);
  if (!/^[rwx-]{9}$/.test(perms)) return m; // 已是其它格式则原样返回

  const bit = (ch: string, flag: string) => (ch === flag ? 1 : 0);
  const trip = (i: number) =>
    bit(perms[i], "r") * 4 + bit(perms[i + 1], "w") * 2 + bit(perms[i + 2], "x");
  const oct = trip(0) * 64 + trip(3) * 8 + trip(6);
  return oct.toString(8).padStart(4, "0");
}

/** 面包屑路径段：/ → ['/']；/a/b → ['/', 'a', 'b'] */
export function breadcrumbParts(cwd: string): string[] {
  if (!cwd || cwd === "/") return ["/"];
  return ["/", ...cwd.split("/").filter(Boolean)];
}

/** 由面包屑索引拼绝对路径 */
export function breadcrumbPath(parts: string[], index: number): string {
  if (index <= 0) return "/";
  const segs = parts.slice(1, index + 1);
  return "/" + segs.join("/");
}

/** 父目录路径 */
export function parentDir(cwd: string): string {
  if (!cwd || cwd === "/") return "/";
  const cleaned = cwd.replace(/\/+$/, "");
  const i = cleaned.lastIndexOf("/");
  if (i <= 0) return "/";
  return cleaned.slice(0, i) || "/";
}

/**
 * 检测文本换行符风格。
 * 返回：LF | CRLF | CR | Mixed | —（空内容）
 */
export function detectLineEnding(text: string): string {
  if (!text) return "—";
  const crlf = (text.match(/\r\n/g) || []).length;
  // 去掉 CRLF 后再数孤立 CR / LF，避免重复计算
  const stripped = text.replace(/\r\n/g, "");
  const cr = (stripped.match(/\r/g) || []).length;
  const lf = (stripped.match(/\n/g) || []).length;
  const kinds = [
    crlf > 0 ? "CRLF" : "",
    lf > 0 ? "LF" : "",
    cr > 0 ? "CR" : "",
  ].filter(Boolean);
  if (kinds.length === 0) return "—";
  if (kinds.length > 1) return "Mixed";
  return kinds[0];
}

/**
 * 从文本内容推断编码标签（Wails/SSH 读入多为 UTF-8 解码后的字符串）。
 * 有 BOM 时标注具体 BOM；含替换符则提示可能非 UTF-8。
 */
export function detectTextEncoding(text: string): string {
  if (text == null || text === "") return "UTF-8";
  if (text.charCodeAt(0) === 0xfeff) return "UTF-8 BOM";
  // U+FFFD 替换字符：上游按 UTF-8 解失败时常见
  if (text.includes("\uFFFD")) return "UTF-8?";
  return "UTF-8";
}

/** 按行拆分，保留空行；兼容 CRLF / LF / CR */
export function splitTextLines(text: string): string[] {
  if (text == null || text === "") return [""];
  // 统一切分，不丢最后一行空串语义：split 后若以换行结尾会多一个空串
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
