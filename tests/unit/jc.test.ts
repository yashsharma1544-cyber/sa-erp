import { describe, expect, it } from "vitest";
import { generateJourneyCycles, journeyCycleFor, jcDay, fyStartYearFor, fyLabel } from "@/lib/jc";

describe("generateJourneyCycles", () => {
  it("FY 26-27: 13 JCs, 12×28 days, JC13 has 29", () => {
    const jcs = generateJourneyCycles(2026);
    expect(jcs).toHaveLength(13);
    expect(jcs[0]).toMatchObject({ jcNumber: 1, startDate: "2026-04-01", endDate: "2026-04-28", days: 28 });
    expect(jcs[11]!.days).toBe(28);
    expect(jcs[12]).toMatchObject({ jcNumber: 13, startDate: "2027-03-03", endDate: "2027-03-31", days: 29 });
    expect(jcs.reduce((a, j) => a + j.days, 0)).toBe(365);
  });
  it("leap FY 27-28: JC13 has 30 days", () => {
    const jcs = generateJourneyCycles(2027);
    expect(jcs[12]).toMatchObject({ endDate: "2028-03-31", days: 30 });
    expect(jcs.reduce((a, j) => a + j.days, 0)).toBe(366);
  });
  it("JCs are contiguous", () => {
    const jcs = generateJourneyCycles(2026);
    for (let i = 1; i < jcs.length; i++) {
      const prevEnd = new Date(jcs[i - 1]!.endDate + "T00:00:00Z");
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(prevEnd.toISOString().slice(0, 10)).toBe(jcs[i]!.startDate);
    }
  });
});

describe("journeyCycleFor", () => {
  it("finds the JC and day for a date", () => {
    expect(journeyCycleFor("2026-10-20").jcNumber).toBe(8);
    expect(journeyCycleFor("2026-10-20").startDate).toBe("2026-10-14");
    expect(jcDay("2026-10-20")).toBe(7);
    expect(journeyCycleFor("2027-03-31").jcNumber).toBe(13);
    expect(journeyCycleFor("2026-04-01").jcNumber).toBe(1);
  });
  it("maps dates to FY", () => {
    expect(fyStartYearFor("2027-03-31")).toBe(2026);
    expect(fyStartYearFor("2027-04-01")).toBe(2027);
    expect(fyLabel(2026)).toBe("26-27");
  });
});
