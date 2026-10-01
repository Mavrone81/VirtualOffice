import { z } from "zod";
import { envSchema } from "./env-schema";

export { envSchema };

/** Render zod's issues as one line per variable, e.g. `AUTH_SECRET: Required`.
 *
 *  🔴 This exists because the previous `console.error("…", z.treeifyError(err))` printed
 *  `{ errors: [], properties: { AUTH_SECRET: { errors: [Array] } } }` — console's depth limit
 *  elides the messages as `[Array]`, so the one piece of information the reader needs (which
 *  variable, and why) was exactly the piece that got dropped. A diagnostic that hides its own
 *  finding is worse than none, because it still looks like it reported.
 */
export function formatEnvIssues(error: z.ZodError): string[] {
  const byPath = new Map<string, string[]>();
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "(root)";
    const list = byPath.get(key) ?? [];
    list.push(issue.message);
    byPath.set(key, list);
  }
  return [...byPath.entries()].map(([key, msgs]) => `${key}: ${msgs.join("; ")}`).sort();
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const lines = formatEnvIssues(parsed.error);
  console.error("Invalid environment variables:");
  for (const line of lines) console.error(`  - ${line}`);
  throw new Error(`Invalid environment configuration (${lines.length}): ${lines.join(" | ")}`);
}

export const env = parsed.data;
