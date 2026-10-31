import { beforeEach, expect, mock, test } from "bun:test";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
};
Object.assign(globalThis, {
  document: {
    documentElement: {
      dataset: {},
      style: { setProperty: () => {}, removeProperty: () => {}, background: "" },
      classList: { add: () => {}, remove: () => {}, contains: () => false },
    },
    body: { style: { fontFamily: "", fontSize: "" } },
  },
  window: {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  },
  localStorage: storage,
});

let disk: {
  fromDisk: boolean;
  notifyEnabled: boolean;
  wecomWebhook: string;
  systemNotifyEnabled: boolean;
  inAppNotifyEnabled: boolean;
  alertContentKinds: string[];
  notifyRecoverEnabled: boolean;
  alertLevels: Record<string, string[]>;
  alertSustain: number;
  alertRepeatMinutes: number;
  alertLoadWindow: string;
  notifyContentFields: string[];
  hostResourceNotifySubs: Record<string, string[]>;
  hostAppNotifySubs: Record<string, string[]>;
  certKindMigrated: boolean;
} = {
  fromDisk: false,
  notifyEnabled: false,
  wecomWebhook: "",
  systemNotifyEnabled: true,
  inAppNotifyEnabled: true,
  alertContentKinds: ["cpu"],
  notifyRecoverEnabled: true,
  alertLevels: { cpu: ["danger"] },
  alertSustain: 1,
  alertRepeatMinutes: 0,
  alertLoadWindow: "load1",
  notifyContentFields: ["hostName"],
  hostResourceNotifySubs: {},
  hostAppNotifySubs: {},
  certKindMigrated: true,
};
const writes: unknown[] = [];

mock.module("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
mock.module("@/api", () => ({
  api: {
    setThemeAppearance: async () => {},
    getNotifySubs: async () => ({ ...disk }),
    setNotifySubs: async (payload: unknown) => {
      writes.push(payload);
    },
  },
}));

const settings = await import("../src/react/state/settings");

beforeEach(() => {
  values.clear();
  writes.length = 0;
  disk = {
    fromDisk: false,
    notifyEnabled: false,
    wecomWebhook: "",
    systemNotifyEnabled: true,
    inAppNotifyEnabled: true,
    alertContentKinds: ["cpu"],
    notifyRecoverEnabled: true,
    alertLevels: { cpu: ["danger"] },
    alertSustain: 1,
    alertRepeatMinutes: 0,
    alertLoadWindow: "load1",
    notifyContentFields: ["hostName"],
    hostResourceNotifySubs: {},
    hostAppNotifySubs: {},
    certKindMigrated: true,
  };
  settings.updateSettings({
    notifyEnabled: false,
    wecomWebhook: "",
  });
  writes.length = 0;
});

test("fromDisk 回灌企微地址到 settings 与 localStorage，不回写磁盘", async () => {
  disk = {
    ...disk,
    fromDisk: true,
    notifyEnabled: true,
    wecomWebhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=restored",
    hostResourceNotifySubs: { "web-01": ["cpu"] },
  };
  await settings.hydrateNotifySettings();
  expect(settings.readSettings().notifyEnabled).toBe(true);
  expect(settings.readSettings().wecomWebhook).toContain("key=restored");
  expect(settings.readSettings().hostResourceNotifySubs["web-01"]).toEqual(["cpu"]);
  expect(JSON.parse(values.get("ipannel.settings.v1")!).wecomWebhook).toContain(
    "key=restored",
  );
  expect(writes).toHaveLength(0);
});

test("尚未落盘时把 localStorage 通知字段迁到磁盘", async () => {
  settings.updateSettings({
    notifyEnabled: true,
    wecomWebhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=local",
  });
  writes.length = 0;
  disk = { ...disk, fromDisk: false };
  await settings.hydrateNotifySettings();
  expect(writes).toHaveLength(1);
  const payload = writes[0] as { wecomWebhook: string; notifyEnabled: boolean };
  expect(payload.notifyEnabled).toBe(true);
  expect(payload.wecomWebhook).toContain("key=local");
});
