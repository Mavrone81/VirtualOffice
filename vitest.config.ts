import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// M5-CF exposed a real gap: integration tests share one throwaway Postgres and
// relied on each file picking a different literal month for isolation. CF's
// cross-month queries (payoutMonth <= M) don't respect that convention — a run in
// one file can now see another file's fixtures at an earlier month. Rather than
// try to keep every file's month range non-overlapping forever, run integration
// tests sequentially (one file at a time); unit tests still run in parallel.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["server/**/*.test.ts", "lib/**/*.test.ts"],
          exclude: ["server/**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["server/**/*.integration.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
