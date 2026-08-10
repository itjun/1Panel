export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDurationLong(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0 || d > 0) parts.push(`${h}小时`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}分钟`);
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
