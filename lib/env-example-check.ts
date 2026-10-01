import { envSchema } from "./env-schema";

/** Does a FRESH COPY of .env.example satisfy the environment contract, and if not, which
 *  variables are still unset?
 *
 *  Pure: no filesystem, no process.env, no exit. The caller supplies the file's text. That is
 *  what lets `scripts/check-env-example.mjs` and the drift test share ONE implementation —
 *  a second copy of the parse or the key list would drift from the first, which is precisely
 *  the class of bug this module exists to catch.
 *
 *  🔴 It imports the schema from ./env-schema, which has no import-time side effect. It must
 *  never import ./env, because that validates process.env and throws — a checker that cannot
 *  load when the environment is broken is useless exactly when it is needed.
 */

export type EnvExampleReport = {
  /** keys with an actual value — a commented-out key is an ABSENT key, deliberately */
  parsedKeys: string[];
  /** keys present in the file but commented out, so documented yet not supplied */
  commentedKeys: string[];
  /** variable names a fresh copy still fails on, with the reason, sorted */
  unsatisfied: string[];
  bytesRead: number;
};

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    const value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    out[key] = quoted ? value.slice(1, -1) : value;
  }
  return out;
}

export function commentedKeysIn(text: string): string[] {
  return (text.match(/^\s*#\s*([A-Z0-9_]+)=/gm) ?? [])
    .map((m) => m.replace(/^\s*#\s*/, "").replace(/=$/, ""))
    .sort();
}

export function checkEnvExample(text: string): EnvExampleReport {
  const env = parseDotenv(text);
  const parsed = envSchema.safeParse(env);
  const byPath = new Map<string, string[]>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.length ? issue.path.join(".") : "(root)";
      byPath.set(key, [...(byPath.get(key) ?? []), issue.message]);
    }
  }
  return {
    parsedKeys: Object.keys(env).sort(),
    commentedKeys: commentedKeysIn(text),
    unsatisfied: [...byPath.entries()].map(([k, v]) => `${k}: ${v.join("; ")}`).sort(),
    bytesRead: text.length,
  };
}

/** Just the variable names, without the reasons — what a test wants to assert on. */
export function unsatisfiedNames(text: string): string[] {
  return checkEnvExample(text)
    .unsatisfied.map((l) => l.split(":")[0])
    .sort();
}
