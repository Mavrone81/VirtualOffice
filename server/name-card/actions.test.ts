import { describe, it, expect, vi, beforeEach } from "vitest";

// B-8 (Samuel, 2026-09-26): the admin can edit any associate's card, audited
// with who, whose card, and before/after fields. An associate may only edit
// their own card, and only their Chinese name — the title stays admin-only,
// enforced server-side (not just left to the UI).

const { authMock, prismaMock, logAuditMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    nameCard: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    associate: { findUnique: vi.fn() },
  },
  logAuditMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
// Params-aware, so tests can assert the length caps' {max} actually reaches the message.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (k: string, params?: Record<string, unknown>) => (params ? `${k}:${JSON.stringify(params)}` : k),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { updateNameCard, updateAssociateNameCard } from "@/server/name-card/actions";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.nameCard.findFirst.mockResolvedValue(null);
  prismaMock.nameCard.create.mockResolvedValue({});
  prismaMock.nameCard.update.mockResolvedValue({});
});

describe("updateNameCard — editing your own card", () => {
  it("refuses an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null);
    const r = await updateNameCard({ chineseName: "张三" });
    expect(r).toEqual({ ok: false, error: "notSignedIn" });
    expect(prismaMock.nameCard.create).not.toHaveBeenCalled();
  });

  it("lets a Sales Associate set their own Chinese name", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await updateNameCard({ chineseName: "张三" });
    expect(r).toEqual({ ok: true });
    expect(prismaMock.nameCard.create).toHaveBeenCalledWith({ data: { userId: "u1", chineseName: "张三" } });
  });

  it("refuses a Sales Associate trying to set the card title directly (bypassing the UI), and writes nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await updateNameCard({ chineseName: "张三", customTitle: "CEO" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.nameCard.create).not.toHaveBeenCalled();
    expect(prismaMock.nameCard.update).not.toHaveBeenCalled();
  });

  it("refuses a Sales Director (non-admin manager) setting their own card title too", async () => {
    authMock.mockResolvedValue({ user: { id: "u2", role: "SalesDirector" } });
    const r = await updateNameCard({ customTitle: "Top Director" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });

  it("lets Business Admin set their own card title", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    const r = await updateNameCard({ customTitle: "Product Owner" });
    expect(r).toEqual({ ok: true });
    expect(prismaMock.nameCard.create).toHaveBeenCalledWith({ data: { userId: "admin1", customTitle: "Product Owner" } });
  });

  // Length caps (DevLead + architect review): the card has a fixed layout, so
  // an oversized value must be rejected server-side, not just left to the UI.
  // The error is a specific tooLong message with the actual limit (UIUX
  // review), not the generic invalidInput.
  it("rejects a chineseName over 20 chars, with a specific message naming the limit, and writes nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await updateNameCard({ chineseName: "字".repeat(21) });
    expect(r).toEqual({ ok: false, error: 'chineseNameTooLong:{"max":20}' });
    expect(prismaMock.nameCard.create).not.toHaveBeenCalled();
  });

  it("accepts a chineseName at exactly 20 chars", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await updateNameCard({ chineseName: "字".repeat(20) });
    expect(r).toEqual({ ok: true });
  });

  it("rejects a customTitle over 60 chars (from an admin, who otherwise could set it), with a specific message, and writes nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    const r = await updateNameCard({ customTitle: "T".repeat(61) });
    expect(r).toEqual({ ok: false, error: 'customTitleTooLong:{"max":60}' });
    expect(prismaMock.nameCard.create).not.toHaveBeenCalled();
  });
});

describe("updateAssociateNameCard — admin editing ANY associate's card (B-8)", () => {
  const assoc = { associateCode: "EN0042", user: { id: "assoc-user-1" } };

  it("refuses a non-admin (e.g. Sales Director) and writes/audits nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "sd1", role: "SalesDirector" } });
    const r = await updateAssociateNameCard("a1", { customTitle: "Boss" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.associate.findUnique).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("refuses Accounts (admin-area role, but not the manage_others_name_card capability)", async () => {
    authMock.mockResolvedValue({ user: { id: "acc1", role: "Accounts" } });
    const r = await updateAssociateNameCard("a1", { customTitle: "Boss" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("returns associateNoLogin when the target has no user account, and writes/audits nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.associate.findUnique.mockResolvedValue({ associateCode: "EN0099", user: null });
    const r = await updateAssociateNameCard("a-no-login", { chineseName: "李四" });
    expect(r).toEqual({ ok: false, error: "associateNoLogin" });
    expect(prismaMock.nameCard.create).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("Admin can edit both chineseName and customTitle on someone else's card, and it's audited with who/whose card/before-after", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.associate.findUnique.mockResolvedValue(assoc);
    prismaMock.nameCard.findFirst
      .mockResolvedValueOnce({ id: "card1", chineseName: "旧名", customTitle: "Old Title" }) // readCard (before)
      .mockResolvedValueOnce({ id: "card1" }); // upsertCard's own lookup

    const r = await updateAssociateNameCard("a1", { chineseName: "新名", customTitle: "New Title" });

    expect(r).toEqual({ ok: true });
    expect(prismaMock.nameCard.update).toHaveBeenCalledWith({
      where: { id: "card1" },
      data: { chineseName: "新名", customTitle: "New Title" },
    });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.action).toBe("name_card.updated_by_admin");
    expect(call.entityType).toBe("NameCard");
    expect(call.entityId).toBe("a1"); // keyed by associateId, not the NameCard row's own id
    expect(call.actorUserId).toBe("admin1"); // who
    expect(call.before).toEqual({ associateId: "a1", associateCode: "EN0042", chineseName: "旧名", customTitle: "Old Title" }); // whose card + before
    expect(call.after).toEqual({ associateId: "a1", associateCode: "EN0042", chineseName: "新名", customTitle: "New Title" }); // whose card + after
  });

  it("creates a fresh card (no prior row) and audits before as all-null", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.associate.findUnique.mockResolvedValue(assoc);
    prismaMock.nameCard.findFirst.mockResolvedValue(null); // no existing card at any lookup

    const r = await updateAssociateNameCard("a1", { customTitle: "First Title" });

    expect(r).toEqual({ ok: true });
    expect(prismaMock.nameCard.create).toHaveBeenCalledWith({ data: { userId: "assoc-user-1", customTitle: "First Title" } });
    const call = logAuditMock.mock.calls[0][0];
    expect(call.entityId).toBe("a1"); // same associateId key even before any card row exists
    expect(call.before).toEqual({ associateId: "a1", associateCode: "EN0042", chineseName: null, customTitle: null });
    expect(call.after).toEqual({ associateId: "a1", associateCode: "EN0042", chineseName: null, customTitle: "First Title" });
  });

  it("only changes the field(s) provided — editing the title alone leaves chineseName out of the write", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.associate.findUnique.mockResolvedValue(assoc);
    prismaMock.nameCard.findFirst
      .mockResolvedValueOnce({ id: "card1", chineseName: "保留名", customTitle: "Old" })
      .mockResolvedValueOnce({ id: "card1" });

    await updateAssociateNameCard("a1", { customTitle: "Only Title Changed" });

    expect(prismaMock.nameCard.update).toHaveBeenCalledWith({ where: { id: "card1" }, data: { customTitle: "Only Title Changed" } });
    const call = logAuditMock.mock.calls[0][0];
    // after.chineseName carries forward the unchanged value, not undefined/null.
    expect(call.after.chineseName).toBe("保留名");
  });

  it("rejects an oversized chineseName from an admin editing someone else's card too, with a specific message, and audits nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.associate.findUnique.mockResolvedValue(assoc);

    const r = await updateAssociateNameCard("a1", { chineseName: "字".repeat(21) });

    expect(r).toEqual({ ok: false, error: 'chineseNameTooLong:{"max":20}' });
    expect(prismaMock.nameCard.create).not.toHaveBeenCalled();
    expect(prismaMock.nameCard.update).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized customTitle from an admin, with a specific message", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.associate.findUnique.mockResolvedValue(assoc);

    const r = await updateAssociateNameCard("a1", { customTitle: "T".repeat(61) });

    expect(r).toEqual({ ok: false, error: 'customTitleTooLong:{"max":60}' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
