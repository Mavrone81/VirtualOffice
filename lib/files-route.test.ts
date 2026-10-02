import { describe, it, expect, vi, beforeEach } from "vitest";

// SEC-1 regression: /api/files/[...key] must not let an associate walk out of
// their own namespace with an encoded `..` segment. Lives under lib/ so the
// vitest include picks it up; exercises the real route handler.

const ALICE = "971a6411-f402-487c-8514-fe1c2bf38dcd";
const BOB = "1d09f090-109a-4ad2-9d4d-dc048f05cab5";
const CAND = "71837acb-4d18-4ad3-a96f-f2f96c78dd81";
const SUB = "3c431f41-ea18-4e95-a12e-dd067470a71e";

const state = { session: null as null | { user: { role: string; associateId: string | null; mustResetPassword?: boolean } } };

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/db", () => ({
  prisma: {
    salesSubmission: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === SUB ? { closingAssociateId: ALICE } : null),
    },
    // Audit reliability: the route asks whether a key is an NRIC-bearing agreement
    // (server/documents/pii-documents.ts); none of these test objects is.
    petsAshesAgreement: { findFirst: vi.fn(async () => null) },
    vendorReferral: { findFirst: vi.fn(async () => null) },
    pFileDocument: { findFirst: vi.fn(async () => null) },
    // associates/<id>/… is PII-bearing (fail-safe): its download is recorded first.
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));
// getObject echoes the key it was asked to read, so a test can see exactly
// which object the route resolved to.
vi.mock("@/lib/storage", () => ({
  getObject: vi.fn(async (key: string) => Buffer.from(key)),
  contentTypeForKey: () => "application/octet-stream",
  // SEC-11 serves objects through objectResponseHeaders; headers are not under test here.
  objectResponseHeaders: () => ({ "Content-Type": "application/octet-stream" }),
}));

import { GET } from "@/app/api/files/[...key]/route";
import { getObject } from "@/lib/storage";

// Next hands the handler each path segment decoded ONCE. Simulate that from a
// raw request path so each case reads exactly like the HTTP request it models.
function segmentsOf(rawPath: string): string[] {
  return rawPath.split("/").map((s) => decodeURIComponent(s));
}
async function get(rawPath: string) {
  const res = await GET(new Request(`http://local/api/files/${rawPath}`), {
    params: Promise.resolve({ key: segmentsOf(rawPath) }),
  });
  return { status: res.status, body: await res.text() };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { user: { role: "SalesAssociate", associateId: ALICE } };
});

describe("/api/files access control", () => {
  it("serves the caller's own objects and their own sale's docket", async () => {
    expect(await get(`associates/${ALICE}/photo.jpg`)).toEqual({ status: 200, body: `associates/${ALICE}/photo.jpg` });
    expect((await get(`submissions/${SUB}/docket.pdf`)).status).toBe(200);
  });

  it("forbids another associate's object and rejects anonymous callers", async () => {
    expect((await get(`associates/${BOB}/photo.jpg`)).status).toBe(403);
    state.session = null;
    expect((await get(`associates/${ALICE}/photo.jpg`)).status).toBe(401);
  });

  // #29: middleware.ts excludes /api/* entirely, so the force-reset
  // page redirect never applies here — this route must check the flag itself.
  it("refuses a session with mustResetPassword still set, without reading storage", async () => {
    state.session = { user: { role: "SalesAssociate", associateId: ALICE, mustResetPassword: true } };
    expect((await get(`associates/${ALICE}/photo.jpg`)).status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("positive control: the same caller is served once mustResetPassword is false", async () => {
    state.session = { user: { role: "SalesAssociate", associateId: ALICE, mustResetPassword: false } };
    expect((await get(`associates/${ALICE}/photo.jpg`)).status).toBe(200);
  });

  it.each([
    [`associates/${ALICE}/..%2F${BOB}%2Fphoto.jpg`],
    [`associates/${ALICE}/%2e%2e%2f${BOB}%2fphoto.jpg`],
    [`associates/${ALICE}/..%252F${BOB}%252Fphoto.jpg`],
    [`associates/${ALICE}/%252e%252e%252f${BOB}%252fphoto.jpg`],
    [`associates/${ALICE}/..%2F..%2Fcandidates%2F${CAND}%2Fsigned-agreement.pdf`],
    [`associates/${ALICE}/..%5C${BOB}%5Cphoto.jpg`],
    [`submissions/${SUB}/..%2F..%2Fcandidates%2F${CAND}%2Fsigned-agreement.pdf`],
    [`submissions/${SUB}/..%2F..%2Fassociates%2F${BOB}%2Fphoto.jpg`],
    [`associates/${ALICE}/..`],
    [`associates/${ALICE}/.`],
  ])("rejects encoded traversal %s without reading storage", async (raw) => {
    const r = await get(raw);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).not.toBe(404);
    expect(r.body).not.toContain(BOB);
    expect(r.body).not.toContain(CAND);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("does not let admins escape the storage root via encoded segments either", async () => {
    state.session = { user: { role: "Admin", associateId: null } };
    expect((await get(`..%2F..%2Fetc%2Fpasswd`)).status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  // CR-0001 (the owner's ruling): the company signatory's signature is narrowed
  // to Admin ONLY — not every isAdminRole, unlike every other admin-readable
  // key in this route (logoFileKey/stampFileKey keep the broader access).
  // Both halves required: an admin-type role that is NOT Admin must be
  // refused, AND Admin must still be served — a route that refuses everyone,
  // or lets every isAdminRole through, would pass a test asserting only one.
  describe("company signatory signature — Admin only", () => {
    const KEY = "companies/signatory/9f1c7e2a-signature.png";

    it("refuses Accounts (an admin-type role, but not Admin)", async () => {
      state.session = { user: { role: "Accounts", associateId: null } };
      expect((await get(KEY)).status).toBe(403);
      expect(getObject).not.toHaveBeenCalled();
    });

    it("refuses a non-admin associate, even for their own sale's namespace shape", async () => {
      state.session = { user: { role: "SalesAssociate", associateId: ALICE } };
      expect((await get(KEY)).status).toBe(403);
      expect(getObject).not.toHaveBeenCalled();
    });

    it("positive control: Admin is served", async () => {
      state.session = { user: { role: "Admin", associateId: null } };
      expect(await get(KEY)).toEqual({ status: 200, body: KEY });
    });
  });
});
