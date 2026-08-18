import { UNGROUPED_ID } from "@/stores/app";

/**
 * 分组色板：统一在 1Panel 主色蓝附近的冷色阶梯
 * 相邻组可区分，但整体同一色系（无橙/红/高饱和撞色）
 * accent=色条/圆点，soft=浅底，ink=文字/图标
 */
const GROUP_PALETTE = [
  { accent: "#005eeb", soft: "rgba(0, 94, 235, 0.12)", ink: "#005eeb" }, // 主蓝
  { accent: "#3375f6", soft: "rgba(51, 117, 246, 0.12)", ink: "#2a62d4" }, // 亮蓝
  { accent: "#1a7fd4", soft: "rgba(26, 127, 212, 0.12)", ink: "#176bae" }, // 天蓝
  { accent: "#3d8bfd", soft: "rgba(61, 139, 253, 0.12)", ink: "#2f6fd4" }, // 浅蓝
  { accent: "#4c6ef5", soft: "rgba(76, 110, 245, 0.12)", ink: "#3b5bdb" }, // 靛蓝
  { accent: "#5c7cfa", soft: "rgba(92, 124, 250, 0.12)", ink: "#4c6ef5" }, // 柔靛
  { accent: "#228be6", soft: "rgba(34, 139, 230, 0.12)", ink: "#1c7ed6" }, // 青蓝
  { accent: "#15aabf", soft: "rgba(21, 170, 191, 0.12)", ink: "#1098ad" }, // 青蓝绿（仍冷色）
  { accent: "#4263eb", soft: "rgba(66, 99, 235, 0.12)", ink: "#364fc7" }, // 深紫蓝
  { accent: "#748ffc", soft: "rgba(116, 143, 252, 0.12)", ink: "#5c7cfa" }, // 淡蓝紫
] as const;

/** 未分组：同色系低饱和灰蓝，不抢戏 */
const UNGROUPED_COLOR = {
  accent: "#868e96",
  soft: "rgba(134, 142, 150, 0.12)",
  ink: "#495057",
} as const;

export type GroupColor = {
  accent: string;
  soft: string;
  ink: string;
};

/** 按列表下标取色（最直观、相邻必不同）；未分组固定灰 */
export function groupColor(groupId: string, index: number): GroupColor {
  if (groupId === UNGROUPED_ID) return UNGROUPED_COLOR;
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}
