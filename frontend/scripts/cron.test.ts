import { describe, expect, test } from "bun:test";
import { describeCron, parseCronLine } from "../src/utils/cron";

describe("remote cron descriptions", () => {
  test.each([
    ["0 3 * * *", "每天 03:00 执行"],
    ["*/15 * * * *", "每隔 15 分钟执行"],
    ["* * * * *", "每分钟执行"],
    ["*/1 * * * *", "每分钟执行"],
    ["17 * * * *", "每小时第 17 分钟执行"],
    ["25 6 * * *", "每天 06:25 执行"],
    ["47 6 * * 7", "每周日 06:47 执行"],
    ["52 6 1 * *", "每月 1 日 06:52 执行"],
    ["30 3 * * 0", "每周日 03:30 执行"],
    ["10 3 * * *", "每天 03:10 执行"],
    ["24 0 1-7 * *", "每月 1–7 日，每天 00:24 执行"],
    ["24 0 8-14 * *", "每月 8–14 日，每天 00:24 执行"],
    ["  0\t3  * * * ", "每天 03:00 执行"],
    ["0 3 * * sun", "每周日 03:00 执行"],
    ["@daily", "每天 00:00 执行"],
    ["@midnight", "每天 00:00 执行"],
    ["@hourly", "每小时第 0 分钟执行"],
    ["@weekly", "每周日 00:00 执行"],
    ["@monthly", "每月 1 日 00:00 执行"],
    ["@reboot", "系统启动后执行一次"],
    ["", "—"],
  ])("%s → %s", (expression, expected) => {
    expect(describeCron(expression)).toBe(expected);
  });

  test("ranges, lists and named months remain readable", () => {
    expect(describeCron("0 9,18 * * MON-FRI")).toContain("09:00 和 18:00");
    expect(describeCron("0 9,18 * * MON-FRI")).toContain("星期一至星期五");
    expect(describeCron("0 3 1 JAN *")).toContain("一月");
    expect(describeCron("@yearly")).toBe(describeCron("@annually"));
  });

  test("Linux cron uses OR for restricted date and weekday fields", () => {
    expect(describeCron("0 3 1 * MON")).toContain("或者为星期一");
    expect(describeCron("0 3 */2 * MON")).not.toContain("或者");
  });

  test("uneven steps restart within the hour or day", () => {
    const minutes = describeCron("*/40 * * * *");
    expect(minutes).toContain("第 0 和 40 分钟");
    expect(minutes).not.toContain("每隔 40 分钟");
    const hours = describeCron("0 */5 * * *");
    expect(hours).toContain("00:00，05:00，10:00，15:00 和 20:00");
    expect(hours).not.toContain("每隔 5 小时");
  });

  test.each([
    "61 3 * * *", "0 24 * * *", "0 3 0 * *", "0 3 * 13 *", "0 3 * * 8",
    "*/0 * * * *", "0 9-3 * * *", "0 3 * FOO *", "0 3 * * 1,",
    "0 0 3 * * *", "0 3 ? * MON", "0 3 L * *", "@unknown", "broken",
  ])("unsupported %s has a safe fallback", (expression) => {
    expect(describeCron(expression)).toBe("暂无法解析，请查看原始计划");
  });
});

describe("cron line parsing", () => {
  test("system username and command preserve quoted spaces", () => {
    const row = parseCronLine({
      line: '  0 3 * * * root printf "two  spaces" >> /tmp/cron.log',
      source: "etc-crontab", user: "root",
    });
    expect(row.schedule).toBe("0 3 * * *");
    expect(row.user).toBe("root");
    expect(row.cmd).toBe('printf "two  spaces" >> /tmp/cron.log');
  });

  test.each(["user", "etc-crontab", "etc-cron.d"])("@reboot in %s", (source) => {
    const row = parseCronLine({
      line: source === "user" ? "@reboot /usr/bin/job --start" : "@reboot root /usr/bin/job --start",
      source, user: "",
    });
    expect(row.schedule).toBe("@reboot");
    expect(row.description).toBe("系统启动后执行一次");
    expect(row.cmd).toBe("/usr/bin/job --start");
    expect(row.user).toBe(source === "user" ? "" : "root");
  });

  test("user crontab has no extra username field", () => {
    expect(parseCronLine({ line: "*/15 * * * * /usr/bin/job --run", source: "user", user: "" }).cmd)
      .toBe("/usr/bin/job --run");
  });
});
