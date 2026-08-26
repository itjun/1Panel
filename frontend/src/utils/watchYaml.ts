/** 轻量改写 watch.yml 顶层 wecomWebhook（不引入完整 YAML 库） */

function yamlQuote(s: string): string {
  return JSON.stringify(s);
}

function setTopKey(yaml: string, key: string, valueLine: string): string {
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(yaml)) {
    return yaml.replace(re, valueLine);
  }
  const trimmed = yaml.replace(/^\uFEFF/, "");
  if (!trimmed.trim()) {
    return valueLine + "\n";
  }
  return valueLine + "\n" + trimmed.replace(/^\n+/, "");
}

export function patchWatchNotify(
  yaml: string,
  opts: { wecomWebhook: string }
): string {
  return setTopKey(
    yaml || "",
    "wecomWebhook",
    `wecomWebhook: ${yamlQuote(opts.wecomWebhook)}`
  );
}

export function readWatchNotify(yaml: string): { wecomWebhook: string } {
  const text = yaml || "";
  let wecomWebhook = "";
  const wm = text.match(/^wecomWebhook:\s*(.*)$/m);
  if (wm) {
    let v = wm[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    wecomWebhook = v;
  }
  return { wecomWebhook };
}
