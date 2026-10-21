// Order line arithmetic, the same way create_order() does it in the database:
// taxable = round(qty × rate, 2); GST = round(taxable × gst% / 100, 2), only
// for a GST-registered firm. The database result is the one that counts; this
// copy is for the on-screen preview.

/** Round half away from zero to `places`, like Postgres round(numeric). */
export function roundHalfUp(value: number, places = 2): number {
  const f = 10 ** places;
  const scaled = Math.abs(value) * f;
  // Nudge by a relative epsilon so 1.005 × 100 = 100.49999… still rounds up.
  const r = Math.round(scaled * (1 + Number.EPSILON * 4)) / f;
  return value < 0 ? -r : r;
}

export type LineInput = { qty: number; rate: number; listRate: number | null; gstRate: number; kgPerUnit: number };
export type LineTotals = { taxable: number; gst: number; amount: number; kg: number; discount: number };

export function lineTotals(l: LineInput, gstFirm: boolean): LineTotals {
  const qty = roundHalfUp(l.qty, 3);
  const rate = roundHalfUp(l.rate, 4);
  const taxable = roundHalfUp(qty * rate, 2);
  const gst = gstFirm ? roundHalfUp((taxable * l.gstRate) / 100, 2) : 0;
  const discount = l.listRate !== null && rate < l.listRate ? roundHalfUp(qty * (l.listRate - rate), 2) : 0;
  return { taxable, gst, amount: roundHalfUp(taxable + gst, 2), kg: roundHalfUp(qty * l.kgPerUnit, 3), discount };
}

export function orderTotals(lines: LineInput[], gstFirm: boolean): LineTotals {
  return lines.reduce<LineTotals>(
    (t, l) => {
      const x = lineTotals(l, gstFirm);
      return {
        taxable: roundHalfUp(t.taxable + x.taxable, 2),
        gst: roundHalfUp(t.gst + x.gst, 2),
        amount: roundHalfUp(t.amount + x.amount, 2),
        kg: roundHalfUp(t.kg + x.kg, 3),
        discount: roundHalfUp(t.discount + x.discount, 2),
      };
    },
    { taxable: 0, gst: 0, amount: 0, kg: 0, discount: 0 },
  );
}
