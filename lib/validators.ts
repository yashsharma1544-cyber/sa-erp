import { z } from "zod";

/** Optional decimal typed as text, e.g. "12.500". Empty → null. Never converted to a float. */
export const optionalDecimal = (label: string, places = 3) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^(\\d{1,12}(\\.\\d{1,${places}})?)?$`), `${label} must be a number with up to ${places} decimals`)
    .transform((s) => (s === "" ? null : s));

export const requiredDecimal = (label: string, places = 3) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${places}})?$`), `${label} must be a number with up to ${places} decimals`);

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s));

export const optionalMobile = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, "").replace(/^\+/, ""))
  .refine((s) => s === "" || /^[0-9]{10,13}$/.test(s), "Phone/WhatsApp must be 10–13 digits")
  .transform((s) => (s === "" ? null : s));

export const optionalGstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((s) => s === "" || /^[0-9]{2}[A-Z0-9]{13}$/.test(s), "GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5")
  .transform((s) => (s === "" ? null : s));
