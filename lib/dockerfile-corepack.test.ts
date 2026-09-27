import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const root = (p: string) => join(process.cwd(), p);

// Why this test exists.
//
// The Dockerfile's `migrator` stage materialises pnpm into the image with
// `RUN corepack install`, so its CMD (`pnpm prisma migrate deploy`) runs with no
// network. Corepack stores that under $COREPACK_HOME, defaulting to
// `$HOME/.cache` — which is `/root/.cache` only because the stage has no `USER`
// directive and therefore runs as root.
//
// So `RUN corepack install` works by accident of the stage being root. Add a
// non-root `USER` to migrator — an obvious hardening, which `tools` and `runner`
// both already have — and the new user cannot read root's cache: corepack goes
// back to downloading pnpm from the npm registry when the container starts, on
// the droplet, during every deploy's migrate step. Verified: with a non-root
// USER and no COREPACK_HOME, `docker run --network none --entrypoint pnpm
// <migrator> --version` exits 1 with "Corepack is about to download …"; adding
// `ENV COREPACK_HOME=/opt/corepack` and a world-readable chmod makes it print
// 9.15.0 as that user. **The image builds green either way**, which is why no
// build-based check can see it (DevSecOps + DevLead, 2026-09-27).
//
// SCOPE, and why it is not "migrator must not have a USER": the rule is about
// stages that invoke pnpm AT RUNTIME. `tools` (ENTRYPOINT tsx) and `runner`
// (CMD node) both run as non-root and are correctly unaffected — they never
// call pnpm after the build. So the invariant is: a stage whose runtime
// entrypoint invokes pnpm, and which drops to a non-root user, must set
// COREPACK_HOME.
//
// LIMIT, stated plainly: this reads the Dockerfile as TEXT. It proves the
// directive is present, not that the path is readable by that user — a
// COREPACK_HOME pointing somewhere unreadable would pass. The behavioural check
// is `docker run --network none --entrypoint pnpm <image> --version`, which
// needs an image build and belongs in the image-building CI job.

type Stage = {
  name: string;
  user: boolean;
  corepackHome: boolean;
  runtimePnpm: boolean;
  corepackHomePath: string | null;
  corepackHomeReadable: boolean;
};

// 🔴 `FROM <stage>` INHERITS `USER`, `ENV`, `CMD` and `ENTRYPOINT` from its
// parent. A parser that starts every stage from `false` therefore has a false
// NEGATIVE on the most likely shape of the change this guard exists to catch
// (DevLead, 2026-09-27): a hardening sweep leaves the working `migrator` alone
// and layers `FROM migrator AS migrator-nonroot` + `USER mig` on top. The CMD is
// inherited, so `migrator` looks like {runtimePnpm, no user} and the new stage
// looks like {user, no runtimePnpm} — each half innocent, the guard clean, and
// the image genuinely broken in exactly the way whose offline probe exits 1.
// So each stage is SEEDED from its parent's resolved facts.
// A Dockerfile instruction can span lines with a trailing `\`. Parsing raw lines
// therefore misreads three real shapes (DevLead, 2026-09-27), all confirmed
// against the committed parser rather than reasoned about:
//   G  `ENV NODE_ENV=production \` + `COREPACK_HOME=/opt/corepack` -> FALSE
//      POSITIVE on a correctly configured stage. Ordinary Dockerfile style, and
//      the failure mode that gets a gate switched off.
//   H  `ENTRYPOINT ["/bin/sh","-c", \` + `"pnpm …"]` -> FALSE NEGATIVE on a
//      genuinely broken image.
//   J  `HEALTHCHECK --interval=30s \` + `  CMD [...]` -> the continuation line
//      trims to `CMD [...]` and is recorded as the STAGE's runtime command,
//      overwriting the real one. 🔴 This is live in this repo's `runner` stage
//      today (lines 80-81): harmless only because the HEALTHCHECK precedes
//      `CMD ["node","server.js"]` and neither mentions pnpm. Reorder them —
//      legal — and a HEALTHCHECK silently zeroes a genuine pnpm CMD.
// Joining continuations first fixes G and H, and makes J fall out for free: the
// joined instruction starts with HEALTHCHECK, so skipping HEALTHCHECK is enough.
export function logicalLines(dockerfile: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const raw of dockerfile.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (buf === "" && /^\s*#/.test(line)) continue; // whole-line comment
    const continues = /\\\s*$/.test(line);
    buf += (buf === "" ? "" : " ") + line.replace(/\\\s*$/, "").trim();
    if (!continues) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf !== "") out.push(buf.trim());
  return out;
}

export function parseStages(dockerfile: string): Stage[] {
  const stages: Stage[] = [];
  const byName = new Map<string, Stage>();
  let cur: Stage | null = null;
  for (const line of logicalLines(dockerfile)) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      const parent = byName.get(from[1]);
      cur = {
        name: from[2] ?? `<unnamed:${stages.length}>`,
        user: parent?.user ?? false,
        corepackHome: parent?.corepackHome ?? false,
        runtimePnpm: parent?.runtimePnpm ?? false,
        // Inherited too: a path set or made readable in a parent layer persists.
        corepackHomePath: parent?.corepackHomePath ?? null,
        corepackHomeReadable: parent?.corepackHomeReadable ?? false,
      };
      stages.push(cur);
      if (from[2]) byName.set(from[2], cur);
      continue;
    }
    if (!cur) continue;
    // A HEALTHCHECK's own CMD is not the stage's runtime command.
    if (/^HEALTHCHECK\b/i.test(line)) continue;
    const user = /^USER\s+(\S+)/i.exec(line);
    if (user) {
      const uid = user[1].split(":")[0].replace(/^["']|["']$/g, "");
      cur.user = !(uid === "root" || uid === "0");
    }
    const envHome = /^ENV\s+(?:\S+=\S*\s+)*COREPACK_HOME[=\s]+(\S+)/i.exec(line);
    if (envHome) {
      cur.corepackHome = true;
      cur.corepackHomePath = envHome[1].replace(/^["']|["']$/g, "");
    }
    if (cur.corepackHomePath && /\bchmod\b/.test(line) && line.includes(cur.corepackHomePath)) {
      cur.corepackHomeReadable = true;
    }
    const rt = /^(?:CMD|ENTRYPOINT)\s+(.*)$/i.exec(line);
    if (rt) cur.runtimePnpm = /(^|[\s"'[/])pnpm([\s"',\]]|$)/.test(rt[1]);
  }
  return stages;
}

export function corepackViolations(dockerfile: string): string[] {
  return parseStages(dockerfile)
    .filter((s) => s.runtimePnpm && s.user && !s.corepackHome)
    .map((s) => s.name);
}

/**
 * ARM 2 — the UNCONDITIONAL requirement on the migrator stage.
 *
 * The conditional rule above generalises (it catches any future stage that runs
 * pnpm as non-root), but its precondition is FALSE in the tree we ship, because
 * migrator has no USER today. On its own it would pass vacuously on every real
 * run. This arm gives the check teeth NOW — delete the ENV line and it goes red
 * today — and makes the USER trap impossible by construction rather than merely
 * watched for. Both arms together: teeth today, and coverage of a stage nobody
 * has written yet. (DevLead + DevSecOps, 2026-09-27.)
 */
export function corepackDefects(dockerfile: string): string[] {
  const migrator = parseStages(dockerfile).find((x) => x.name === "migrator");
  if (!migrator) return ["no migrator stage found"];
  const defects: string[] = [];
  if (!migrator.corepackHome || !migrator.corepackHomePath) {
    defects.push("migrator: no ENV COREPACK_HOME");
    return defects;
  }
  const path = migrator.corepackHomePath;
  if (/^\/root(\/|$)/.test(path) || path === "~" || path.startsWith("~/")) {
    defects.push(`migrator: COREPACK_HOME is inside root's home (${path})`);
  }
  if (!migrator.corepackHomeReadable) {
    defects.push(`migrator: COREPACK_HOME (${path}) is never made world-readable`);
  }
  return defects;
}

describe("Dockerfile: a non-root stage that runs pnpm must set COREPACK_HOME", () => {
  it("the real Dockerfile has no such stage", () => {
    expect(corepackViolations(readFileSync(root("Dockerfile"), "utf8"))).toEqual([]);
  });

  it("flags a pnpm-CMD stage that drops to a non-root user without COREPACK_HOME", () => {
    expect(
      corepackViolations(
        'FROM base AS migrator\nRUN corepack install\nUSER mig\nCMD ["pnpm", "prisma", "migrate", "deploy"]\n',
      ),
    ).toEqual(["migrator"]);
  });

  it("accepts the same stage once COREPACK_HOME is set", () => {
    expect(
      corepackViolations(
        'FROM base AS migrator\nENV COREPACK_HOME=/opt/corepack\nRUN corepack install\nUSER mig\nCMD ["pnpm", "prisma", "migrate", "deploy"]\n',
      ),
    ).toEqual([]);
  });

  it("does not flag a non-root stage whose entrypoint is not pnpm (the tools/runner shape)", () => {
    expect(
      corepackViolations(
        'FROM base AS tools\nUSER tools\nENTRYPOINT ["node_modules/.bin/tsx"]\n' +
          'FROM base AS runner\nUSER nextjs\nCMD ["node", "server.js"]\n',
      ),
    ).toEqual([]);
  });

  it("does not flag a pnpm-CMD stage that stays root (the migrator shape today)", () => {
    expect(
      corepackViolations('FROM base AS migrator\nRUN corepack install\nCMD ["pnpm", "prisma", "migrate", "deploy"]\n'),
    ).toEqual([]);
  });

  it("treats an explicit `USER root` as still root", () => {
    expect(
      corepackViolations('FROM base AS migrator\nUSER root\nCMD ["pnpm", "prisma", "migrate", "deploy"]\n'),
    ).toEqual([]);
  });

  it("catches the shell form of CMD too", () => {
    expect(corepackViolations("FROM base AS m\nUSER mig\nCMD pnpm prisma migrate deploy\n")).toEqual(["m"]);
  });

  // DevLead's probe table, all six cases, as fixtures — an inheritance bug
  // reintroduced later would otherwise be silent again.
  it("A: USER in the base stage, inherited by migrator -> flagged", () => {
    expect(
      corepackViolations(
        'FROM node:22-alpine AS base\nUSER mig\nFROM base AS migrator\nRUN corepack install\nCMD ["pnpm", "prisma", "migrate", "deploy"]\n',
      ),
    ).toEqual(["migrator"]);
  });

  it("B: a non-root stage layered ON TOP of migrator, CMD inherited -> flagged (the primary case)", () => {
    expect(
      corepackViolations(
        'FROM base AS migrator\nRUN corepack install\nCMD ["pnpm", "prisma", "migrate", "deploy"]\n' +
          "FROM migrator AS migrator-nonroot\nUSER mig\n",
      ),
    ).toEqual(["migrator-nonroot"]);
  });

  it("B is clean once the parent sets COREPACK_HOME — inheritance works both ways", () => {
    expect(
      corepackViolations(
        'FROM base AS migrator\nENV COREPACK_HOME=/opt/corepack\nRUN corepack install\nCMD ["pnpm"]\n' +
          "FROM migrator AS migrator-nonroot\nUSER mig\n",
      ),
    ).toEqual([]);
  });

  it("C: ENV COREPACK_HOME in the base stage is inherited -> not flagged", () => {
    expect(
      corepackViolations(
        "FROM node:22-alpine AS base\nENV COREPACK_HOME=/opt/corepack\nFROM base AS migrator\nUSER mig\nCMD [\"pnpm\"]\n",
      ),
    ).toEqual([]);
  });

  it("D: USER 0:0 is still root -> not flagged", () => {
    expect(corepackViolations('FROM base AS m\nUSER 0:0\nCMD ["pnpm"]\n')).toEqual([]);
  });

  it("E: COREPACK_HOME not first on the ENV line is still recognised", () => {
    expect(
      corepackViolations('FROM base AS m\nENV NODE_ENV=production COREPACK_HOME=/opt/corepack\nUSER mig\nCMD ["pnpm"]\n'),
    ).toEqual([]);
  });

  it("a later USER root in the same stage cancels an earlier non-root USER", () => {
    expect(corepackViolations('FROM base AS m\nUSER mig\nUSER root\nCMD ["pnpm"]\n')).toEqual([]);
  });

  // G / H / J — the continuation-parsing cases (DevLead's probe table, round 2).
  it("G: a multi-line ENV carrying COREPACK_HOME is recognised (was a false positive)", () => {
    expect(
      corepackViolations(
        'FROM base AS m\nENV NODE_ENV=production \\\n    COREPACK_HOME=/opt/corepack\nUSER mig\nCMD ["pnpm", "x"]\n',
      ),
    ).toEqual([]);
  });

  it("H: a multi-line ENTRYPOINT that reaches pnpm is caught (was a false negative)", () => {
    expect(
      corepackViolations('FROM base AS m\nUSER mig\nENTRYPOINT ["/bin/sh","-c", \\\n  "pnpm prisma migrate deploy"]\n'),
    ).toEqual(["m"]);
  });

  it("J: a HEALTHCHECK's continued CMD is not mistaken for the stage's (live in this repo's runner)", () => {
    expect(
      corepackViolations(
        'FROM base AS migrator\nUSER mig\nCMD ["pnpm", "prisma", "migrate", "deploy"]\n' +
          'HEALTHCHECK --interval=30s --timeout=5s \\\n  CMD ["node", "-e", "fetch(1)"]\n',
      ),
    ).toEqual(["migrator"]);
  });

  it("J-reordered: a HEALTHCHECK BEFORE the real CMD also does not zero it", () => {
    expect(
      corepackViolations(
        'FROM base AS migrator\nUSER mig\nHEALTHCHECK --interval=30s \\\n  CMD ["node","-e","1"]\n' +
          'CMD ["pnpm", "prisma", "migrate", "deploy"]\n',
      ),
    ).toEqual(["migrator"]);
  });

  it("the real Dockerfile's runner stage is read correctly despite its HEALTHCHECK", () => {
    const runner = parseStages(readFileSync(root("Dockerfile"), "utf8")).find((x) => x.name === "runner");
    expect(runner?.runtimePnpm).toBe(false); // CMD ["node","server.js"], not the HEALTHCHECK's
  });
});

describe("Dockerfile migrator: COREPACK_HOME is required unconditionally", () => {
  const real = () => readFileSync(root("Dockerfile"), "utf8");

  it("the real Dockerfile sets it outside root's home and makes it readable", () => {
    expect(corepackDefects(real())).toEqual([]);
  });

  it("goes red if the ENV line is removed — teeth on today's tree", () => {
    expect(corepackDefects(real().replace(/^\s*ENV\s+COREPACK_HOME.*$/im, ""))).toEqual([
      "migrator: no ENV COREPACK_HOME",
    ]);
  });

  it("goes red if the store is never made world-readable", () => {
    expect(
      corepackDefects('FROM base AS migrator\nENV COREPACK_HOME=/opt/corepack\nRUN corepack install\nCMD ["pnpm"]\n'),
    ).toEqual(["migrator: COREPACK_HOME (/opt/corepack) is never made world-readable"]);
  });

  it("goes red if COREPACK_HOME points inside root's home", () => {
    expect(
      corepackDefects('FROM base AS migrator\nENV COREPACK_HOME=/root/.cache/cp\nRUN chmod -R a+rX /root/.cache/cp\nCMD ["pnpm"]\n'),
    ).toContain("migrator: COREPACK_HOME is inside root's home (/root/.cache/cp)");
  });

  it("accepts a path set and chmodded across a stage boundary (inheritance)", () => {
    expect(
      corepackDefects(
        "FROM node:22-alpine AS base\nENV COREPACK_HOME=/opt/corepack\nRUN corepack install && chmod -R a+rX /opt/corepack\n" +
          'FROM base AS migrator\nCMD ["pnpm"]\n',
      ),
    ).toEqual([]);
  });
});
