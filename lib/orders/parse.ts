// Turns a pasted WhatsApp order message into order lines.
//
// A message looks like:
//   [21/10/26, 9:15 am] Ramesh Kirana: लायन 250 - 5 किलो
//   vikram dust 10 rs 20 pkt
//   vinayak 15 ltr jar 2
// Each line is matched to an item by its words and pack sizes ("250g",
// "15l", "rs10"), and the remaining number is the quantity. Lines are only
// suggestions: the office checks every one before the order is placed, and
// corrections are saved as aliases so the same wording matches next time.

export type ParseItem = {
  id: string;
  name: string;
  unit: string; // billing unit: kg, pkt, box, jar, tin, pc …
  kgPerUnit: number;
  aliases?: string[];
  popularity?: number; // recent sales lines, breaks ties between near-duplicates
};

export type ParsedLine = {
  raw: string;
  text: string; // the line without its quantity, used as an alias
  itemId: string | null;
  candidates: string[]; // best first, at most 4
  qty: number | null;
  unitSaid: string | null;
  note: string | null;
  confidence: "high" | "low" | "none";
};

export type ParsedMessage = { sender: string | null; customerHint: string | null; lines: ParsedLine[] };

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

// Marathi / Hindi words and common misspellings → the words used in item names.
const WORDS: Record<string, string> = {
  लायन: "lion", लायन्स: "lion", लॉयन: "lion", विक्रम: "vikram", विनायक: "vinayak", फॉर्च्यून: "fortune", फॉरच्युन: "fortune",
  जनता: "janta", ठाकूरजी: "thakurji", ठाकुरजी: "thakurji", विलीना: "vilina", धारा: "dhara", गोजस: "gojas", तितली: "titli",
  इलायची: "elaichi", वेलची: "elaichi", एलची: "elaichi", elachi: "elaichi", elaichi: "elaichi", ilaychi: "elaichi", velchi: "elaichi",
  डस्ट: "dust", कडक: "kadak", गोल्ड: "gold", मिक्स: "mix", मसाला: "masala", ग्रीन: "green", क्लासिक: "klassic", classic: "klassic",
  सनफ्लॉवर: "sunflower", सूर्यफूल: "sunflower", sunflowerd: "sunflower", sunflowreseed: "sunflower",
  सोयाबीन: "soyabean", soyabben: "soyabean", soyabeen: "soyabean", soyeabean: "soyabean", soybean: "soyabean", soya: "soyabean", soyebean: "soyabean",
  जार: "jar", कॅन: "can", डबा: "tin", टिन: "tin", पाऊच: "pouch", पाउच: "pouch",
  तेल: "oil", चहा: "tea", चाय: "tea",
};
// Quantity units the customer may write.
const UNITS: Record<string, string> = {
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", किलो: "kg", केजी: "kg",
  pkt: "pkt", pkts: "pkt", packet: "pkt", packets: "pkt", pack: "pkt", पॅकेट: "pkt", पाकीट: "pkt", पाकिट: "pkt",
  box: "box", boxes: "box", बॉक्स: "box", खोके: "box", पेटी: "box", peti: "box", carton: "box",
  jar: "jar", jars: "jar", tin: "tin", tins: "tin", dabba: "tin", can: "jar",
  nag: "pc", नग: "pc", pc: "pc", pcs: "pc", piece: "pc", pieces: "pc",
  bag: "bag", bags: "bag", बॅग: "bag", पोते: "bag",
  ladi: "pkt", लडी: "pkt", strip: "pkt", patti: "pkt", पट्टी: "pkt",
};
const SIZE_UNIT: Record<string, "g" | "kg" | "l" | "ml"> = {
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g", grm: "g", ग्राम: "g", ग्रॅम: "g",
  kg: "kg", kgs: "kg", kilo: "kg", किलो: "kg",
  l: "l", lt: "l", ltr: "l", ltrs: "l", litre: "l", liter: "l", लिटर: "l", लीटर: "l",
  ml: "ml", एमएल: "ml",
};
const RUPEE = new Set(["rs", "rs.", "₹", "रु", "रू", "रुपये", "रुपए", "rupees", "rupee"]);
const STOP = new Set(["no", "new", "n", "p", "the", "and", "of", "for", "with", "a", "x", "ref", "refined", "refind", "oil", "pouch", "pch", "bottle"]);
// Packaging words tell near-identical items apart ("15 Ltr Jar" vs "15 Ltr Tin") but count for little.
const PACKAGING = new Set(["box", "jar", "tin", "can", "bag", "pkt", "pc", "container", "standee"]);

type Tok = { kind: "word" | "size" | "num" | "unit"; v: string; n?: number; used?: boolean };

function asciiDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

function sizeKey(n: number, u: "g" | "kg" | "l" | "ml"): string {
  // 1000 g = 1 kg, 1000 ml = 1 l so "1000gm" and "1 kg" match.
  if (u === "g" && n >= 1000 && n % 1000 === 0) return `${n / 1000}kg`;
  if (u === "ml" && n >= 1000 && n % 1000 === 0) return `${n / 1000}l`;
  return `${n}${u}`;
}

/** Tokens of an item name or a message line. Sizes like "250 Gm" become one token "250g". */
export function tokenize(input: string): Tok[] {
  const s = asciiDigits(input.toLowerCase())
    .replace(/(\d)\s*[*x×]\s*(\d)/g, "$1 x $2")
    .replace(/(\d)([a-zऀ-ॿ₹]+)/g, "$1 $2") // 250gm → 250 gm
    .replace(/([a-zऀ-ॿ₹]+)(\d)/g, "$1 $2") // rs10 → rs 10
    .replace(/[(),/+\-=:;'"!?\[\]|]+/g, " ")
    .replace(/(\d)\.(?!\d)/g, "$1 ") // "1 kg." → "1 kg"
    .replace(/\.(?=\s|$)/g, " ");
  const raw = s.split(/\s+/).filter(Boolean);
  const out: Tok[] = [];
  let rupeeTaken = -1; // index of a "rs" already joined to the number before it
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]!;
    const next = raw[i + 1];
    const prev = i - 1 === rupeeTaken ? undefined : raw[i - 1];
    if (/^\d+(\.\d+)?$/.test(w)) {
      const n = Number(w);
      if (next && SIZE_UNIT[next]) {
        // "5 kg" can be a pack size or a quantity; keep both readings.
        out.push({ kind: "size", v: sizeKey(n, SIZE_UNIT[next]!), n });
        if (UNITS[next]) out.push({ kind: "unit", v: UNITS[next]! });
        i++;
        continue;
      }
      if (next && RUPEE.has(next)) {
        out.push({ kind: "size", v: `rs${n}`, n });
        rupeeTaken = i + 1;
        i++;
        continue;
      }
      if (prev && RUPEE.has(prev)) {
        out.push({ kind: "size", v: `rs${n}`, n });
        continue;
      }
      out.push({ kind: "num", v: w, n });
      continue;
    }
    if (RUPEE.has(w)) continue;
    if (UNITS[w]) {
      out.push({ kind: "unit", v: UNITS[w]! });
      // A unit word is also a word of names like "Box" / "Jar".
      if (["box", "jar", "tin"].includes(UNITS[w]!)) out.push({ kind: "word", v: UNITS[w]! });
      continue;
    }
    const word = WORDS[w] ?? w;
    if (word.length >= 2 || /^[a-z]$/.test(word)) out.push({ kind: "word", v: word });
  }
  return out;
}

type Prepared = ParseItem & { words: Set<string>; sizes: Set<string>; brand: string; aliasKeys: Set<string>; packKg: number | null };

function packKgFromSizes(sizes: Set<string>): number | null {
  for (const s of sizes) {
    const m = /^(\d+(?:\.\d+)?)(g|kg)$/.exec(s);
    if (m) return m[2] === "g" ? Number(m[1]) / 1000 : Number(m[1]);
  }
  return null;
}

export function aliasKey(text: string): string {
  return tokenize(text)
    .filter((t) => t.kind !== "num" && t.kind !== "unit")
    .map((t) => t.v)
    .join(" ");
}

export function prepareItems(items: ParseItem[]): Prepared[] {
  return items.map((it) => {
    const toks = tokenize(it.name);
    const words = new Set(toks.filter((t) => t.kind === "word" && !STOP.has(t.v)).map((t) => t.v));
    const sizes = new Set(toks.filter((t) => t.kind === "size").map((t) => t.v));
    // "Lion No 5" is a brand name, not a size.
    const brand = toks.find((t) => t.kind === "word")?.v ?? "";
    return {
      ...it,
      words,
      sizes,
      brand,
      aliasKeys: new Set((it.aliases ?? []).map(aliasKey).filter(Boolean)),
      packKg: packKgFromSizes(sizes),
    };
  });
}

/** Numbers written right before a unit ("20 pkt") are quantities, never pack sizes. */
function qtyIndexes(toks: Tok[]): Set<number> {
  const out = new Set<number>();
  toks.forEach((t, i) => {
    if (t.kind === "num" && toks[i + 1]?.kind === "unit") out.add(i);
  });
  return out;
}

function score(item: Prepared, toks: Tok[]): number {
  let s = 0;
  const q = qtyIndexes(toks);
  const words = toks.filter((t) => t.kind === "word" && !STOP.has(t.v)).map((t) => t.v);
  const sizes = toks.filter((t) => t.kind === "size").map((t) => t.v);
  const nums = toks.filter((t, i) => t.kind === "num" && !q.has(i)).map((t) => t.v);
  for (const w of new Set(words)) {
    if (item.words.has(w)) s += w === item.brand ? 3 : PACKAGING.has(w) ? 0.5 : 1;
    else if (w.length >= 4 && [...item.words].some((iw) => iw.startsWith(w) || w.startsWith(iw))) s += 0.5;
  }
  for (const z of new Set(sizes)) if (item.sizes.has(z)) s += 2;
  // A bare "250" in the message can mean "250 g".
  for (const n of new Set(nums)) if (item.sizes.has(`${n}g`) || item.sizes.has(`rs${n}`) || item.sizes.has(`${n}l`) || item.sizes.has(`${n}ml`)) s += 1.5;
  // Item words the message didn't mention cost a little, so the plainest match wins.
  s -= 0.25 * [...item.words].filter((w) => !words.includes(w) && !PACKAGING.has(w)).length;
  // Item sizes not mentioned cost more (picks "Lion 250 Gm" over "Lion 1 Kg" for "lion 250").
  const mentioned = new Set([...sizes, ...nums.flatMap((n) => [`${n}g`, `rs${n}`, `${n}l`, `${n}ml`, `${n}kg`])]);
  s -= 0.75 * [...item.sizes].filter((z) => !mentioned.has(z)).length;
  return s;
}

function stripWhatsAppPrefix(line: string): { sender: string | null; text: string } {
  // "[21/10/26, 9:15:02 AM] Name: text" or "21/10/26, 9:15 am - Name: text"
  const m =
    /^\s*\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\]?\s*(?:-\s*)?([^:]{1,60}):\s*(.*)$/i.exec(line);
  return m ? { sender: m[1]!.trim(), text: m[2]! } : { sender: null, text: line };
}

/** Parse a message against the item list. */
export function parseOrderMessage(message: string, prepared: Prepared[]): ParsedMessage {
  let sender: string | null = null;
  const hints: string[] = [];
  const lines: ParsedLine[] = [];

  for (const rawLine of message.split(/\r?\n|,(?=\s*[a-zऀ-ॿ])/i)) {
    const { sender: s, text } = stripWhatsAppPrefix(rawLine);
    if (s && !sender) sender = s;
    const raw = text.trim().replace(/^[\d]+[.)]\s+(?=\D)/, ""); // "1) lion 250 5kg" → drop the list number
    if (!raw) continue;
    const toks = tokenize(raw);
    const hasNumber = toks.some((t) => t.kind === "num" || t.kind === "size");
    const key = aliasKey(raw);

    // Saved wording first.
    let ranked: { it: Prepared; s: number }[] = [];
    const byAlias = prepared.filter((p) => key && p.aliasKeys.has(key));
    if (byAlias.length === 1) ranked = [{ it: byAlias[0]!, s: 99 }];
    else
      ranked = prepared
        .map((it) => ({ it, s: score(it, toks) }))
        .filter((x) => x.s > 0.5)
        .sort((a, b) => b.s - a.s || (b.it.popularity ?? 0) - (a.it.popularity ?? 0));

    if (!hasNumber && (ranked.length === 0 || ranked[0]!.s < 3)) {
      hints.push(raw); // a name, greeting or note
      continue;
    }
    const best = ranked[0];
    const close = best && ranked[1] && ranked[1].s >= best.s - 0.5 && best.s !== 99;
    const confidence: ParsedLine["confidence"] = !best ? "none" : close || best.s < 3 ? "low" : "high";

    // Quantity: what is left once the matched item's sizes are taken out.
    let qty: number | null = null;
    let unitSaid: string | null = null;
    const used = new Set<number>();
    const q = qtyIndexes(toks);
    if (best) {
      toks.forEach((t, i) => {
        if (t.kind === "size" && best.it.sizes.has(t.v)) used.add(i);
        if (t.kind === "num" && !q.has(i) && (best.it.sizes.has(`${t.v}g`) || best.it.sizes.has(`rs${t.v}`) || best.it.sizes.has(`${t.v}l`) || best.it.sizes.has(`${t.v}ml`)))
          used.add(i);
      });
    }
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (used.has(i) || (t.kind !== "num" && t.kind !== "size") || t.n === undefined) continue;
      if (t.kind === "size" && !/kg$/.test(t.v)) continue; // "15l" left over is a size, not a quantity
      qty = t.n; // the last number wins
      const after = toks[i + 1];
      unitSaid = t.kind === "size" ? "kg" : after?.kind === "unit" ? after.v : null;
    }
    if (qty === null) {
      // Only one number and it was the size ("lion 250"), so no quantity was given.
      unitSaid = toks.find((t) => t.kind === "unit")?.v ?? null;
    }

    // Convert to the billing unit where the message unit differs.
    let note: string | null = null;
    if (best && qty !== null && unitSaid && unitSaid !== best.it.unit) {
      const it = best.it;
      if (it.unit === "kg" && (unitSaid === "pkt" || unitSaid === "pc") && it.packKg) {
        note = `${qty} ${unitSaid} × ${it.packKg * 1000} g = ${round3(qty * it.packKg)} kg`;
        qty = round3(qty * it.packKg);
      } else if (it.unit === "pkt" && unitSaid === "kg" && it.kgPerUnit > 0) {
        note = `${qty} kg ÷ ${it.kgPerUnit} kg per pkt — check`;
        qty = round3(qty / it.kgPerUnit);
      } else if (!(["box", "jar", "tin", "can"].includes(unitSaid) && ["box", "jar", "tin", "can"].includes(it.unit))) {
        note = `Message says ${unitSaid}, billed per ${it.unit} — check`;
      }
    }

    lines.push({
      raw,
      text: key,
      itemId: best?.it.id ?? null,
      candidates: ranked.slice(0, 4).map((r) => r.it.id),
      qty,
      unitSaid,
      note,
      confidence: qty === null && confidence === "high" ? "low" : confidence,
    });
  }
  return { sender, customerHint: hints[0] ?? sender, lines };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
