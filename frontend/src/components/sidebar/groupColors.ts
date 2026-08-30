import { UNGROUPED_ID } from "@/stores/app";

/**
 * 分组色板：1Panel 蓝阶梯（accent=色条/圆点，soft=浅底，ink=文字/图标）
 */
const GROUP_PALETTE = [
  { accent: "#005eeb", soft: "rgba(0, 94, 235, 0.12)", ink: "#005eeb" },
  { accent: "#196eed", soft: "rgba(25, 110, 237, 0.12)", ink: "#196eed" },
  { accent: "#337eef", soft: "rgba(51, 126, 239, 0.12)", ink: "#337eef" },
  { accent: "#4c8ef1", soft: "rgba(76, 142, 241, 0.12)", ink: "#4c8ef1" },
  { accent: "#669ef3", soft: "rgba(102, 158, 243, 0.12)", ink: "#669ef3" },
  { accent: "#505f79", soft: "rgba(80, 95, 121, 0.12)", ink: "#505f79" },
  { accent: "#0077cc", soft: "rgba(0, 119, 204, 0.12)", ink: "#0077cc" },
  { accent: "#0066b3", soft: "rgba(0, 102, 179, 0.12)", ink: "#0066b3" },
  { accent: "#004494", soft: "rgba(0, 68, 148, 0.12)", ink: "#004494" },
  { accent: "#7faef5", soft: "rgba(127, 174, 245, 0.12)", ink: "#669ef3" },
] as const;

const UNGROUPED_COLOR = {
  accent: "#909399",
  soft: "rgba(144, 147, 153, 0.12)",
  ink: "#646a73",
} as const;

export type GroupColor = {
  accent: string;
  soft: string;
  ink: string;
};

export function groupColor(groupId: string, index: number): GroupColor {
  if (groupId === UNGROUPED_ID) return UNGROUPED_COLOR;
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}
