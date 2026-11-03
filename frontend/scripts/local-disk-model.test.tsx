import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { localsys } from "../src/api";
import { formatLocalDiskInfo } from "../src/react/components/local/disk-utils";
mock.module("../src/react/components/host-tool-tabs", () => ({ useIsHostWorkspace: () => true }));
mock.module("../src/react/state/session", () => ({ useSession: () => ({}) }));
const { LocalPhysicalDiskRows } = await import("../src/react/components/local/physical-disk-rows");

const disk: localsys.DiskInfo = {
  kind: "disk", device: "disk0", filesystem: "disk0", mount: "", fsType: "apfs",
  name: "工作资料", parent: "disk0", external: false, model: "APPLE SSD AP0512Z",
  total: 500 * 1024 ** 3, used: 500 * 1024 ** 3, free: 0, avail: 0, percent: 100,
};

test("复制系统报告型号和磁盘信息，不把卷名当型号，不添加推测的硬件属性", () => {
  const text = formatLocalDiskInfo(disk);
  expect(text).toContain("型号：APPLE SSD AP0512Z\n设备：disk0");
  expect(text).toContain("已挂载容量：500 GB");
  expect(text).toContain("文件系统：apfs");
  expect(text).not.toContain("工作资料");
  expect(text).not.toMatch(/SMR|CMR|DRAM|序列号/);
});

test("缺少型号与读取失败分开展示，原有容量和复制入口可用", () => {
  const unknown = { ...disk, model: "" };
  const html = renderToStaticMarkup(createElement(LocalPhysicalDiskRows, { disks: [unknown] }));
  expect(html).toContain("系统未提供型号");
  expect(html).toContain("可用 0 B");
  expect(html).toContain('aria-label="复制硬盘信息（disk0）"');
  const failed = { ...unknown, modelError: "没有读取权限" };
  const failedHTML = renderToStaticMarkup(createElement(LocalPhysicalDiskRows, { disks: [failed] }));
  expect(failedHTML).toContain("读取失败");
  expect(failedHTML).toContain('title="没有读取权限"');
  expect(formatLocalDiskInfo(failed)).toContain("型号：读取失败");
});

test("只给物理设备显示型号，长型号保持完整复制", () => {
  const model = "External USB Bridge NVMe " + "MODEL-".repeat(30);
  const physical = { ...disk, model };
  const html = renderToStaticMarkup(createElement(LocalPhysicalDiskRows, { disks: [physical, { ...disk, kind: "mount", device: "disk3" }] }));
  expect(html.match(/<button\b/g)?.length).toBe(1);
  expect(html).not.toContain("disk3");
  expect(formatLocalDiskInfo(physical)).toContain(model);
});
