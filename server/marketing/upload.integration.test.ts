import { describe, it, expect, afterAll, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "11111111-1111-1111-1111-111111111111", role: "Admin" } }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), env: { ...(await orig<typeof import("@/lib/env")>()).env, MARKETING_LIBRARY_ENABLED: true } }));

import { prisma } from "@/lib/db";
import { getObject, deleteObject } from "@/lib/storage";
import { receiveMarketingUpload } from "./upload";
import { archiveMarketingAsset } from "./actions";

const TAG = "B9UP-";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, ...new Array(64).fill(0x41)]);

function pdfBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(PDF_BYTES);
      controller.close();
    },
  });
}

afterAll(async () => {
  const collections = await prisma.marketingCollection.findMany({
    where: { name: { startsWith: TAG } },
    include: { assets: { select: { fileKey: true } } },
  });
  for (const c of collections) {
    for (const a of c.assets) await deleteObject(a.fileKey);
    await prisma.marketingAsset.deleteMany({ where: { collectionId: c.id } });
  }
  await prisma.marketingCollection.deleteMany({ where: { name: { startsWith: TAG } } });
});

describe("receiveMarketingUpload (real DB — ADR-0002 U2)", () => {
  it("two concurrent uploads of the SAME file content to the SAME collection produce exactly one row and one file on disk", async () => {
    const collection = await prisma.marketingCollection.create({ data: { category: "Flyers", name: TAG + "concurrent" } });

    const [r1, r2] = await Promise.all([
      receiveMarketingUpload({ actorUserId: "11111111-1111-1111-1111-111111111111", collectionId: collection.id, fileName: "a.pdf", body: pdfBody(), contentLength: PDF_BYTES.length }),
      receiveMarketingUpload({ actorUserId: "11111111-1111-1111-1111-111111111111", collectionId: collection.id, fileName: "b.pdf", body: pdfBody(), contentLength: PDF_BYTES.length }),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    // Same winning row for both — one is the "real" upload, the other is
    // told it's a duplicate pointing at the same id.
    expect(r1.id).toBe(r2.id);
    expect([r1.duplicate, r2.duplicate].sort()).toEqual([false, true]);

    const rows = await prisma.marketingAsset.findMany({ where: { collectionId: collection.id } });
    expect(rows).toHaveLength(1);

    const data = await getObject(rows[0].fileKey);
    expect(data).not.toBeNull();
    expect(Buffer.compare(data!, Buffer.from(PDF_BYTES))).toBe(0);
  });

  it("the SAME file content in TWO DIFFERENT collections is not deduped — each gets its own row and file", async () => {
    const colA = await prisma.marketingCollection.create({ data: { category: "Flyers", name: TAG + "colA" } });
    const colB = await prisma.marketingCollection.create({ data: { category: "Flyers", name: TAG + "colB" } });

    const rA = await receiveMarketingUpload({ actorUserId: "11111111-1111-1111-1111-111111111111", collectionId: colA.id, fileName: "a.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    const rB = await receiveMarketingUpload({ actorUserId: "11111111-1111-1111-1111-111111111111", collectionId: colB.id, fileName: "a.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });

    expect(rA.ok && !rA.duplicate).toBe(true);
    expect(rB.ok && !rB.duplicate).toBe(true);
    if (!rA.ok || !rB.ok) return;
    expect(rA.id).not.toBe(rB.id);
  });

  // DevLead (static review, 2026-10-02): the dedupe index is
  // `UNIQUE (collection_id, sha256) WHERE archived_at IS NULL` — a partial
  // index that lives ONLY in migration.sql (Prisma's schema DSL can't
  // express the WHERE clause). The two tests above pin that the index
  // EXISTS (they'd fail without it), but neither pins the WHERE: drop just
  // that clause and both still pass, while this exact path — archive an
  // asset, then re-upload the same bytes to the same collection — silently
  // breaks: the old (archived) row's sha256 collides with the new upload,
  // Postgres rejects the insert, and upload.ts deletes the file it just
  // wrote and returns a 500. Permanently un-uploadable to that collection,
  // and nothing above would have caught it.
  it("re-uploading the same file content after the original was archived succeeds with a fresh row (pins the partial WHERE, not just the index's existence)", async () => {
    const collection = await prisma.marketingCollection.create({ data: { category: "Flyers", name: TAG + "archive-reupload" } });

    const first = await receiveMarketingUpload({ actorUserId: "11111111-1111-1111-1111-111111111111", collectionId: collection.id, fileName: "a.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(first.ok && !first.duplicate).toBe(true);
    if (!first.ok) return;

    expect((await archiveMarketingAsset(first.id, true)).ok).toBe(true);

    const second = await receiveMarketingUpload({ actorUserId: "11111111-1111-1111-1111-111111111111", collectionId: collection.id, fileName: "a.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.duplicate).toBe(false); // the archived row doesn't count as "the same live file"
    expect(second.id).not.toBe(first.id); // a genuinely new row, not the archived one reactivated

    const rows = await prisma.marketingAsset.findMany({ where: { collectionId: collection.id } });
    expect(rows).toHaveLength(2); // the archived original AND the new upload both exist

    const data = await getObject(rows.find((r) => r.id === second.id)!.fileKey);
    expect(data).not.toBeNull();
  });
});
