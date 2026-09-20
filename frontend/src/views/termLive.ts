import { ref } from "vue";

/**
 * SSH / xterm 的所有权。窗格树只引用 id。
 * 拖进分屏或移出独立会话时，改 owner，不调用 CloseTerminal / OpenTerminal。
 */
export interface LiveState {
  id: string;
  host: string;
  ownerDesk: string;
  sessionID: string;
  closed: boolean;
  reconnecting: boolean;
}

export interface PaneHandoff {
  id: string;
  host: string;
  session: object;
  ctl: object | null;
}

const bodies = new Map<string, object>();
const states = new Map<string, LiveState>();

export const liveEpoch = ref(0);

type DeskApi = {
  takeAll: () => PaneHandoff[];
};

const desks = new Map<string, DeskApi>();
const parked = new Map<string, PaneHandoff>();

let parkEl: HTMLDivElement | null = null;

export function parkTermEl(el: HTMLElement | null | undefined) {
  if (!el) return;
  const park = termDomPark();
  if (el.parentElement !== park) park.appendChild(el);
}

export function termDomPark(): HTMLDivElement {
  if (!parkEl) {
    parkEl = document.createElement("div");
    parkEl.setAttribute("data-term-park", "");
    parkEl.style.cssText =
      "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict;";
    document.body.appendChild(parkEl);
  }
  return parkEl;
}

export function rememberSession(id: string, body: object, state: LiveState) {
  bodies.set(id, body);
  states.set(id, state);
  liveEpoch.value += 1;
}

export function sessionBody(id: string): object | undefined {
  return bodies.get(id);
}

export function liveState(id: string): LiveState | undefined {
  return states.get(id);
}

export function patchLive(id: string, patch: Partial<LiveState>) {
  const prev = states.get(id);
  const body = bodies.get(id);
  if (body) Object.assign(body, patch);
  if (prev) states.set(id, { ...prev, ...patch });
  liveEpoch.value += 1;
}

export function sidOf(id: string): string {
  return states.get(id)?.sessionID || "";
}

export function forgetSession(id: string) {
  bodies.delete(id);
  states.delete(id);
  parked.delete(id);
  liveEpoch.value += 1;
}

export function registerTermDesk(id: string, api: DeskApi): () => void {
  desks.set(id, api);
  return () => {
    if (desks.get(id) === api) desks.delete(id);
  };
}

export function takeTermDesk(id: string): PaneHandoff[] {
  const api = desks.get(id);
  if (api) return api.takeAll();
  const out: PaneHandoff[] = [];
  for (const [pid, item] of [...parked.entries()]) {
    if (liveState(pid)?.ownerDesk !== id) continue;
    parked.delete(pid);
    out.push(item);
  }
  return out;
}

export function parkTermPane(item: PaneHandoff) {
  parked.set(item.id, item);
}

export function claimTermPane(id: string): PaneHandoff | null {
  const item = parked.get(id) || null;
  if (item) parked.delete(id);
  return item;
}
