import { describe, expect, it } from "vitest";
import { lineTotals, orderTotals, roundHalfUp } from "@/lib/orders/math";

describe("order math", () => {
  it("rounds half away from zero like Postgres", () => {
    expect(roundHalfUp(1.005)).toBe(1.01);
    expect(roundHalfUp(2.675)).toBe(2.68);
    expect(roundHalfUp(-1.005)).toBe(-1.01);
    expect(roundHalfUp(0.6765, 3)).toBe(0.677);
  });
  it("matches a Tally tea line (10 kg at 459.0476, 5%)", () => {
    const t = lineTotals({ qty: 10, rate: 459.0476, listRate: 459.0476, gstRate: 5, kgPerUnit: 1 }, true);
    expect(t).toEqual({ taxable: 4590.48, gst: 229.52, amount: 4820, kg: 10, discount: 0 });
  });
  it("no GST for Anjali, discount below list", () => {
    const t = lineTotals({ qty: 10, rate: 390, listRate: 400, gstRate: 5, kgPerUnit: 1 }, false);
    expect(t).toEqual({ taxable: 3900, gst: 0, amount: 3900, kg: 10, discount: 100 });
  });
  it("adds lines like the database test order", () => {
    const t = orderTotals(
      [
        { qty: 10, rate: 400, listRate: 400, gstRate: 5, kgPerUnit: 1 },
        { qty: 2, rate: 1500, listRate: 1500, gstRate: 5, kgPerUnit: 0 },
      ],
      true,
    );
    expect(t).toEqual({ taxable: 7000, gst: 350, amount: 7350, kg: 10, discount: 0 });
  });
});
