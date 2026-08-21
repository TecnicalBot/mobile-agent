import { describe, expect, it } from "vitest";

import {
  buildScheduleExpression,
  normalizeTime,
  normalizeWeekday,
} from "../build-expression";
import { describeExpression } from "../cron";

describe("build-expression", () => {
  it("normalizes weekdays including 0 and 7 as Sunday", () => {
    expect(normalizeWeekday("monday")).toBe("1");
    expect(normalizeWeekday("mon")).toBe("1");
    expect(normalizeWeekday("sunday")).toBe("0");
    expect(normalizeWeekday("sun")).toBe("0");
    expect(normalizeWeekday("0")).toBe("0");
    expect(normalizeWeekday("7")).toBe("0");
    expect(normalizeWeekday("5")).toBe("5");
    expect(normalizeWeekday("invalid")).toBeNull();
  });

  it("normalizes time strings", () => {
    expect(normalizeTime("09:30")).toEqual({ hour: 9, minute: 30 });
    expect(normalizeTime("0:00")).toEqual({ hour: 0, minute: 0 });
    expect(normalizeTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("invalid")).toBeNull();
  });

  it("builds daily schedule expressions", () => {
    expect(
      buildScheduleExpression({ frequency: "daily", time: "14:15" }),
    ).toBe("15 14 * * *");
  });

  it("builds weekly schedule expressions", () => {
    expect(
      buildScheduleExpression({
        frequency: "weekly",
        time: "09:00",
        weekdays: ["Monday", "Wednesday", "Friday"],
      }),
    ).toBe("0 9 * * 1,3,5");
  });

  it("builds monthly schedule expressions", () => {
    expect(
      buildScheduleExpression({
        frequency: "monthly",
        time: "10:00",
        dayOfMonth: 15,
      }),
    ).toBe("0 10 15 * *");
  });
});

describe("describeExpression", () => {
  it("describes interval expressions", () => {
    expect(describeExpression("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeExpression("0 */2 * * *")).toBe("Every 2 hours");
  });

  it("describes daily and weekly expressions with Sunday 0 and 7", () => {
    expect(describeExpression("0 9 * * *")).toBe("Daily at 09:00 (9:00 AM)");
    expect(describeExpression("30 18 * * 1")).toBe("Monday at 18:30 (6:30 PM)");
    expect(describeExpression("0 12 * * 0")).toBe("Sunday at 12:00 (12:00 PM)");
    expect(describeExpression("0 12 * * 7")).toBe("Sunday at 12:00 (12:00 PM)");
    expect(describeExpression("0 8 * * 1-5")).toBe("Monday, Tuesday, Wednesday, Thursday, Friday at 08:00 (8:00 AM)");
  });
});
