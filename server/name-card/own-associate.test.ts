import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The resolution that decides whether a name card shows a designation or falls
 * back to the app role label. It had no test, and the failure it allows is
 * silent: the card renders perfectly, just with "Product Owner" where
 * "Funeral Director" belongs (owner, 2026-10-07).
 */
const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { associate: { findUnique: h.findUnique, findFirst: h.findFirst } } }));

import { ownAssociate } from "@/server/name-card/own-associate";

const ANG = { id: "a1", fullName: "Angeline Teo", designation: "SalesDirector" };

beforeEach(() => {
  h.findUnique.mockReset();
  h.findFirst.mockReset();
});

describe("ownAssociate", () => {
  it("uses the session link when it resolves, and does not query by email", async () => {
    h.findUnique.mockResolvedValue(ANG);
    expect(await ownAssociate({ associateId: "a1", email: "angeline@enshrine.sg" })).toEqual(ANG);
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  // The actual bug. A login with no associateId used to resolve to null, and
  // every caller then fell back to session/role data.
  it("falls back to the login email when the session carries no associateId", async () => {
    h.findFirst.mockResolvedValue(ANG);
    expect(await ownAssociate({ associateId: null, email: "angeline@enshrine.sg" })).toEqual(ANG);
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.findFirst).toHaveBeenCalledWith({ where: { email: "angeline@enshrine.sg" } });
  });

  // A link can also point at a row that is gone. Returning null there would
  // reintroduce the role-label fallback for someone who does have a profile.
  it("falls back to the email when the linked id resolves to nothing", async () => {
    h.findUnique.mockResolvedValue(null);
    h.findFirst.mockResolvedValue(ANG);
    expect(await ownAssociate({ associateId: "stale", email: "angeline@enshrine.sg" })).toEqual(ANG);
    expect(h.findFirst).toHaveBeenCalled();
  });

  it("returns null when there is no link and no email, without querying", async () => {
    expect(await ownAssociate({ associateId: null, email: null })).toBeNull();
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  // Control: proves the mocks are wired, so the negative assertions above are
  // meaningful rather than passing because nothing is ever called.
  it("control — a resolving email lookup really is observable", async () => {
    h.findFirst.mockResolvedValue(ANG);
    const got = await ownAssociate({ associateId: null, email: "x@y.z" });
    expect(got).not.toBeNull();
    expect(h.findFirst).toHaveBeenCalledTimes(1);
  });
});
