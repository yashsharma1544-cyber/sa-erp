import { describe, expect, it } from "vitest";
import { formatINR, formatKg, formatNumber, todayIST, formatDate } from "@/lib/format";

describe("formatINR", () => {
  it("uses full Indian grouping with paise", () => {
    expect(formatINR("1234567")).toBe("₹12,34,567.00");
    expect(formatINR("600000000")).toBe("₹60,00,00,000.00");
    expect(formatINR("999.5")).toBe("₹999.50");
    expect(formatINR(0)).toBe("₹0.00");
    expect(formatINR(null)).toBe("₹0.00");
  });
  it("handles negatives and rounding without float error", () => {
    expect(formatINR("-1500")).toBe("-₹1,500.00");
    expect(formatINR("0.105")).toBe("₹0.11");
    expect(formatINR("100000.005")).toBe("₹1,00,000.01");
  });
});

describe("formatKg", () => {
  it("groups and trims trailing zeros", () => {
    expect(formatKg("123456")).toBe("1,23,456 kg");
    expect(formatKg("815000.000")).toBe("8,15,000 kg");
    expect(formatKg("12.500")).toBe("12.5 kg");
    expect(formatKg("0.25")).toBe("0.25 kg");
  });
});

describe("formatNumber", () => {
  it("groups counts", () => {
    expect(formatNumber(1500)).toBe("1,500");
    expect(formatNumber(10000000)).toBe("1,00,00,000");
  });
});

describe("IST dates", () => {
  it("rolls to the next day after 18:30 UTC", () => {
    expect(todayIST(new Date("2026-10-20T18:29:00Z"))).toBe("2026-10-20");
    expect(todayIST(new Date("2026-10-20T18:31:00Z"))).toBe("2026-10-21");
  });
  it("formats business dates without shifting the day", () => {
    expect(formatDate("2026-04-01")).toBe("01 Apr 2026");
  });
});
