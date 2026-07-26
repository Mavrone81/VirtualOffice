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
    { status: "ok", uptime: Math.round(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
