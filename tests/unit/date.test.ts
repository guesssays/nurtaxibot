import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLastMonthBounds,
  getThisMonthBounds,
  getTodayBounds,
  getYesterdayBounds,
} from "../../src/lib/date";

describe("export date ranges", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates today range in project timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T05:15:00.000Z"));

    const bounds = getTodayBounds("Asia/Tashkent");

    expect(bounds.start.toISOString()).toBe("2026-03-27T19:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-03-28T18:59:59.999Z");
  });

  it("calculates yesterday range in project timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T05:15:00.000Z"));

    const bounds = getYesterdayBounds("Asia/Tashkent");

    expect(bounds.start.toISOString()).toBe("2026-03-26T19:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-03-27T18:59:59.999Z");
  });

  it("calculates this month range from month start to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T05:15:00.000Z"));

    const bounds = getThisMonthBounds("Asia/Tashkent");

    expect(bounds.start.toISOString()).toBe("2026-02-28T19:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-03-28T05:15:00.000Z");
  });

  it("calculates last month range as full previous calendar month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T05:15:00.000Z"));

    const bounds = getLastMonthBounds("Asia/Tashkent");

    expect(bounds.start.toISOString()).toBe("2026-01-31T19:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-02-28T18:59:59.999Z");
  });
});
