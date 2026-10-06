// ITEM 7 (downline lookup) — the gating security tests. "Director can only
// see their own team" is two separate authorisation decisions on one rule:
// the search box (which names it may even return) and the subject query
// (whose rows the table may show). Both go through the SAME named choke
// point, lib/rbac.ts downlineLookupScope — tested directly here, then again
// through both call sites it guards, so a regression at either site shows up
// without needing a browser.
//
// Real throwaway Postgres (needs DATABASE_URL); every row is tagged and
// cleaned up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Designation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { downlineLookupScope } from "@/lib/rbac";
import { searchDownlineCandidates, getDownlineLookup } from "./downline-lookup";

const TAG = "DLLK-";

let directorId = "", memberId = "", grandchildId = "", strangerId = "";
let otherDirectorId = "", otherMemberId = "";
let periodSubjectId = "", unsetTargetId = "";
let legacyClosedId = "";

const admin = { associateId: "00000000-0000-0000-0000-000000000000", role: "Admin" as const };

async function makeAssociate(code: string, designation: Designation, directUplineId?: string) {
  return (await prisma.associate.create({
    data: { associateCode: code, fullName: `Fake ${code}`, designation, directUplineId },
    select: { id: true },
  })).id;
}

beforeAll(async () => {
  directorId = await makeAssociate(TAG + "DIR", Designation.SalesDirector);
  memberId = await makeAssociate(TAG + "MEM", Designation.SalesAssociate, directorId);
  grandchildId = await makeAssociate(TAG + "GC", Designation.SalesAssociate, memberId);
  // A real associate, but NOT in the director's downline — the out-of-scope
  // candidate for both the search box and the subject query.
  strangerId = await makeAssociate(TAG + "STR", Designation.SalesAssociate);

  otherDirectorId = await makeAssociate(TAG + "OD", Designation.SalesDirector);
  otherMemberId = await makeAssociate(TAG + "OM", Designation.SalesAssociate, otherDirectorId);

  periodSubjectId = await makeAssociate(TAG + "PER", Designation.SalesAssociate, directorId);
  unsetTargetId = await makeAssociate(TAG + "NOTARGET", Designation.SalesAssociate, directorId);
  // Deliberately NOT under directorId — this fixture exists only to prove
  // the Closed predicate, not to re-test scope, and giving it an upline
  // would silently change the director's downline count the scope/search
  // tests above assert exactly.
  legacyClosedId = await makeAssociate(TAG + "LEGACY", Designation.SalesAssociate);
});

afterAll(async () => {
  await prisma.salesQuota.deleteMany({ where: { associateId: { in: [periodSubjectId, unsetTargetId] } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: { in: [periodSubjectId, memberId, legacyClosedId] } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("downlineLookupScope — the single named choke point (lib/rbac.ts)", () => {
  it("Admin: unrestricted (null), not an array a mismatched id could vacuously fail against", async () => {
    expect(await downlineLookupScope(admin)).toBeNull();
  });

  it("Director: their own self-inclusive downline, and nothing outside it", async () => {
    const scope = await downlineLookupScope({ associateId: directorId, role: "SalesDirector" });
    expect(scope).not.toBeNull();
    // The fixture's director has 5 people in their own tree (self, member,
    // grandchild, plus the two associates set up below for the period/target
    // tests, who are also under this director) — asserted exactly, so a
    // stray extra id would fail this test, not pass it silently.
    expect(scope).toHaveLength(5);
    expect(scope).toEqual(expect.arrayContaining([directorId, memberId, grandchildId, periodSubjectId, unsetTargetId]));
    expect(scope).not.toContain(strangerId);
    expect(scope).not.toContain(otherDirectorId);
    expect(scope).not.toContain(otherMemberId);
  });
});

describe("getDownlineLookup — the subject id from the request is never trusted on its own", () => {
  // CASE (i): director requests a subject INSIDE their downline → allowed.
  it("director requesting a subject inside their own downline is allowed", async () => {
    const result = await getDownlineLookup({ associateId: directorId, role: "SalesDirector" }, memberId, "month");
    expect(result).not.toBeNull();
    expect(result?.subject.id).toBe(memberId);
  });

  // CASE (ii): director requests a subject OUTSIDE their downline → refused,
  // and the refusal must be indistinguishable from "does not exist".
  it("director requesting a subject OUTSIDE their downline is refused (null)", async () => {
    const result = await getDownlineLookup({ associateId: directorId, role: "SalesDirector" }, strangerId, "month");
    expect(result).toBeNull();
  });

  it("a genuinely nonexistent subject id returns the SAME null a refusal does", async () => {
    const result = await getDownlineLookup(
      { associateId: directorId, role: "SalesDirector" },
      "00000000-0000-0000-0000-000000000000",
      "month",
    );
    expect(result).toBeNull();
  });

  // CONTROL for case (ii): the "stranger" really exists, really is a real
  // associate row — the refusal above is a scope decision, not an accident
  // of the id not resolving to anything.
  it("CONTROL — the out-of-scope stranger from case (ii) is a real, existing associate", async () => {
    const row = await prisma.associate.findUnique({ where: { id: strangerId }, select: { id: true } });
    expect(row).not.toBeNull();
  });

  // Cross-director isolation: a DIFFERENT director's own team member is also
  // outside this director's scope — "own team only" is not "any director's team".
  it("a different director's team member is also refused to this director", async () => {
    const result = await getDownlineLookup({ associateId: directorId, role: "SalesDirector" }, otherMemberId, "month");
    expect(result).toBeNull();
  });

  // CASE (iii): admin requests any subject → allowed, including the stranger
  // a director was just refused.
  it("admin requesting any subject, including one no director here owns, is allowed", async () => {
    const result = await getDownlineLookup(admin, strangerId, "month");
    expect(result).not.toBeNull();
    expect(result?.subject.id).toBe(strangerId);
  });
});

describe("searchDownlineCandidates — CASE (iv): the search box itself is scoped, not just the table", () => {
  it("director's search returns ONLY in-scope names — asserted on the returned rows, with a stated count", async () => {
    const candidates = await searchDownlineCandidates({ associateId: directorId, role: "SalesDirector" }, TAG);
    // The assertion below examines every row this call returned: exactly 5
    // (director, member, grandchild, and the two period/target fixture
    // associates, all under this director), never the 8 TAG-tagged
    // associates that actually exist across the whole fixture.
    expect(candidates).toHaveLength(5);
    const ids = candidates.map((c) => c.id);
    expect(new Set(ids)).toEqual(new Set([directorId, memberId, grandchildId, periodSubjectId, unsetTargetId]));
    expect(ids).not.toContain(strangerId);
    expect(ids).not.toContain(otherDirectorId);
    expect(ids).not.toContain(otherMemberId);
  });

  // CONTROL: the fixture is not vacuously small — the same query, unscoped
  // (admin), really does return more rows than the director saw, proving the
  // director's 5 is a real exclusion and not just "there was nothing else".
  it("CONTROL — the same query as admin (unrestricted) returns more than the director's 5 rows", async () => {
    const candidates = await searchDownlineCandidates(admin, TAG);
    expect(candidates.length).toBeGreaterThan(5);
    expect(candidates.map((c) => c.id)).toContain(strangerId);
  });

  it("an empty query returns no rows, for any role (no empty-string LIKE '%%' scan)", async () => {
    expect(await searchDownlineCandidates({ associateId: directorId, role: "SalesDirector" }, "")).toEqual([]);
    expect(await searchDownlineCandidates(admin, "")).toEqual([]);
  });
});

describe("the three sales columns — rejected is excluded from every total", () => {
  beforeAll(async () => {
    await prisma.salesSubmission.createMany({
      data: [
        { clientName: "Fake client A", salesDate: new Date("2026-06-10"), saleAmount: "1000.00", paymentPlan: "FullPayment", closingAssociateId: periodSubjectId, status: "Verified" },
        { clientName: "Fake client B", salesDate: new Date("2026-02-10"), saleAmount: "2000.00", paymentPlan: "FullPayment", closingAssociateId: periodSubjectId, status: "Verified" },
        { clientName: "Fake client C", salesDate: new Date("2026-06-12"), saleAmount: "300.00", paymentPlan: "FullPayment", closingAssociateId: periodSubjectId, status: "Submitted" },
        // Distinctive, large amount: if this ever leaked into closed or
        // pending, it would be unmistakable (it dwarfs every other figure).
        { clientName: "Fake client D", salesDate: new Date("2026-06-05"), saleAmount: "5000.00", paymentPlan: "FullPayment", closingAssociateId: periodSubjectId, status: "Rejected" },
      ],
    });
  });

  const NOW = new Date(2026, 5, 15); // fixed "today": 15 Jun 2026

  it("THIS MONTH — closed and pending are correct, and the 5000.00 rejected row is in neither", async () => {
    const result = await getDownlineLookup({ associateId: directorId, role: "SalesDirector" }, periodSubjectId, "month", NOW);
    expect(result?.subject.closed).toBe("1000.00");
    expect(result?.subject.pending).toBe("300.00");
    expect(result?.subject.rejected).toBe("5000.00");
  });

  it("CONTROL — the rejected row really is 5000.00 and really has status Rejected (the exclusion isn't vacuous)", async () => {
    const row = await prisma.salesSubmission.findFirst({ where: { closingAssociateId: periodSubjectId, saleAmount: "5000.00" } });
    expect(row?.status).toBe("Rejected");
  });

  // THE LEGACY BOOKING PATH, end-to-end through getDownlineLookup's real
  // select + moneyFor wiring (not just the pure predicate unit test). This
  // is the exact row shape closeSale produces: closedAt set, status still
  // Submitted, never reaching Verified.
  it("a Legacy-closed row (closedAt set, status still Submitted) counts as CLOSED, not pending, through the real query path", async () => {
    await prisma.salesSubmission.create({
      data: { clientName: "Fake client E", salesDate: new Date("2026-06-08"), saleAmount: "700.00", paymentPlan: "FullPayment", closingAssociateId: legacyClosedId, status: "Submitted", closedAt: new Date("2026-06-09") },
    });
    const result = await getDownlineLookup(admin, legacyClosedId, "month", NOW);
    expect(result?.subject.closed).toBe("700.00");
    expect(result?.subject.pending).toBe("0.00");
  });

  it("CONTROL — that row really is status Submitted with closedAt set (the Legacy shape isn't simulated by status alone)", async () => {
    const row = await prisma.salesSubmission.findFirst({ where: { closingAssociateId: legacyClosedId } });
    expect(row?.status).toBe("Submitted");
    expect(row?.closedAt).not.toBeNull();
  });

  it("THIS YEAR — the February sale (outside the month) joins closed; rejected is STILL excluded", async () => {
    const result = await getDownlineLookup({ associateId: directorId, role: "SalesDirector" }, periodSubjectId, "year", NOW);
    expect(result?.subject.closed).toBe("3000.00"); // 1000 (June) + 2000 (Feb) — NOT 8000, which is what including rejected would give
    expect(result?.subject.pending).toBe("300.00");
    expect(result?.subject.rejected).toBe("5000.00");
  });
});

describe("period toggle moves BOTH sales and target together — never just one column", () => {
  beforeAll(async () => {
    await prisma.salesQuota.createMany({
      data: [
        { associateId: periodSubjectId, month: "2026-06", amount: "4000.00", setByRole: "SalesDirector" },
        { associateId: periodSubjectId, month: "2026", amount: "50000.00", setByRole: "SalesDirector" },
      ],
    });
  });

  const NOW = new Date(2026, 5, 15);

  it("monthly view: monthly target (4000), not the yearly one", async () => {
    const result = await getDownlineLookup({ associateId: directorId, role: "SalesDirector" }, periodSubjectId, "month", NOW);
    expect(result?.subject.target?.source).toBe("individual");
    expect(Number(result?.subject.target?.amount)).toBe(4000);
  });

  it("yearly view: yearly target (50000), not the monthly one — same subject, same request shape, different period", async () => {
    const result = await getDownlineLookup({ associateId: directorId, role: "SalesDirector" }, periodSubjectId, "year", NOW);
    expect(result?.subject.target?.source).toBe("individual");
    expect(Number(result?.subject.target?.amount)).toBe(50000);
  });
});

describe("an unset target renders as absent (null), never as a $0 row", () => {
  it("no SalesQuota row and no team → target is null, not \"0.00\"", async () => {
    const result = await getDownlineLookup({ associateId: directorId, role: "SalesDirector" }, unsetTargetId, "month");
    expect(result?.subject.target).toBeNull();
  });
});
