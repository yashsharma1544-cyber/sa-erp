import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/action-result";

describe("friendlyError", () => {
  it("passes our own check messages through", () => {
    expect(friendlyError({ code: "23514", message: "Give a credit limit, credit days or both" })).toBe("Give a credit limit, credit days or both");
  });
  it("hides raw constraint failures", () => {
    expect(friendlyError({ code: "23514", message: 'new row for relation "x" violates check constraint "x_ck"' })).toMatch(/not valid/);
  });
});
