import { beforeEach, expect, mock, test } from "bun:test";

let values = new Map<string, string>();
let pending: { id: string; values: Record<string, string> } | null = null;
let acknowledged = "";
let ackFails = false;
const storage = {
  get length() { return values.size; },
  key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
mock.module("@/api", () => ({ api: {
  restoredApplicationPreferences: async () => pending,
  acknowledgeApplicationPreferences: async (id: string) => {
    if (ackFails) throw new Error("acknowledgement failed");
    acknowledged = id;
  },
} }));
const { applicationPreferences, restoreApplicationPreferences } = await import("../src/react/lib/application-data");

beforeEach(() => { values = new Map(); pending = null; acknowledged = ""; ackFails = false; });

test("captures settings, layouts and histories using both historical namespaces", () => {
  values.set("ipannel.settings.v1", '{"appearance":"dark","wecomWebhook":"saved"}');
  values.set("1pannel-react-nav", '{"pinned":["web"]}');
  values.set("1pannel-sidebar-width", "300");
  values.set("ipannel.speedtest.params.v1", '{"seconds":10}');
  values.set("unrelated", "keep");
  expect(Object.keys(applicationPreferences())).toHaveLength(4);
  expect(applicationPreferences()["ipannel.settings.v1"]).toContain("saved");
});

test("restores a complete preference snapshot and removes newer application preferences", async () => {
  values.set("ipannel.settings.v1", '{"appearance":"light"}');
  values.set("1pannel-newer-setting", "remove");
  values.set("unrelated", "keep");
  pending = { id: "restore-1", values: { "ipannel.settings.v1": '{"appearance":"dark"}', "1pannel-sidebar-width": "280" } };
  await restoreApplicationPreferences();
  expect(values.get("ipannel.settings.v1")).toContain("dark");
  expect(values.has("1pannel-newer-setting")).toBe(false);
  expect(values.get("unrelated")).toBe("keep");
  expect(acknowledged).toBe("restore-1");
});

test("rolls back local preferences when restore acknowledgement fails", async () => {
  values.set("ipannel.settings.v1", '{"appearance":"light"}');
  values.set("1pannel-react-nav", '{"pinned":["current"]}');
  pending = { id: "restore-2", values: { "ipannel.settings.v1": '{"appearance":"dark"}' } };
  ackFails = true;
  await expect(restoreApplicationPreferences()).rejects.toThrow("acknowledgement failed");
  expect(values.get("ipannel.settings.v1")).toContain("light");
  expect(values.get("1pannel-react-nav")).toContain("current");
  expect(acknowledged).toBe("");
});
