// Journey Cycles: 13 per financial year. JC1 starts 1 April; each JC is
// 28 days; JC13 absorbs the remainder up to 31 March (29 days, or 30 in a
// leap FY). Mirrors public.generate_journey_cycles() in the database — the
// DB is the source of truth, this copy exists for client-side labelling.

export const JC_DAYS = 28;
export const JCS_PER_YEAR = 13;

export type JourneyCycle = {
  fyStartYear: number;
  fyLabel: string; // "26-27"
  jcNumber: number; // 1..13
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD inclusive
  days: number;
};

function toUTC(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((toUTC(end).getTime() - toUTC(start).getTime()) / 86_400_000) + 1;
}

export function fyLabel(fyStartYear: number): string {
  const a = String(fyStartYear % 100).padStart(2, "0");
  const b = String((fyStartYear + 1) % 100).padStart(2, "0");
  return `${a}-${b}`;
}

/** FY start year for a business date: 2026-10-20 → 2026, 2027-02-01 → 2026. */
export function fyStartYearFor(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m! >= 4 ? y! : y! - 1;
}

export function generateJourneyCycles(fyStartYear: number): JourneyCycle[] {
  const fyStart = `${fyStartYear}-04-01`;
  const fyEnd = `${fyStartYear + 1}-03-31`;
  const out: JourneyCycle[] = [];
  for (let n = 1; n <= JCS_PER_YEAR; n++) {
    const startDate = addDays(fyStart, (n - 1) * JC_DAYS);
    const endDate = n === JCS_PER_YEAR ? fyEnd : addDays(startDate, JC_DAYS - 1);
    out.push({
      fyStartYear,
      fyLabel: fyLabel(fyStartYear),
      jcNumber: n,
      startDate,
      endDate,
      days: daysBetweenInclusive(startDate, endDate),
    });
  }
  return out;
}

export function journeyCycleFor(date: string): JourneyCycle {
  const jcs = generateJourneyCycles(fyStartYearFor(date));
  const jc = jcs.find((j) => j.startDate <= date && date <= j.endDate);
  if (!jc) throw new Error(`No JC for ${date}`);
  return jc;
}

/** Day number within its JC, 1-based. */
export function jcDay(date: string): number {
  return daysBetweenInclusive(journeyCycleFor(date).startDate, date);
}
