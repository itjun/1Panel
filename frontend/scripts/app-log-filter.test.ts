import { describe, expect, test } from "bun:test";
import { filterAppLogRecords, parseAppLogRecords } from "../src/utils/appLogFilter";
import { logHighlightHtml } from "../src/utils/logHighlight";

describe("application log level filters", () => {
  test.each([
    ["[2026-10-16 10:24:56] 5497 [main] INFO org.example.App:71 - started", "INFO"],
    ["2026-10-16T10:24:56.123+08:00 ERROR 5497 --- [app] [main] org.example.App : failed", "ERROR"],
    ["10:24:56,123 [main] WARN org.example.App - retry", "WARN"],
    ["[DEBUG] query executed", "DEBUG"],
    ["trace: details", "TRACE"],
    ["FATAL cannot start", "FATAL"],
    ["WARNING retry", "WARN"],
    ["\x1b[31mERROR\x1b[0m failed", "ERROR"],
    ['{"level":"error","message":"failed"}', "ERROR"],
    ['{"log.level":"WARN","message":"retry"}', "WARN"],
    ["2026-10-16 10:24:56 App:71 - counts ERROR 0", "OTHER"],
    ["[2026-10-16 10:24:56] [ERROR-worker] INFO App - ERROR count 0", "INFO"],
    ["message mentions ERROR only", "OTHER"],
  ])("detects the header in %s", (line, expected) => {
    expect(parseAppLogRecords(line)[0].level).toBe(expected);
  });

  const info = "2026-10-16 10:24:56 INFO App - ERROR count 0";
  const error = "2026-10-16 10:24:57 ERROR App - request failed\njava.lang.RuntimeException: broken\n\tat App.main(App.java:12)\nCaused by: java.io.IOException: connection reset\n\t... 3 more";
  const warn = "2026-10-16 10:24:58 WARN App - retry";
  const other = "2026-10-16 10:24:59 App - plain console output";
  const raw = [info, error, warn, other].join("\n") + "\n";

  test("filters exact levels, combines selections, and restores the original text", () => {
    const records = parseAppLogRecords(raw);
    expect(filterAppLogRecords(records, ["ERROR"], "")).toBe(error);
    expect(filterAppLogRecords(records, ["ERROR", "WARN"], "")).toBe(`${error}\n${warn}`);
    expect(filterAppLogRecords(records, [], "")).toBe(raw);
    expect(filterAppLogRecords(records, ["OTHER"], "")).toBe(`${other}\n`);
    expect(filterAppLogRecords(records, ["DEBUG"], "")).toBe("");
  });

  test("keyword matches in stack traces preserve the complete matching record", () => {
    const records = parseAppLogRecords(raw);
    expect(filterAppLogRecords(records, ["ERROR"], " CONNECTION RESET ")).toBe(error);
    expect(filterAppLogRecords(records, ["INFO"], "connection reset")).toBe("");
  });

  test("unclassified timestamped and structured records do not inherit ERROR", () => {
    const records = parseAppLogRecords(`${error}\n${other}\n{"message":"plain JSON"}`);
    expect(records.map((record) => record.level)).toEqual(["ERROR", "OTHER", "OTHER"]);
  });

  test("empty logs and a tail starting midway through a stack are supported", () => {
    expect(parseAppLogRecords("")).toEqual([]);
    expect(parseAppLogRecords(`\tat App.main(App.java:12)\n${info}`).map((record) => record.level)).toEqual(["OTHER", "INFO"]);
  });

  test("long numeric console output is not treated as a header", () => {
    expect(parseAppLogRecords("1".repeat(10000))[0].level).toBe("OTHER");
  });

  test("Trace has a log style and log content stays HTML escaped", () => {
    expect(logHighlightHtml("TRACE <script>")).toContain('<span class="hljs-comment">TRACE</span> &lt;script&gt;');
  });
});
