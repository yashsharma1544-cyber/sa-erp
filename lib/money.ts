import Decimal from "decimal.js";

// Money and kg never touch JS floats in calculations. Values from Postgres
// numeric arrive as strings; keep them as Decimal until display.
export type DecimalInput = Decimal.Value;

export function dec(value: DecimalInput | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(value);
}

export function sum(values: Array<DecimalInput | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

export { Decimal };
