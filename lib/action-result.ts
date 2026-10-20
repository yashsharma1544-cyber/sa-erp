export type ActionResult = { error?: string; ok?: string };

/** Turn a Supabase/Postgres error into a sentence for the user. */
export function friendlyError(error: { code?: string; message: string } | null | undefined): string | undefined {
  if (!error) return undefined;
  if (error.code === "23505") return "That name already exists.";
  if (error.code === "23514") return "Some values are not valid. Check the highlighted fields.";
  if (error.code === "42501") return error.message.includes("row-level security") ? "You are not allowed to do this." : error.message;
  return error.message;
}
