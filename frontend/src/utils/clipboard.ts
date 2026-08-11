/**
 * 可靠复制文本到剪贴板（优先 Wails 原生 API，兼容浏览器）
 */
import { ClipboardSetText } from "@wailsjs/runtime/runtime";

export async function copyText(text: string): Promise<void> {
  const t = text ?? "";
  if (!t) {
    throw new Error("内容为空");
  }

  // 1) Wails 桌面运行时
  try {
    if (typeof window !== "undefined" && (window as any).runtime?.ClipboardSetText) {
      const ok = await ClipboardSetText(t);
      if (ok !== false) return;
    }
  } catch {
    /* fall through */
  }

  // 2) 标准 Clipboard API
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return;
    }
  } catch {
    /* fall through */
  }

  // 3) 旧式 execCommand 兜底
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, t.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("复制失败");
}
