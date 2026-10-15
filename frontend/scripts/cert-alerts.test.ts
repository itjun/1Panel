import { expect, test, mock } from "bun:test";

test("证书轮询默认覆盖所有主机，不依赖旧订阅配置", async () => {
  const scanned: string[] = [];
  let hosts = [{ name: "diteng-nginx" }, { name: "other" }];
  let now = 100_000;
  let interval: (() => void) | undefined;
  mock.module("@/api", () => ({ api: {
    listHosts: async () => hosts,
    collectCertCheck: async (host: string) => {
      scanned.push(host);
      return { scanned: false };
    },
  } }));
  mock.module("@/utils/settingsAccess", () => ({ settingsAccess: () => ({
    isCertNotifySubscribed: () => false,
    hostsWithCertNotifySubs: () => [],
    isContentKindEnabled: () => true,
  }) }));
  mock.module("@/utils/alertNotify", () => ({ appendAndNotifyDesktop: async () => {} }));
  const realWindow = globalThis.window;
  const dateNow = Date.now;
  globalThis.window = { setInterval: (fn: () => void) => { interval = fn; return 1; } } as never;
  Date.now = () => now;
  const { startCertAlertPoll, stopCertAlertPoll } = await import("../src/utils/certAlerts");
  try {
    startCertAlertPoll();
    await Bun.sleep(0);
    expect(scanned.sort()).toEqual(["diteng-nginx", "other"]);
    hosts = [...hosts, { name: "new-host" }];
    scanned.length = 0;
    now += 60_000;
    interval!();
    await Bun.sleep(0);
    expect(scanned.sort()).toEqual(["diteng-nginx", "new-host", "other"]);
  } finally {
    stopCertAlertPoll();
    globalThis.window = realWindow;
    Date.now = dateNow;
    mock.restore();
  }
});
