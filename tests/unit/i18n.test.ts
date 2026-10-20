import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { t, toLocale } from "@/lib/i18n";

describe("i18n", () => {
  it("fills variables in both languages", () => {
    expect(t("en", "wrongPin", { n: 3 })).toBe("Wrong PIN. Attempts left: 3");
    expect(t("mr", "hello", { name: "रमेश" })).toBe("नमस्कार, रमेश");
  });
  it("defaults unknown locales", () => {
    expect(toLocale("fr")).toBe("mr");
    expect(toLocale(undefined, "en")).toBe("en");
  });
  it("never uses लक्ष्य (use टार्गेट)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../lib/i18n.ts"), "utf8");
    const withoutComments = src.replace(/\/\/.*$/gm, "");
    expect(withoutComments.includes("लक्ष्य")).toBe(false);
  });
});
