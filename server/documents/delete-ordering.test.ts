import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";

/**
 * INT-5. `deleteDocument` destroys two things: a row in `documents` and an
 * object in the file store. The ORDER is the whole point, because the row
 * delete can be refused while the file delete essentially cannot.
 *
 * What refuses it: `documents_superseded_by_fkey` — documents.superseded_by
 * -> documents.id, ON DELETE RESTRICT, DEFERRABLE INITIALLY DEFERRED
 * (prisma/migrations/20261002090000_b5_doc_template_category/migration.sql).
 * Uploading a replacement template for a category retires the old row and
 * points its superseded_by at the NEW row, so the current template row is
 * referenced and RESTRICT refuses to delete it.
 *
 * If the object is removed before the row commits, that refusal leaves a
 * surviving row pointing at a file that is already gone: the document still
 * lists, still renders in the admin UI, and fails only at download — and
 * nothing detects it afterwards.
 *
 * These tests assert the invariant directly: when the row delete does not
 * commit, the stored object is STILL PRESENT. Storage here is the REAL
 * lib/storage, so "still present" is a real file on disk, not a mock call
 * count. Row counts are asserted explicitly on both sides of the call.
 */

type Row = { id: string; fileKey: string };

const { authMock, prismaMock, logAuditMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    document: { findUnique: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
  },
  logAuditMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
// @/lib/storage is deliberately NOT mocked.

import * as storage from "@/lib/storage";
import { deleteDocument } from "./actions";

// Obviously-fake fixture ids/values only.
const ADMIN_ID = "00000000-0000-4000-8000-00000000000a";
const DOC_ID = "00000000-0000-4000-8000-000000000001";

const realDeleteObject = storage.deleteObject;

/** The refusal Postgres raises for the RESTRICT self-reference. */
function fkRefusal() {
  return new Prisma.PrismaClientKnownRequestError(
    "Foreign key constraint violated on the constraint: `documents_superseded_by_fkey`",
    { code: "P2003", clientVersion: "test", meta: { modelName: "Document", field_name: "documents_superseded_by_fkey (index)" } },
  );
}

type Mode = "ok" | "refuseStatement" | "refuseAtCommit" | "transientFailure";
let mode: Mode;
let rows: Map<string, Row>;
let key: string;

beforeEach(async () => {
  vi.clearAllMocks();
  mode = "ok";

  key = `test/int5-${randomUUID()}/sample-template.pdf`;
  await storage.putObject(key, Buffer.from("fake fixture bytes, not a real document"));
  rows = new Map<string, Row>([[DOC_ID, { id: DOC_ID, fileKey: key }]]);

  authMock.mockResolvedValue({ user: { id: ADMIN_ID, role: "Admin" } });

  prismaMock.document.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const row = rows.get(where.id);
    return row ? { fileKey: row.fileKey } : null;
  });

  prismaMock.document.delete.mockImplementation(async ({ where }: { where: { id: string } }) => {
    if (mode === "refuseStatement") throw fkRefusal();
    if (mode === "transientFailure") throw new Error("connection closed before the statement completed");
    const row = rows.get(where.id);
    if (!row) throw new Prisma.PrismaClientKnownRequestError("no such record", { code: "P2025", clientVersion: "test" });
    rows.delete(where.id);
    return row;
  });

  // Runs the callback, then COMMITs. The FK is DEFERRABLE INITIALLY DEFERRED,
  // so its check lands at COMMIT — `refuseAtCommit` therefore throws AFTER the
  // delete statement has already run, and rolls the row back, which is exactly
  // what Postgres does.
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg !== "function") return Promise.all(arg as Promise<unknown>[]);
    const snapshot = new Map(rows);
    const out = await (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock);
    if (mode === "refuseAtCommit") {
      rows = snapshot;
      throw fkRefusal();
    }
    return out;
  });

  // An empty fixture would manufacture a green in every test below: "the file
  // is still there" passes trivially against a file that was never written,
  // and "the row survived" against a table that never had one. Assert the
  // fixture is real BEFORE each test runs, not just inside one of them.
  expect(rows.size).toBe(1);
  expect(await storage.getObject(key)).not.toBeNull();
  expect((await storage.getObject(key))!.length).toBeGreaterThan(0);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await realDeleteObject(key);
});

async function callDelete() {
  return deleteDocument(DOC_ID).then(
    (returned) => ({ outcome: "returned" as const, returned }),
    (thrown) => ({ outcome: "threw" as const, thrown }),
  );
}

async function objectIsPresent() {
  return (await storage.getObject(key)) !== null;
}

describe("deleteDocument ordering (INT-5)", () => {
  it("row delete REFUSED by documents_superseded_by_fkey: the stored object is still present and the row survives", async () => {
    mode = "refuseStatement";
    expect(rows.size).toBe(1); // rows before: 1
    expect(await objectIsPresent()).toBe(true);

    const r = await callDelete();

    // The invariant: nothing is destroyed while the row is still there.
    expect(await objectIsPresent()).toBe(true);
    expect(rows.size).toBe(1); // rows after: 1 — the refusal destroyed nothing
    expect(rows.get(DOC_ID)?.fileKey).toBe(key);

    // ...and the refusal is reported, not thrown, so the caller can retry.
    expect(r.outcome).toBe("returned");
    expect(r.outcome === "returned" && r.returned.ok).toBe(false);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("DEFERRABLE INITIALLY DEFERRED: the refusal lands at COMMIT, and the object must still be present then too", async () => {
    mode = "refuseAtCommit";
    expect(rows.size).toBe(1); // rows before: 1

    const r = await callDelete();

    expect(await objectIsPresent()).toBe(true);
    expect(rows.size).toBe(1); // rows after: 1 — the commit rolled back
    expect(r.outcome).toBe("returned");
    expect(r.outcome === "returned" && r.returned.ok).toBe(false);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  // The FK refusal above is the stated trigger, but it is currently unreachable
  // from the admin UI: the delete button is hidden for template rows
  // (app/admin/documents/page.tsx). This is the trigger that needs no FK at
  // all — any transient DB failure between the two destructive steps. It
  // rethrows, as before, but must not have destroyed anything on the way.
  it("a transient DB failure (no FK involved) rethrows, and the stored object is still present", async () => {
    mode = "transientFailure";
    expect(rows.size).toBe(1); // rows before: 1

    const r = await callDelete();

    expect(await objectIsPresent()).toBe(true);
    expect(rows.size).toBe(1); // rows after: 1
    expect(r.outcome).toBe("threw"); // an unexpected failure still surfaces
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("on success the row is committed FIRST — by the time the object is removed, the row count is already 0", async () => {
    let rowsWhenObjectRemoved: number | null = null;
    vi.spyOn(storage, "deleteObject").mockImplementation(async (k: string) => {
      rowsWhenObjectRemoved = rows.size;
      await realDeleteObject(k);
    });

    expect(rows.size).toBe(1); // rows before: 1
    const r = await callDelete();

    expect(r.outcome === "returned" && r.returned).toEqual({ ok: true });
    expect(rowsWhenObjectRemoved).toBe(0); // rows at the moment the file went: 0
    expect(rows.size).toBe(0); // rows after: 0
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(await objectIsPresent()).toBe(false);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.deleted", entityId: DOC_ID }));
  });

  it("object delete failing AFTER the row is gone still succeeds — an orphaned file costs disk but breaks nothing", async () => {
    vi.spyOn(storage, "deleteObject").mockRejectedValue(new Error("simulated store failure"));

    expect(rows.size).toBe(1); // rows before: 1
    const r = await callDelete();

    expect(r.outcome).toBe("returned");
    expect(r.outcome === "returned" && r.returned).toEqual({ ok: true });
    expect(rows.size).toBe(0); // rows after: 0 — the DB truth committed
    expect(await objectIsPresent()).toBe(true); // the orphan, deliberately tolerated
  });
});
