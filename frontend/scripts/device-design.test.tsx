import { expect, test } from "bun:test";
const { appBundlePath } = await import("../src/react/components/local/app-icon");

test("进程 Helper 使用所属应用图标，非应用路径不请求图标", () => {
  expect(appBundlePath("/Applications/WeChat.app/Contents/MacOS/WeChat")).toBe("/Applications/WeChat.app");
  expect(appBundlePath("/Applications/Code.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper")).toBe("/Applications/Code.app");
  expect(appBundlePath("/opt/homebrew/bin/node")).toBe("");
  expect(appBundlePath("/tmp/not.appdata/run")).toBe("");
});
