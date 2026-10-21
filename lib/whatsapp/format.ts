// Turns a message's raw data into the template's {{n}} values.

const MONEY = new Set(["amount", "outstanding", "overdue"]);
const DATES = new Set(["date", "promise_date"]);
const MODE_MR: Record<string, string> = { cash: "रोख", upi: "UPI", cheque: "चेक", bank: "बँक" };

/** 1,23,456 or 1,23,456.50 — Indian grouping, no decimals when whole. */
export function rupeesPlain(v: unknown): string {
  const n = Number(v ?? 0);
  const [int, dec] = Math.abs(n).toFixed(2).split(".") as [string, string];
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${rest},${last3}` : last3;
  return (n < 0 ? "-" : "") + grouped + (dec === "00" ? "" : `.${dec}`);
}

export function dateDMY(v: unknown): string {
  const s = String(v ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

export function templateValues(params: string[], data: Record<string, unknown>, appUrl: string): string[] {
  return params.map((p) => {
    if (p === "link") return `${appUrl}/r/${String(data.token ?? "")}`;
    const v = data[p];
    if (MONEY.has(p)) return rupeesPlain(v);
    if (DATES.has(p)) return dateDMY(v);
    if (p === "mode") return MODE_MR[String(v)] ?? String(v ?? "");
    return String(v ?? "");
  });
}
