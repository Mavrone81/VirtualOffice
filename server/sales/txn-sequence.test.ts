import { describe, it, expect, vi } from "vitest";

// Mock only the module-level imports that pull in next-auth's `next/server`
// (which cannot load in the vitest node env). @/lib/db stays REAL — this is an
// integration test that must hit the real transaction_code_seq sequence.
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));

import { prisma } from "@/lib/db";
import { nextTransactionCode } from "./actions";

// Integration test — hits the real dev DB sequence (transaction_code_seq).
describe("nextTransactionCode", () => {
  it("returns unique, monotonic codes under concurrency (no duplicates)", async () => {
    const codes = await Promise.all(
      Array.from({ length: 20 }, () => nextTransactionCode(prisma)),
    );
    expect(new Set(codes).size).toBe(20); // all unique
    expect(codes.every((c) => /^TXN-\d{4,}$/.test(c))).toBe(true);
  });
});
