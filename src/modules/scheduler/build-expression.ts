import { isValidCronExpression } from "./cron";

export type ScheduleFrequencyInput =
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom";

export type BuildScheduleExpressionInput = {
  frequency: ScheduleFrequencyInput;
  /** 24-hour "HH:MM" used for daily/weekly/monthly frequencies. */
  time?: string;
  /** Day-of-week names ("monday") or numbers (0-6) for weekly frequency. */
  weekdays?: string[];
  /** Day of month (1-31) for monthly frequency. */
  dayOfMonth?: number;
  /** Raw 5-part cron expression for the custom frequency. */
  customExpression?: string;
};

const WEEKDAY_ALIASES: Record<string, string> = {
  sun: "0",
  sunday: "0",
  mon: "1",
  monday: "1",
  tue: "2",
  tues: "2",
  tuesday: "2",
  wed: "3",
  wednesday: "3",
  thu: "4",
  thur: "4",
  thurs: "4",
  thursday: "4",
  fri: "5",
  friday: "5",
  sat: "6",
  saturday: "6",
};

export function normalizeWeekday(day: string): string | null {
  const key = day.trim().toLowerCase();
  const alias = WEEKDAY_ALIASES[key];

  if (alias) {
    return alias;
  }

  const numeric = Number(key);

  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) {
    return String(numeric);
  }

  return null;
}

export function normalizeTime(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

export function buildScheduleExpression(
  input: BuildScheduleExpressionInput,
): string {
  const { frequency } = input;

  if (frequency === "custom") {
    const expression = (input.customExpression ?? "").trim();

    if (!isValidCronExpression(expression, "local")) {
      throw new Error(
        `Invalid cron expression "${expression}". Use a 5-part cron pattern such as "0 9 * * 1".`,
      );
    }

    return expression;
  }

  const normalizedTime = normalizeTime(input.time ?? "09:00");

  if (!normalizedTime) {
    throw new Error(
      `Invalid time "${input.time ?? ""}". Use 24-hour "HH:MM" format.`,
    );
  }

  const { hour, minute } = normalizedTime;

  if (frequency === "hourly") {
    return `${minute} * * * *`;
  }

  if (frequency === "daily") {
    return `${minute} ${hour} * * *`;
  }

  if (frequency === "weekly") {
    const days = (input.weekdays ?? []).map(normalizeWeekday);

    if (days.length === 0 || days.some((day) => day === null)) {
      throw new Error(
        "Weekly schedules require at least one valid weekday (for example Monday, Wednesday, Friday).",
      );
    }

    return `${minute} ${hour} * * ${days.join(",")}`;
  }

  if (frequency === "monthly") {
    const dayOfMonth = input.dayOfMonth;

    if (!Number.isInteger(dayOfMonth) || dayOfMonth! < 1 || dayOfMonth! > 31) {
      throw new Error("Monthly schedules require a day of month between 1 and 31.");
    }

    return `${minute} ${hour} ${dayOfMonth} * *`;
  }

  throw new Error(
    `Unknown schedule frequency "${frequency}". Use hourly, daily, weekly, monthly, or custom.`,
  );
}

export function defaultScheduleTime(): string {
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");

  return `${hour}:${minute}`;
}
