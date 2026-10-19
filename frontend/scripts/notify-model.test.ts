import { describe, expect, test } from "bun:test";
import {
  buildIncidents,
  type AlertEvent,
} from "../src/react/lib/alert-incidents";
import {
  messageSectionOf,
  notifySourceOf,
  selectedIncident,
  unreadEventIds,
  unreadIncidents,
} from "../src/react/lib/notify-model";

function event(
  id: string,
  kind: string,
  patch: Partial<AlertEvent> = {},
): AlertEvent {
  return {
    id,
    incidentId: id,
    host: "host-a",
    kind,
    state: "down",
    title: "",
    detail: "",
    metric: "",
    value: "",
    threshold: "",
    peak: "",
    level: "",
    stage: "",
    service: "",
    channels: [],
    at: Date.now(),
    read: false,
    ...patch,
  };
}

describe("通知来源与操作范围", () => {
  test("资源、应用、证书分别归类，旧系统记录仍可查看", () => {
    expect(
      [
        "cpu",
        "mem",
        "disk",
        "load",
        "net",
        "diskio",
        "inspect:scan",
        "unknown",
      ].map(notifySourceOf),
    ).toEqual(Array(8).fill("metric"));
    expect(notifySourceOf("app:im")).toBe("app");
    expect(notifySourceOf("app:custom-service")).toBe("app");
    expect(notifySourceOf("cert")).toBe("cert");
    expect(messageSectionOf("cert")).toBe("certMessages");
    expect(messageSectionOf("app:im")).toBe("appMessages");
  });

  test("未读按合并事件统计，一级栏可与各分类相加保持一致", () => {
    const incidents = buildIncidents([
      event("resource", "mem"),
      event("resource-repeat", "mem", {
        incidentId: "resource",
        stage: "repeat",
      }),
      event("app", "app:im"),
      event("cert", "cert"),
      event("cert-read", "cert", { read: true }),
    ]);
    expect(unreadIncidents(incidents)).toEqual({ metric: 1, app: 1, cert: 1 });
  });

  test("标记当前分类包含升级和重复记录，但不越过来源边界", () => {
    const events = [
      event("metric", "mem"),
      event("escalate", "mem", { incidentId: "metric", stage: "escalate" }),
      event("repeat", "mem", { incidentId: "metric", stage: "repeat" }),
      event("read", "mem", { incidentId: "metric", read: true }),
      event("app", "app:im"),
      event("cert", "cert"),
    ];
    const incidents = buildIncidents(events);
    expect(
      unreadEventIds(
        incidents.filter(
          (incident) => notifySourceOf(incident.kind) === "metric",
        ),
        events,
      ),
    ).toEqual(["metric", "escalate", "repeat"]);
    expect(
      unreadEventIds(
        incidents.filter((incident) => notifySourceOf(incident.kind) === "app"),
        events,
      ),
    ).toEqual(["app"]);
    expect(unreadEventIds([], events)).toEqual([]);
  });

  test("系统通知定位优先于之前的选中项，目标删除后回到可见记录", () => {
    const incidents = buildIncidents([
      event("old", "mem", { at: 10 }),
      event("target", "cert", { at: 20 }),
    ]);
    expect(selectedIncident(incidents, "old", "target")?.id).toBe("target");
    expect(selectedIncident(incidents, "old", "missing")?.id).toBe("old");
    expect(selectedIncident(incidents, "missing", "missing")?.id).toBe(
      "target",
    );
    expect(selectedIncident([], "old", "target")).toBeUndefined();
  });
});
