import { auditOk } from "@/lib/audit-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness probe for the container HEALTHCHECK (see Dockerfile) — deliberately
// does NOT touch the database. Docker's restart policy acts on this, and
// restarting the app cannot fix a database outage; a DB-dependent probe would
// turn a DB blip into an app restart loop. `depends_on: db: service_healthy`
// already covers start-up ordering, and the db service has its own pg_isready
// healthcheck. Public by construction: middleware.ts excludes /api.
export async function GET() {
  return Response.json(
    // auditOk: no best-effort audit write has failed since this process booted
    // (a boolean only — the endpoint is public; the count is in the logs).
    // F7 `sha`: the commit this image was built from, so a post-deploy check can
    // compare the RUNNING container against `main`. Production silently running an
    // older build than main is otherwise invisible — every check stays green.
    // 🔴 Deliberately the commit sha and NOTHING else. This endpoint is public
    // (middleware.ts excludes /api), so no build host, no branch, no env, no paths:
    // a commit sha for a public repo discloses nothing a reader cannot already
    // fetch, and anything else here would.
    { status: "ok", uptime: Math.round(process.uptime()), auditOk: auditOk(), sha: process.env.BUILD_SHA ?? "unknown" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
