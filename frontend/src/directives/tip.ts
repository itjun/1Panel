/**
 * 即时悬停提示：替代原生 title（系统延迟约 1s+）。
 * 用法：
 * - v-tip="'文案'" / v-tip="expr"；空值不显示
 * - 动态 HTML 可用 data-tip="文案"（事件委托，秒开）
 */
import type { Directive, DirectiveBinding } from "vue";

type TipEl = HTMLElement & {
  __tipEnter?: (e: PointerEvent) => void;
  __tipLeave?: () => void;
  __tipDown?: () => void;
};

let tipNode: HTMLDivElement | null = null;
let activeEl: HTMLElement | null = null;
let delegated = false;

function ensureTipNode(): HTMLDivElement {
  if (tipNode && tipNode.isConnected) return tipNode;
  tipNode = document.createElement("div");
  tipNode.className = "app-fast-tip";
  tipNode.setAttribute("role", "tooltip");
  document.body.appendChild(tipNode);
  return tipNode;
}

function hideTip() {
  activeEl = null;
  if (!tipNode) return;
  tipNode.classList.remove("is-visible");
  tipNode.textContent = "";
}

function placeTip(anchor: HTMLElement, text: string) {
  const tip = ensureTipNode();
  tip.textContent = text;
  tip.classList.add("is-visible");

  const pad = 8;
  const gap = 6;
  const ar = anchor.getBoundingClientRect();
  tip.style.left = "0px";
  tip.style.top = "0px";
  const tr = tip.getBoundingClientRect();
  let left = ar.left + (ar.width - tr.width) / 2;
  let top = ar.bottom + gap;
  if (top + tr.height > window.innerHeight - pad) {
    top = ar.top - tr.height - gap;
  }
  if (left < pad) left = pad;
  if (left + tr.width > window.innerWidth - pad) {
    left = window.innerWidth - tr.width - pad;
  }
  if (top < pad) top = pad;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function tipText(binding: DirectiveBinding<unknown>): string {
  const v = binding.value;
  if (v == null || v === false) return "";
  return String(v).trim();
}

function bindTip(el: TipEl, binding: DirectiveBinding<unknown>) {
  unbindTip(el);
  el.__tipEnter = () => {
    const text = tipText(binding);
    if (!text) {
      hideTip();
      return;
    }
    activeEl = el;
    placeTip(el, text);
  };
  el.__tipLeave = () => {
    if (activeEl === el) hideTip();
  };
  el.__tipDown = () => {
    if (activeEl === el) hideTip();
  };
  el.addEventListener("pointerenter", el.__tipEnter);
  el.addEventListener("pointerleave", el.__tipLeave);
  el.addEventListener("pointerdown", el.__tipDown);
}

function unbindTip(el: TipEl) {
  if (el.__tipEnter) el.removeEventListener("pointerenter", el.__tipEnter);
  if (el.__tipLeave) el.removeEventListener("pointerleave", el.__tipLeave);
  if (el.__tipDown) el.removeEventListener("pointerdown", el.__tipDown);
  el.__tipEnter = undefined;
  el.__tipLeave = undefined;
  el.__tipDown = undefined;
  if (activeEl === el) hideTip();
}

/** 动态插入的 HTML（如 MessageBox）用 data-tip，走委托 */
function ensureDataTipDelegation() {
  if (delegated || typeof document === "undefined") return;
  delegated = true;

  document.addEventListener(
    "pointerover",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const el = t.closest("[data-tip]") as HTMLElement | null;
      if (!el) return;
      // 已由 v-tip 接管的节点不重复
      if ((el as TipEl).__tipEnter) return;
      const text = (el.getAttribute("data-tip") || "").trim();
      if (!text) return;
      if (activeEl === el) return;
      activeEl = el;
      placeTip(el, text);
    },
    true
  );

  document.addEventListener(
    "pointerout",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const el = t.closest("[data-tip]") as HTMLElement | null;
      if (!el || (el as TipEl).__tipEnter) return;
      const related = e.relatedTarget;
      if (related instanceof Node && el.contains(related)) return;
      if (activeEl === el) hideTip();
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const el = t.closest("[data-tip]") as HTMLElement | null;
      if (el && activeEl === el && !(el as TipEl).__tipEnter) hideTip();
    },
    true
  );
}

export const vTip: Directive<HTMLElement, unknown> = {
  mounted(el, binding) {
    ensureDataTipDelegation();
    bindTip(el as TipEl, binding);
  },
  updated(el, binding) {
    bindTip(el as TipEl, binding);
  },
  unmounted(el) {
    unbindTip(el as TipEl);
  },
};

/** 给 h() / vnode 用：有文案才带 data-tip，空则不输出 */
export function tipAttrs(text: unknown): { "data-tip"?: string } {
  if (text == null || text === false) return {};
  const s = String(text).trim();
  if (!s) return {};
  return { "data-tip": s };
}

/** 应用启动时调用，保证动态 HTML 的 data-tip 也能秒开 */
export function installFastTipDelegation() {
  ensureDataTipDelegation();
}
