import cronstrue from "cronstrue";
import "cronstrue/locales/zh_CN";

const NICKNAMES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};
const MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
const WEEKDAYS = "SUN MON TUE WED THU FRI SAT".split(" ");
const DAY_LABELS = "日一二三四五六";
const UNSUPPORTED = "暂无法解析，请查看原始计划";

// Only accept Linux crontab fields; the descriptor also supports Quartz syntax.
function validField(field: string, min: number, max: number, names: string[] = []): boolean {
  const value = (token: string) => {
    if (/^\d+$/.test(token)) return Number(token);
    const index = names.indexOf(token);
    return index < 0 ? NaN : index + min;
  };
  return field.split(",").every((part) => {
    const pieces = part.split("/");
    if (pieces.length > 2) return false;
    if (pieces.length === 2 && (!/^\d+$/.test(pieces[1]) ||
      !Number.isSafeInteger(Number(pieces[1])) || Number(pieces[1]) < 1)) {
      return false;
    }
    const base = pieces[0];
    if (base === "*") return true;
    const bounds = base.split("-");
    if (bounds.length > 2 || (pieces.length === 2 && bounds.length !== 2)) return false;
    const start = value(bounds[0]);
    const end = value(bounds[bounds.length - 1]);
    return start >= min && end <= max && start <= end;
  });
}

/** Describes the remote cron clock without converting it to the local timezone. */
export function describeCron(schedule: string): string {
  const expression = schedule.trim().toUpperCase();
  if (!expression) return "—";
  if (expression === "@REBOOT") return "系统启动后执行一次";
  const fields = (NICKNAMES[expression.toLowerCase()] || expression).split(/\s+/);
  if (fields.length !== 5 || ![
    validField(fields[0], 0, 59),
    validField(fields[1], 0, 23),
    validField(fields[2], 1, 31),
    validField(fields[3], 1, 12, MONTHS),
    validField(fields[4], 0, 7, WEEKDAYS),
  ].every(Boolean)) return UNSUPPORTED;

  const [minute, hour, day, month, weekday] = fields;
  const everyDay = day === "*" && month === "*" && weekday === "*";
  const fixedMinute = /^\d+$/.test(minute);
  const fixedHour = /^\d+$/.test(hour);
  if (hour === "*" && everyDay) {
    if (minute === "*") return "每分钟执行";
    const step = minute.match(/^\*\/(\d+)$/);
    if (step && 60 % Number(step[1]) === 0) {
      return Number(step[1]) === 1 ? "每分钟执行" : `每隔 ${Number(step[1])} 分钟执行`;
    }
    if (fixedMinute) return `每小时第 ${Number(minute)} 分钟执行`;
  }
  if (fixedMinute && fixedHour && month === "*") {
    const time = `${String(Number(hour)).padStart(2, "0")}:${String(Number(minute)).padStart(2, "0")}`;
    if (everyDay) return `每天 ${time} 执行`;
    if (day === "*") {
      const dayIndex = /^\d+$/.test(weekday) ? Number(weekday) % 7 : WEEKDAYS.indexOf(weekday);
      if (dayIndex >= 0) return `每周${DAY_LABELS[dayIndex]} ${time} 执行`;
    }
    if (weekday === "*") {
      if (/^\d+$/.test(day)) return `每月 ${Number(day)} 日 ${time} 执行`;
      const range = day.match(/^(\d+)-(\d+)$/);
      if (range) return `每月 ${Number(range[1])}–${Number(range[2])} 日，每天 ${time} 执行`;
    }
  }

  // Steps restart at the next hour/day: */40 is at :00 and :40, not a
  // continuous 40-minute interval. Expand uneven steps to avoid that wording.
  for (const [index, size] of [[0, 60], [1, 24]]) {
    const step = fields[index].match(/^\*\/(\d+)$/);
    if (step && size % Number(step[1]) !== 0) {
      fields[index] = Array.from(
        { length: Math.ceil(size / Number(step[1])) }, (_, i) => String(i * Number(step[1])),
      ).join(",");
    }
  }
  try {
    const description = cronstrue.toString(fields.join(" "), {
      locale: "zh_CN",
      use24HourTimeFormat: true,
      verbose: true,
      // Linux cron uses OR when both day fields are restricted; a leading
      // wildcard in either field instead makes both constraints apply.
      logicalAndDayFields: day.startsWith("*") || weekday.startsWith("*"),
      throwExceptionOnParseError: true,
    });
    return `${description.replace(/,\s*/g, "，").replace(/\s+/g, " ")} 执行`;
  } catch {
    return UNSUPPORTED;
  }
}

/** System crontabs add a username; @nicknames replace all five date fields. */
export function parseCronLine(cron: { line: string; source: string; user: string }) {
  const tokens = [...cron.line.matchAll(/\S+/g)];
  const scheduleFields = tokens[0]?.[0].startsWith("@") ? 1 : 5;
  const isSystem = cron.source === "etc-crontab" || cron.source === "etc-cron.d";
  const commandIndex = scheduleFields + (isSystem ? 1 : 0);
  const schedule = tokens.slice(0, scheduleFields).map((token) => token[0]).join(" ");
  return {
    schedule,
    description: describeCron(schedule),
    user: isSystem ? tokens[scheduleFields]?.[0] || cron.user : cron.user,
    cmd: cron.line.slice(tokens[commandIndex]?.index ?? cron.line.length).trimEnd(),
  };
}
