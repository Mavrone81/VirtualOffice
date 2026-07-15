import type { ZodType } from "zod";

// Generic input-validation gate for server actions. Never throws — a schema
// mismatch is logged (flattened, so PII values aren't dumped verbatim) and
// the caller maps the {ok:false} result to an i18n error (t("invalidInput")).
export function validate<T>(schema: ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false } {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  console.warn("[validate] input rejected:", JSON.stringify(r.error.flatten().fieldErrors));
  return { ok: false };
}
