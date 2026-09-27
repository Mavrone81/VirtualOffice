import type { ZodType } from "zod";

// Generic input-validation gate for server actions. Never throws — a schema
// mismatch is logged (flattened, so PII values aren't dumped verbatim) and
// the caller maps the {ok:false} result to an i18n error (t("invalidInput")).
//
// A refinement may set its message to an i18n error key (camelCase, e.g.
// "splitPercentTooHigh"); the first such key is returned as `code` so callers
// can show a specific message instead of the generic one.
export function validate<T>(schema: ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false; code?: string } {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  console.warn("[validate] input rejected:", JSON.stringify(r.error.flatten().fieldErrors));
  const code = r.error.issues.map((i) => i.message).find((m) => /^[a-z][A-Za-z]+$/.test(m));
  return code ? { ok: false, code } : { ok: false };
}
