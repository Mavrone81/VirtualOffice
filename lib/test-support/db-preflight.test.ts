import { describe, it, expect, vi, afterEach } from "vitest";
import dbPreflight from "./db-preflight";

// Nothing listens on port 1 (privileged, unassigned) on loopback — connection refusal is
// immediate, no real database involved. This exercises exactly the path a developer hits
// with no Postgres running: dbPreflight must reject, naming the host:port it tried, not
// resolve and not hang. Examines exactly ONE case (one dead address, one connection attempt)
// — this is a control-flow test, not a data test, so there is no fixture-row count to report.
const DEAD_DATABASE_URL = "postgresql://nouser:nopass@127.0.0.1:1/nodb";

describe("dbPreflight", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects, naming the unreachable host:port, instead of resolving or hanging", async () => {
    vi.stubEnv("DATABASE_URL", DEAD_DATABASE_URL);
    await expect(dbPreflight()).rejects.toThrow(
      /Database preflight failed: could not reach Postgres at 127\.0\.0\.1:1/,
    );
  }, 15_000);
});
