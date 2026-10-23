import type { ConfigSection } from "@/react/state/session";

export const CONFIG_SECTIONS: { id: ConfigSection; label: string }[] = [
  { id: "backups", label: "备份恢复" },
  { id: "json", label: "应用 JSON" },
  { id: "ssh", label: "SSH 配置" },
];

/** Keep old persisted routes usable while the module owns these destinations again. */
export function normalizeConfigSection(value: unknown): ConfigSection {
  if (value === "json") return "json";
  if (value === "ssh" || value === "files" || value === "diff") return "ssh";
  if (value === "backups" || value === "overview") return "backups";
  return "backups";
}

/** Settings used to host these two sections; migrate either route to the module. */
export function configSectionFromLegacySettings(value: unknown): ConfigSection | null {
  if (value === "backups") return "backups";
  if (value === "config") return "json";
  return null;
}
