import { dec, type DecimalInput } from "./money";

export const IST_TIMEZONE = "Asia/Kolkata";

/** Indian digit grouping on a plain digit string: 1234567 → 12,34,567. */
function groupIndian(intDigits: string): string {
  if (intDigits.length <= 3) return intDigits;
  const last3 = intDigits.slice(-3);
  const rest = intDigits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

function formatGrouped(value: DecimalInput, decimals: number, trimZeros: boolean): string {
  const d = dec(value);
  const negative = d.isNegative() && !d.isZero();
  let fixed = d.abs().toFixed(decimals);
  if (trimZeros && fixed.includes(".")) fixed = fixed.replace(/\.?0+$/, "");
  const [intPart = "0", fracPart] = fixed.split(".");
  const body = groupIndian(intPart) + (fracPart ? "." + fracPart : "");
  return (negative ? "-" : "") + body;
}

/** ₹12,34,567.00 — always full digits, never lakh/crore shorthand. */
export function formatINR(value: DecimalInput | null | undefined): string {
  const s = formatGrouped(value ?? 0, 2, false);
  return s.startsWith("-") ? "-₹" + s.slice(1) : "₹" + s;
}

/** 1,23,456 kg / 12.5 kg — up to 3 decimals, trailing zeros dropped. */
export function formatKg(value: DecimalInput | null | undefined): string {
  return formatGrouped(value ?? 0, 3, true) + " kg";
}

/** Plain Indian-grouped number, e.g. counts and quantities. */
export function formatNumber(value: DecimalInput | null | undefined, decimals = 0): string {
  return formatGrouped(value ?? 0, decimals, decimals > 0);
}

/** Today's business date in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 20 Oct 2026 — for a business date (YYYY-MM-DD) or a timestamp. */
export function formatDate(value: string | Date): string {
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + "T00:00:00+05:30")
    : new Date(value);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** 20 Oct 2026, 04:35 pm IST */
export function formatDateTime(value: string | Date): string {
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: IST_TIMEZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(value)) + " IST"
  );
}
