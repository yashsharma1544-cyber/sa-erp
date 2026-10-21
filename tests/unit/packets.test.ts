import { describe, expect, it } from "vitest";
import { isRupeeSachet, packetsFor } from "@/lib/orders/packets";

describe("packets", () => {
  it("knows rupee sachets", () => {
    expect(isRupeeSachet("Lion No 5 Rs 20 (New)")).toBe(true);
    expect(isRupeeSachet("Lion No 5 10 Rs")).toBe(true);
    expect(isRupeeSachet("Vikram Lion 1 Kg 435 RS")).toBe(false);
    expect(isRupeeSachet("Lion No 5 - 250 Gm")).toBe(false);
  });
  it("turns a kg-billed sachet line back into packets", () => {
    expect(packetsFor({ name: "Lion No 5 Rs 20 (New)", unit: "kg", pack_size_g: 460 }, 4.6)).toBe(10);
    expect(packetsFor({ name: "Lion No 5 10 Rs", unit: "pkt", pack_size_g: 660 }, 20)).toBeNull();
    expect(packetsFor({ name: "Lion No 5 - 250 Gm", unit: "kg", pack_size_g: 250 }, 20)).toBeNull();
  });
});
