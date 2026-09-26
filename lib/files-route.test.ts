import { describe, it, expect, vi, beforeEach } from "vitest";

// SEC-1 regression: /api/files/[...key] must not let an associate walk out of
// their own namespace with an encoded `..` segment. Lives under lib/ so the
// vitest include picks it up; exercises the real route handler.

const ALICE = "971a6411-f402-487c-8514-fe1c2bf38dcd";
const BOB = "1d09f090-109a-4ad2-9d4d-dc048f05cab5";
const CAND = "71837acb-4d18-4ad3-a96f-f2f96c78dd81";
const SUB = "3c431f41-ea18-4e95-a12e-dd067470a71e";

const state = { session: null as null | { user: { role: string; associateId: string | null } } };

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/db", () => ({
  prisma: {
    salesSubmission: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === SUB ? { closingAssociateId: ALICE } : null),
    },
  },
}));
// getObject echoes the key it was asked to read, so a test can see exactly
// which object the route resolved to.
vi.mock("@/lib/storage", () => ({
  getObject: vi.fn(async (key: string) => Buffer.from(key)),
  contentTypeForKey: () => "application/octet-stream",
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
});
