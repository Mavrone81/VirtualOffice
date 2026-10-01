import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, deleteObjectMock, logAuditMock, envState } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    marketingCollection: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    marketingAsset: { update: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
  deleteObjectMock: vi.fn(async () => {}),
  logAuditMock: vi.fn(),
  envState: { MARKETING_LIBRARY_ENABLED: true },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/storage", () => ({ deleteObject: deleteObjectMock }));
vi.mock("@/lib/env", () => ({ get env() { return envState; } }));

import { createMarketingCollection, archiveMarketingCollection, archiveMarketingAsset, deleteMarketingCollection } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  envState.MARKETING_LIBRARY_ENABLED = true;
});

describe("build-now-ship-later: every action behaves as if the feature doesn't exist when the flag is off", () => {
  it("refuses all four actions with notFound, before even checking admin", async () => {
    envState.MARKETING_LIBRARY_ENABLED = false;
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });

    expect(await createMarketingCollection({ category: "Flyers" as never, name: "X" })).toEqual({ ok: false, error: "notFound" });
    expect(await archiveMarketingCollection("col1", true)).toEqual({ ok: false, error: "notFound" });
    expect(await archiveMarketingAsset("asset1", true)).toEqual({ ok: false, error: "notFound" });
    expect(await deleteMarketingCollection("col1")).toEqual({ ok: false, error: "notFound" });

    expect(prismaMock.marketingCollection.create).not.toHaveBeenCalled();
    expect(prismaMock.marketingCollection.update).not.toHaveBeenCalled();
    expect(prismaMock.marketingAsset.update).not.toHaveBeenCalled();
    expect(prismaMock.marketingCollection.delete).not.toHaveBeenCalled();
  });
});

describe("createMarketingCollection", () => {
  it("refuses a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await createMarketingCollection({ category: "Flyers" as never, name: "Christmas 2026" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.marketingCollection.create).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    const r = await createMarketingCollection({ category: "Flyers" as never, name: "  " });
    expect(r).toEqual({ ok: false, error: "titleRequired" });
  });

  it("creates the collection and audits it", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.marketingCollection.create.mockResolvedValue({ id: "col1" });
    const r = await createMarketingCollection({ category: "EDMs" as never, name: "Q4 blast" });
    expect(r).toEqual({ ok: true, id: "col1" });
    expect(prismaMock.marketingCollection.create.mock.calls[0][0].data).toEqual({ category: "EDMs", name: "Q4 blast", createdById: "admin1" });
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "marketing.collection_created", entityId: "col1" }));
  });
});

describe("archiveMarketingCollection / archiveMarketingAsset", () => {
  it("archives and unarchives a collection (toggle, not delete)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.marketingCollection.findUnique.mockResolvedValue({ category: "Flyers" });

    await archiveMarketingCollection("col1", true);
    expect(prismaMock.marketingCollection.update).toHaveBeenCalledWith({ where: { id: "col1" }, data: { archivedAt: expect.any(Date) } });

    await archiveMarketingCollection("col1", false);
    expect(prismaMock.marketingCollection.update).toHaveBeenCalledWith({ where: { id: "col1" }, data: { archivedAt: null } });
  });

  it("refuses a non-admin for asset archiving", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await archiveMarketingAsset("asset1", true);
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.marketingAsset.update).not.toHaveBeenCalled();
  });
});

describe("deleteMarketingCollection", () => {
  it("refuses a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await deleteMarketingCollection("col1");
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.marketingCollection.delete).not.toHaveBeenCalled();
  });

  it("Architect M4: refuses a plain admin-area role (Accounts) — delete is Business Admin only, unlike archive/upload", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "Accounts" } });
    const r = await deleteMarketingCollection("col1");
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.marketingCollection.delete).not.toHaveBeenCalled();
  });

  it("Architect M1: deletes the asset rows + collection row in ONE TRANSACTION first, then the files — never files before the DB commit", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.marketingCollection.findUnique.mockResolvedValue({
      category: "Flyers",
      assets: [{ id: "a1", fileKey: "marketing/a1.pdf" }, { id: "a2", fileKey: "marketing/a2.png" }],
    });
    const order: string[] = [];
    deleteObjectMock.mockImplementation(async () => { order.push("deleteFile"); });
    prismaMock.marketingAsset.deleteMany.mockImplementation(async () => { order.push("deleteAssetRows"); return { count: 2 }; });
    prismaMock.marketingCollection.delete.mockImplementation(async () => { order.push("deleteCollection"); });

    const r = await deleteMarketingCollection("col1");

    expect(r).toEqual({ ok: true });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(deleteObjectMock).toHaveBeenCalledWith("marketing/a1.pdf");
    expect(deleteObjectMock).toHaveBeenCalledWith("marketing/a2.png");
    expect(order).toEqual(["deleteAssetRows", "deleteCollection", "deleteFile", "deleteFile"]);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "marketing.collection_deleted", entityId: "col1" }));
  });

  it("refuses a missing collection", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.marketingCollection.findUnique.mockResolvedValue(null);
    const r = await deleteMarketingCollection("nope");
    expect(r).toEqual({ ok: false, error: "notFound" });
  });
});
