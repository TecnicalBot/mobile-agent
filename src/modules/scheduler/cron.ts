import { Cron } from "croner";

export function getLocalTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return zone && zone.length > 0 ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

export function resolveTimezone(timezone: string) {
  if (!timezone || timezone === "local") {
    return getLocalTimeZone();
  }

  return timezone;
}

export function createCronInstance(expression: string, timezone: string) {
  return new Cron(expression, { timezone: resolveTimezone(timezone) });
}

export function isValidCronExpression(
  expression: string,
  timezone: string,
): boolean {
  if (!expression || expression.trim().length === 0) {
    return false;
  }

  try {
    createCronInstance(expression, timezone);
    return true;
  } catch {
    return false;
  }
}

export function computeNextRun(
  expression: string,
  timezone: string,
  from?: Date,
): Date | null {
  try {
    return createCronInstance(expression, timezone).nextRun(from);
  } catch {
    return null;
  }
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatTime(minute: string, hour: string) {
  const numHour = Number(hour);
  const numMin = Number(minute);

  if (Number.isNaN(numHour) || Number.isNaN(numMin)) {
    return `${hour}:${minute}`;
  }

  const hh = String(numHour).padStart(2, "0");
  const mm = String(numMin).padStart(2, "0");
  const hour12 = numHour % 12 === 0 ? 12 : numHour % 12;
  const suffix = numHour < 12 ? "AM" : "PM";

  return `${hh}:${mm} (${hour12}:${mm} ${suffix})`;
}

function expandDowList(dow: string) {
  const parts = dow.split(",").map((part) => part.trim());

  return parts
    .map((part) => {
      const range = part.split("-");

      if (range.length === 2) {
        const start = Number(range[0]);
        const end = Number(range[1]);
        const names = [];

        if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end) {
          for (let day = start; day <= end; day += 1) {
            names.push(WEEKDAY_NAMES[day % 7]);
          }

          return names.join(", ");
        }
      }

      const numeric = Number(part);

      if (!Number.isNaN(numeric) && numeric >= 0 && numeric <= 7) {
        return WEEKDAY_NAMES[numeric % 7];
      }

      return part;
    })
    .join(", ");
}

export function describeExpression(expression: string): string {
  const parts = expression.trim().split(/\s+/);

  if (parts.length === 5) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const minuteStep = /^\*\/([1-9]\d*)$/.exec(minute);
    const hourStep = /^\*\/([1-9]\d*)$/.exec(hour);
    const daySuffix =
      dayOfWeek === "*" ? "" : ` on ${expandDowList(dayOfWeek)}`;

    if (minuteStep && hour === "*" && dayOfMonth === "*" && month === "*") {
      const interval = Number(minuteStep[1]);
      return `Every ${interval} minute${interval === 1 ? "" : "s"}${daySuffix}`;
    }

    if (
      minute === "0" &&
      hourStep &&
      dayOfMonth === "*" &&
      month === "*"
    ) {
      const interval = Number(hourStep[1]);
      return `Every ${interval} hour${interval === 1 ? "" : "s"}${daySuffix}`;
    }

    if (hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `Every hour at minute ${minute}`;
    }

    if (hour !== "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `Daily at ${formatTime(minute, hour)}`;
    }

    if (
      hour !== "*" &&
      dayOfMonth === "*" &&
      month === "*" &&
      dayOfWeek !== "*"
    ) {
      return `${expandDowList(dayOfWeek)} at ${formatTime(minute, hour)}`;
    }

    if (
      hour !== "*" &&
      dayOfMonth !== "*" &&
      month === "*" &&
      dayOfWeek === "*"
    ) {
      return `Day ${dayOfMonth} of every month at ${formatTime(minute, hour)}`;
    }
  }

  return `Cron ${expression}`;
}
