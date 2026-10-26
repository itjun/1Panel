export const APP_LOG_LEVELS = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE", "FATAL", "OTHER"] as const;
export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];

const LEVEL = "FATAL|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE";
const TIMESTAMP = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?`;
// Match only the header: words such as "ERROR" in a message or thread name
// must not change the record's level. Supports Spring Boot, Logback and Log4j.
const HEADER = new RegExp(String.raw`^\s*(?:(?:\[[^\]\r\n]*\]|${TIMESTAMP}|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*|\d+\s+)*(?:\[(${LEVEL})\]|(${LEVEL})(?=\s|:|$))`, "i");
const RECORD_START = new RegExp(String.raw`^\s*\[?(?:${TIMESTAMP}|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)`);
const ANSI = /\x1b\[[0-9;]*m/g;

export interface AppLogRecord {
  level: AppLogLevel;
  text: string;
}

function normalizeLevel(value: string): AppLogLevel {
  const level = value.toUpperCase();
  if (level === "WARNING") return "WARN";
  return APP_LOG_LEVELS.includes(level as AppLogLevel) ? level as AppLogLevel : "OTHER";
}

export function parseAppLogRecords(raw: string): AppLogRecord[] {
  if (!raw) return [];
  const records: AppLogRecord[] = [];
  for (const line of raw.split("\n")) {
    const clean = line.replace(ANSI, "");
    const header = HEADER.exec(clean);
    let level = header ? normalizeLevel(header[1] || header[2]) : undefined;
    let structured = false;
    if (clean.trimStart().startsWith("{")) {
      try {
        const entry = JSON.parse(clean);
        structured = true;
        const value = entry.level ?? entry.logLevel ?? entry["log.level"];
        level = typeof value === "string" ? normalizeLevel(value) : "OTHER";
      } catch { /* A multiline message can contain non-JSON braces. */ }
    }
    const previous = records[records.length - 1];
    if (level || structured || RECORD_START.test(clean) || !previous) {
      records.push({ level: level ?? "OTHER", text: line });
    } else {
      // Exception messages, caused-by chains and stack frames belong together.
      previous.text += `\n${line}`;
    }
  }
  return records;
}

export function filterAppLogRecords(records: AppLogRecord[], level: AppLogLevel | null, search: string): string {
  const term = search.trim().toLowerCase();
  return records
    .filter((record) => (level === null || record.level === level) && (!term || record.text.toLowerCase().includes(term)))
    .map((record) => record.text)
    .join("\n");
}
