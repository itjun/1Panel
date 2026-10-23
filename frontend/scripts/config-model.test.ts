import { describe, expect, test } from "bun:test";
import {
  CONFIG_SECTIONS,
  configSectionFromLegacySettings,
  normalizeConfigSection,
} from "../src/react/lib/config-model";

describe("config module navigation", () => {
  test("keeps the three standalone destinations in sidebar order", () => {
    expect(CONFIG_SECTIONS.map((item) => item.id)).toEqual(["backups", "json", "ssh"]);
    expect(CONFIG_SECTIONS.map((item) => item.label)).toEqual(["备份恢复", "应用 JSON", "SSH 配置"]);
  });

  test("migrates the former settings pages into the config workspace", () => {
    expect(configSectionFromLegacySettings("backups")).toBe("backups");
    expect(configSectionFromLegacySettings("config")).toBe("json");
    expect(configSectionFromLegacySettings("look")).toBeNull();
  });

  test("normalizes persisted configuration routes", () => {
    expect(normalizeConfigSection("backups")).toBe("backups");
    expect(normalizeConfigSection("overview")).toBe("backups");
    expect(normalizeConfigSection("json")).toBe("json");
    expect(normalizeConfigSection("files")).toBe("ssh");
    expect(normalizeConfigSection("diff")).toBe("ssh");
    expect(normalizeConfigSection("unexpected")).toBe("backups");
  });
});
