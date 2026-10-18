import { api } from "@/api";

/** Browser previews have separate storage and must never consume a desktop restore. */
export function hasDesktopBridge(): boolean {
  const native = window as Window & {
    webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
    chrome?: { webview?: { postMessage?: unknown } };
    wails?: { invoke?: unknown };
  };
  return typeof native.webkit?.messageHandlers?.external?.postMessage === "function"
    || typeof native.chrome?.webview?.postMessage === "function"
    || typeof native.wails?.invoke === "function";
}

export function isApplicationPreference(key: string): boolean {
  return /^(1pannel|ipannel)[.-]/.test(key);
}

export function applicationPreferences(): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isApplicationPreference(key)) result[key] = localStorage.getItem(key) ?? "";
  }
  return result;
}

/** Runs before importing App, whose settings are initialized at module load. */
export async function restoreApplicationPreferences(): Promise<void> {
  const restored = await api.restoredApplicationPreferences();
  if (!restored) return;
  const values = restored.values;
  if (!values || Object.entries(values).some(([key, value]) => !isApplicationPreference(key) || typeof value !== "string")) {
    throw new Error("恢复的应用偏好无效");
  }
  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") validated[key] = value;
  }
  const previous = applicationPreferences();
  const replace = (next: Record<string, string>) => {
    for (const key of Object.keys(applicationPreferences())) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(next)) localStorage.setItem(key, value);
  };
  try {
    replace(validated);
    await api.acknowledgeApplicationPreferences(restored.id);
  } catch (error) {
    replace(previous);
    throw error;
  }
}
