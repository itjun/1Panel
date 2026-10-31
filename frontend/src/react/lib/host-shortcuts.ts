import type { AppOs } from "./platform";
import type { Tool } from "@/react/state/session";

export type HostChoice = {
  name: string;
  group: string;
  tool: Tool;
  isOpened: boolean;
};

export function hostShortcut(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">, os: AppOs) {
  if (event.isComposing || event.altKey) return null;
  if (event.code === "Tab" && event.ctrlKey && !event.metaKey) {
    return event.shiftKey ? "previous" : "next";
  }
  const isPrimary = os === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!isPrimary || event.shiftKey) return null;
  if (event.code === "KeyR") return "reload";
  if (event.code === "KeyO") return "open";
  return null;
}

export function filterHostChoices(items: HostChoice[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => words.every((word) => `${item.name} ${item.group}`.toLocaleLowerCase().includes(word)));
}

export function stepHostChoice(items: { name: string }[], selected: string, step: number) {
  if (!items.length) return "";
  const index = items.findIndex((item) => item.name === selected);
  if (index < 0) return items[step < 0 ? items.length - 1 : 0].name;
  return items[((index + step) % items.length + items.length) % items.length].name;
}
