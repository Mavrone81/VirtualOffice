// Item 9 (owner: "admin must be able to submit product also with the same
// flow as the rest"). This is the ONE piece of the equivalence proof that
// doesn't need a real database — see admin-submit-equivalence.integration.test.ts
// for the full row/ledger/queue equivalence, which does.
//
// AD's diagnosis: submitSale's ONLY gate is `session.user.associateId` — no
// role check anywhere (server/sales/actions.ts). This proves exactly that,
// directly against the real function, without touching Prisma: valid,
// split-free input clears validation and the associateId gate with no DB
// call at all (splitPartiesError short-circuits with no split partners, so
// the first real DB touch is the Promise.all right after the gate) — so a
// Proxy that throws on any property access stands in for Prisma. Reaching
// that throw proves execution got PAST the gate; getting `noAssociateProfile`
// back without a throw proves it did NOT.
import { describe, it, expect, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/lib/db", () => ({
  prisma: new Proxy({}, { get() { throw new Error("DB_TOUCHED_PAST_GATE"); } }),
}));
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { submitSale } from "./actions";

// Valid per lib/schemas.ts saleSchema (one line, no splits) — the shape
// doesn't need to resolve to a real product for structural validation to
// pass; nothing below the gate runs far enough to look it up.
const VALID_INPUT = {
  salesDate: "2099-01-01",
  clientName: "Gate Test Client",
  paymentPlan: "Full Payment" as const,
  lines: [{ productId: "11111111-1111-1111-1111-111111111111", lineSaleAmount: 1000, comCodeIds: [] }],
};

describe("submitSale's gate is associateId, never AppRole (item 9 routing fix)", () => {
  it("an Admin-role session WITH an associateId clears the gate and reaches the database, exactly like any other role", async () => {
    who.session = { user: { associateId: "a1", role: "Admin" } };
    await expect(submitSale(VALID_INPUT)).rejects.toThrow("DB_TOUCHED_PAST_GATE");
  });

  it("baseline: a SalesAssociate-role session with an associateId reaches the database the same way", async () => {
    who.session = { user: { associateId: "a1", role: "SalesAssociate" } };
    await expect(submitSale(VALID_INPUT)).rejects.toThrow("DB_TOUCHED_PAST_GATE");
  });

  it("an Admin-role session WITHOUT an associateId is refused at the gate itself — being Admin never substitutes for having an associate profile", async () => {
    who.session = { user: { associateId: null, role: "Admin" } };
    await expect(submitSale(VALID_INPUT)).resolves.toEqual({ ok: false, error: "noAssociateProfile" });
  });

  it("control: no session at all is refused the same way", async () => {
    who.session = null;
    await expect(submitSale(VALID_INPUT)).resolves.toEqual({ ok: false, error: "noAssociateProfile" });
  });
});
