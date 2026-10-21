import { describe, expect, it } from "vitest";
import { dateDMY, rupeesPlain, templateValues } from "@/lib/whatsapp/format";

describe("WhatsApp values", () => {
  it("groups rupees the Indian way and drops .00", () => {
    expect(rupeesPlain(1234567)).toBe("12,34,567");
    expect(rupeesPlain("1200.50")).toBe("1,200.50");
    expect(rupeesPlain(999)).toBe("999");
    expect(rupeesPlain(0)).toBe("0");
  });

  it("writes dates as DD-MM-YYYY", () => {
    expect(dateDMY("2026-10-21")).toBe("21-10-2026");
  });

  it("fills the receipt template in order, with a Marathi mode and the link", () => {
    const v = templateValues(
      ["customer_name", "firm_name", "amount", "mode", "date", "receipt_no", "link"],
      { customer_name: "Ram Kirana", firm_name: "Sushil Agencies", amount: 15000, mode: "cash", date: "2026-10-21", receipt_no: "SA/R/26-27/00001", token: "abc" },
      "https://sa-erp-blond.vercel.app",
    );
    expect(v).toEqual(["Ram Kirana", "Sushil Agencies", "15,000", "रोख", "21-10-2026", "SA/R/26-27/00001", "https://sa-erp-blond.vercel.app/r/abc"]);
  });
});
