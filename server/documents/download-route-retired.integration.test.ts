// B-5: a retired template upload (superseded by a replace) must stop being
// downloadable to associates — it's gone from every listing, but the route
// itself never checked retiredAt, so a bookmarked/shared link kept serving a
// superseded agreement template indefinitely. app/** isn't in vitest's
// include globs, so this imports the route handler directly (same pattern as
// server/vouchers/route.test.ts) rather than making an HTTP request.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));

import { prisma } from "@/lib/db";
import { putObject, deleteObject } from "@/lib/storage";
import { GET } from "@/app/documents/[id]/download/route";

const TAG = "B5DLRT-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const ASSOCIATE = { user: { associateId: "22222222-2222-2222-2222-222222222222", id: "33333333-3333-3333-3333-333333333333", role: "SalesAssociate" } };

const callGet = (id: string) => GET(new Request("http://x"), { params: Promise.resolve({ id }) });

let currentKey: string, retiredKey: string, currentId: string, retiredId: string;

beforeAll(async () => {
  currentKey = `documents/${TAG}current.pdf`;
  retiredKey = `documents/${TAG}retired.pdf`;
  await putObject(currentKey, Buffer.from("current"));
  await putObject(retiredKey, Buffer.from("retired"));

  const current = await prisma.document.create({
    data: { type: "CompanyTemplate", title: TAG + "current", fileKey: currentKey, category: "PetsAfterlife", assignment: "All", visibility: "All" },
  });
  currentId = current.id;
  const retired = await prisma.document.create({
    data: {
      type: "CompanyTemplate", title: TAG + "retired", fileKey: retiredKey, category: null, assignment: "All", visibility: "All",
      retiredAt: new Date(), supersededById: currentId,
    },
  });
  retiredId = retired.id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { title: { startsWith: TAG } } });
  await deleteObject(currentKey);
  await deleteObject(retiredKey);
});

describe("GET /documents/[id]/download — a retired upload is 404 to associates, still 200 for admins", () => {
  it("1. associate gets the CURRENT (non-retired) upload -> 200", async () => {
    who.session = ASSOCIATE;
    const res = await callGet(currentId);
    expect(res.status).toBe(200);
  });

  it("2. associate requests the RETIRED id -> 404", async () => {
    who.session = ASSOCIATE;
    const res = await callGet(retiredId);
    expect(res.status).toBe(404);
  });

  it("3. admin requests the RETIRED id -> 200 (audit/recovery access, not public reachability)", async () => {
    who.session = ADMIN;
    const res = await callGet(retiredId);
    expect(res.status).toBe(200);
  });
});
