import { describe, expect, it } from "vitest";
import { aliasKey, parseOrderMessage, prepareItems, tokenize, type ParseItem } from "@/lib/orders/parse";

const ITEMS: ParseItem[] = [
  { id: "lion250", name: "Lion No 5 - 250 Gm", unit: "kg", kgPerUnit: 1, popularity: 2773 },
  { id: "lion100", name: "Lion No 5 -100 Gm", unit: "kg", kgPerUnit: 1, popularity: 1516 },
  { id: "lion1kg", name: "Lion No.5 1 Kg.", unit: "kg", kgPerUnit: 1, popularity: 339 },
  { id: "lion10rs", name: "Lion No 5 10 Rs", unit: "pkt", kgPerUnit: 0.676, popularity: 2248 },
  { id: "vd10", name: "Vikram Dust 10 Rs", unit: "pkt", kgPerUnit: 0.625, popularity: 199 },
  { id: "vd20", name: "Vikram Dust 20 Rs", unit: "pkt", kgPerUnit: 0.5, popularity: 50 },
  { id: "vkd20", name: "Vikram Kadak Dust 20 Rs", unit: "pkt", kgPerUnit: 0.96, popularity: 309 },
  { id: "vd250", name: "Vikram Dust - 250 Gm", unit: "kg", kgPerUnit: 1, popularity: 569 },
  { id: "ve250", name: "Vikram Elachi 250 Gm Jar", unit: "kg", kgPerUnit: 1, popularity: 10 },
  { id: "ve250b", name: "Vikram Elaichi 250 Gm", unit: "kg", kgPerUnit: 1, popularity: 111 },
  { id: "vin15jar", name: "Vinayak 15 Ltr Jar", unit: "jar", kgPerUnit: 0, popularity: 750 },
  { id: "vin15tin", name: "Vinayak Tin 15 Ltr", unit: "tin", kgPerUnit: 0, popularity: 158 },
  { id: "vin1l", name: "VinayaK 1 Ltr Box", unit: "box", kgPerUnit: 0, popularity: 734 },
  { id: "fort2l", name: "Fortune Soyabean 2 Ltr (8Pcs)", unit: "box", kgPerUnit: 0, popularity: 233 },
];
const P = prepareItems(ITEMS);
const one = (msg: string) => parseOrderMessage(msg, P).lines[0]!;

describe("tokenize", () => {
  it("joins sizes and reads Marathi digits", () => {
    expect(tokenize("लायन २५० ग्राम").map((t) => `${t.kind}:${t.v}`)).toEqual(["word:lion", "size:250g"]);
    expect(tokenize("Vikram Dust 10 Rs").filter((t) => t.kind === "size")[0]!.v).toBe("rs10");
    expect(tokenize("rs10").filter((t) => t.kind === "size")[0]!.v).toBe("rs10");
    expect(tokenize("1000gm")[0]!.v).toBe("1kg");
  });
});

describe("parseOrderMessage", () => {
  it("lion 250 - 5 kg in Marathi", () => {
    const l = one("लायन 250 - 5 किलो");
    expect([l.itemId, l.qty, l.unitSaid, l.confidence]).toEqual(["lion250", 5, "kg", "high"]);
  });
  it("sachets by rupee value with a packet count", () => {
    const l = one("vikram dust 10 rs 20 pkt");
    expect([l.itemId, l.qty, l.unitSaid, l.note]).toEqual(["vd10", 20, "pkt", null]);
  });
  it("tells jar from tin", () => {
    expect(one("vinayak 15 ltr jar 2")).toMatchObject({ itemId: "vin15jar", qty: 2 });
    expect(one("vinayak 15 ltr dabba 3")).toMatchObject({ itemId: "vin15tin", qty: 3 });
  });
  it("converts packets of a kg-billed tea", () => {
    const l = one("vikram dust 250 gm 10 pkt");
    expect([l.itemId, l.qty]).toEqual(["vd250", 2.5]);
    expect(l.note).toContain("10 pkt × 250 g = 2.5 kg");
  });
  it("misspelling and near-duplicates prefer the popular item, flagged low", () => {
    const l = one("vikram elachi 250 3 kg");
    expect(l.itemId).toBe("ve250b");
    expect(l.candidates).toContain("ve250");
    expect(l.qty).toBe(3);
  });
  it("strips the WhatsApp header and keeps the shop name as a hint", () => {
    const m = parseOrderMessage("[21/10/26, 9:15 am] Ramesh: Om Sai Kirana Lonar\nfortune 2 ltr 1 box\nलायन १० रु ५ पॅकेट", P);
    expect(m.sender).toBe("Ramesh");
    expect(m.customerHint).toBe("Om Sai Kirana Lonar");
    expect(m.lines.map((l) => [l.itemId, l.qty])).toEqual([
      ["fort2l", 1],
      ["lion10rs", 5],
    ]);
  });
  it("no quantity given is low confidence", () => {
    const l = one("lion 250");
    expect([l.itemId, l.qty, l.confidence]).toEqual(["lion250", null, "low"]);
  });
  it("saved wording wins", () => {
    const P2 = prepareItems([...ITEMS.slice(0, 3), { ...ITEMS[3]!, aliases: ["peela lion"] }]);
    expect(parseOrderMessage("peela lion 12", P2).lines[0]).toMatchObject({ itemId: "lion10rs", qty: 12, confidence: "high" });
    expect(aliasKey("Peela Lion 12 pkt")).toBe("peela lion");
  });
});
