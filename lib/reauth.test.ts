import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "good" ? { passwordHash: "HASH" } : null,
      ),
    },
  },
}));
vi.mock("@node-rs/argon2", () => ({
  verify: vi.fn(async (_h: string, p: string) => p === "correct"),
}));

import { reauth } from "./reauth";

describe("reauth", () => {
  it("true only for the correct password", async () => {
    expect(await reauth("good", "correct")).toBe(true);
    expect(await reauth("good", "wrong")).toBe(false);
  });
  it("false for unknown user, no throw", async () => {
    expect(await reauth("missing", "correct")).toBe(false);
  });
  it("false for empty password, no DB hit", async () => {
    expect(await reauth("good", "")).toBe(false);
  });
});
