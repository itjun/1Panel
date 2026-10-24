import type { main } from "@/api";

export const HOST_CARD_POLL_MS = 5000;
export const HOST_CARD_DETAILS_MS = 30000;
export const HOST_CARD_STALE_MS = 15000;
export const HOST_CARD_DETAILS_STALE_MS = 90000;

export type HostCardEntry = {
  snapshot?: main.HostCardSnapshot;
  error?: string;
  updatedAt: number;
  detailsAt: number;
};

export type HostCardStore = { entries: Record<string, HostCardEntry>; now: number };
type LoadSnapshot = (host: string, isDetailsIncluded: boolean) => Promise<main.HostCardSnapshot>;

/** 一页一个调度器；置顶重复项共享结果，在途请求跨暂停保留，避免恢复时重叠。 */
export class HostCardPoller {
  private names: string[] = [];
  private listeners = new Set<() => void>();
  private inFlight = new Set<string>();
  private attemptedAt = new Map<string, number>();
  private detailAttemptedAt = new Map<string, number>();
  private store: HostCardStore;
  private isActive = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private load: LoadSnapshot, private clock = Date.now) {
    this.store = { entries: {}, now: clock() };
  }

  getSnapshot = () => this.store;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  setHosts(names: string[]) {
    this.names = [...new Set(names)];
    const current = new Set(this.names);
    this.attemptedAt.forEach((_, name) => {
      if (!current.has(name)) {
        this.attemptedAt.delete(name);
        this.detailAttemptedAt.delete(name);
      }
    });
    this.publish(Object.fromEntries(Object.entries(this.store.entries).filter(([name]) => current.has(name))));
    this.tick();
  }

  setActive(isActive: boolean) {
    this.isActive = isActive;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (isActive) {
      this.tick();
      this.timer = setInterval(() => this.tick(), 1000);
    }
  }

  private publish(entries = this.store.entries) {
    this.store = { entries, now: this.clock() };
    this.listeners.forEach(listener => listener());
  }

  // 按最久未尝试的主机优先，慢机或大量失败不会饿死队尾。
  tick() {
    if (!this.isActive) return;
    this.publish();
    const now = this.clock();
    const due = this.names.filter(name => !this.inFlight.has(name) &&
      (!this.attemptedAt.has(name) || now - this.attemptedAt.get(name)! >= HOST_CARD_POLL_MS))
      .sort((a, b) => (this.attemptedAt.get(a) ?? -Infinity) - (this.attemptedAt.get(b) ?? -Infinity));
    for (const name of due) {
      if (this.inFlight.size >= 5) break;
      const isDetailsIncluded = !this.detailAttemptedAt.has(name) ||
        now - this.detailAttemptedAt.get(name)! >= HOST_CARD_DETAILS_MS;
      this.attemptedAt.set(name, now);
      if (isDetailsIncluded) this.detailAttemptedAt.set(name, now);
      this.inFlight.add(name);
      void this.load(name, isDetailsIncluded).then(snapshot => {
        if (!this.names.includes(name)) return;
        const previous = this.store.entries[name];
        const merged = snapshot.detailsIncluded ? snapshot : {
          ...snapshot,
          agentVersion: snapshot.agentState === "running" ? previous?.snapshot?.agentVersion || "" : "",
          disks: previous?.snapshot?.disks ?? null,
          diskError: previous?.snapshot?.diskError || "",
        };
        this.publish({ ...this.store.entries, [name]: {
          snapshot: merged,
          updatedAt: this.clock(),
          detailsAt: snapshot.detailsIncluded ? this.clock() : previous?.detailsAt ?? 0,
        } });
      }).catch((error: unknown) => {
        if (!this.names.includes(name)) return;
        const previous = this.store.entries[name];
        this.publish({ ...this.store.entries, [name]: {
          ...previous,
          updatedAt: this.clock(),
          detailsAt: previous?.detailsAt ?? 0,
          error: error instanceof Error ? error.message : String(error),
        } });
      }).finally(() => {
        this.inFlight.delete(name);
        // 从完成时开始计间隔；慢请求结束后不立刻对同一主机再试。
        if (this.names.includes(name)) this.attemptedAt.set(name, this.clock());
        this.tick();
      });
    }
  }
}
