export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function routeLabel(kind: string, weekday: number | null): string {
  if (kind === "counter") return "Counter (walk-in)";
  if (kind === "city") return "City · same/next day";
  return weekday === null ? "Outstation" : `Outstation · ${WEEKDAYS[weekday]}`;
}
