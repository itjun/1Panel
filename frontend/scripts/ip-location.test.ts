import { expect, test } from "bun:test";
import { formatIpLocation } from "../src/utils/ip-location";

test.each([
  ["中国 天津 天津  联通", "天津 联通"],
  ["中国 浙江 杭州 电信", "杭州 电信"],
  ["中国 北京 北京", "北京"],
  ["日本 东京都 东京  Amazon", "东京 Amazon"],
  ["  中国\t广东  深圳   电信  ", "深圳 电信"],
  ["美国 加利福尼亚 洛杉矶  Example Networks LLC", "洛杉矶 Example Networks LLC"],
  ["中国 天津 天津 未知", "天津"],
  ["中国 天津 未知 联通", "联通"],
  ["美国", ""],
  ["中国 浙江", ""],
  ["中国 浙江 未知", ""],
  ["", ""],
  [undefined, ""],
])("从归属地 %s 显示城市和运营商", (location, expected) => {
  expect(formatIpLocation(location)).toBe(expected);
});
