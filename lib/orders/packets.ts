// Rupee sachets (5 / 10 / 20 Rs) are counted in packets even when Tally bills
// them per kg (Lion No 5 Rs 20). For display, turn such a kg line back into
// packets using the packet weight (D-69).

const RUPEE = /\b(?:rs\.?\s*\d+|\d+\s*rs)\b/i;

export function isRupeeSachet(name: string): boolean {
  return RUPEE.test(name) && !/\b\d+(?:\.\d+)?\s*(?:kg|gm?|grams?)\b/i.test(name);
}

/** "10 pkt" for a kg-billed sachet line, else null (show the billing qty as is). */
export function packetsFor(item: { name: string; unit: string; pack_size_g: number | string | null }, qty: number): number | null {
  const g = Number(item.pack_size_g ?? 0);
  if (item.unit !== "kg" || !g || !isRupeeSachet(item.name)) return null;
  return Math.round((qty * 1000) / g);
}
