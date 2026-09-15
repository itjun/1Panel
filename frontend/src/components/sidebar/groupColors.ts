import { UNGROUPED_ID } from "@/stores/app";

/**
 * 分组区分色（顶层一轮换）：accent=竖条/色点/文件夹，soft=浅底/选中，ink=文字。
 * 「明快柔色」：饱和度够认、避开红橙黄与品牌蓝 #005eeb。
 */

export type GroupColor = {
  accent: string;
  soft: string;
  ink: string;
};

function c(accent: string, softAlpha: number, ink: string): GroupColor {
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  return {
    accent,
    soft: `rgba(${r}, ${g}, ${b}, ${softAlpha})`,
    ink,
  };
}

const GROUP_PALETTE: readonly GroupColor[] = [
  c("#14b8a6", 0.18, "#0f766e"), // aqua
  c("#8b5cf6", 0.16, "#7c3aed"), // violet
  c("#10b981", 0.16, "#059669"), // green
  c("#06b6d4", 0.16, "#0891b2"), // cyan
  c("#c026d3", 0.14, "#a21caf"), // fuchsia
  c("#0ea5e9", 0.14, "#0284c7"), // sky
  c("#22c55e", 0.16, "#16a34a"), // lime-green
  c("#818cf8", 0.16, "#6366f1"), // periwinkle
];

const UNGROUPED_COLOR: GroupColor = {
  accent: "#8a9099",
  soft: "rgba(138, 144, 153, 0.14)",
  ink: "#646a73",
};

/** 按顶层序号取区分色；未分组用中性灰 */
export function groupColor(groupId: string, rootIndex: number): GroupColor {
  if (groupId === UNGROUPED_ID || rootIndex < 0) return UNGROUPED_COLOR;
  return GROUP_PALETTE[rootIndex % GROUP_PALETTE.length];
}
