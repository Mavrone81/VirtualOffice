import { describe, it, expect, vi, beforeEach } from "vitest";

// Audit reliability (reviews/audit-reliability.md): Tier B stays best-effort but
// visible (payload-free tag + auditOk), Tier A's auditTx throws so the caller's
// transaction rolls back. Module state (the failure counter) is per test via
// resetModules.

const create = vi.fn();
vi.mock("./db", () => ({ prisma: { auditLog: { create: (...a: unknown[]) => create(...a) } } }));

beforeEach(() => {
  vi.resetModules();
  create.mockReset();
});

describe("logAudit (Tier B)", () => {
  it("never throws, logs only a payload-free tag, and flips auditOk", async () => {
    const { logAudit } = await import("./audit");
    const { auditOk } = await import("./audit-status");
    const { GET } = await import("@/app/api/health/route");
    expect(auditOk()).toBe(true);
    expect((await (await GET()).json()).auditOk).toBe(true);

    // A driver error message may contain the payload; the log line must not.
    const err = Object.assign(new Error('Invalid `prisma.auditLog.create()` invocation: { afterJson: { nric: "S1234567D" } }'), { code: "P2009" });
    create.mockRejectedValueOnce(err);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(logAudit({ action: "notice.published", entityType: "Notice", entityId: "n1", after: { nric: "S1234567D" }, actorUserId: "u1" })).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0].join(" "));
    expect(line).toBe("[audit-failed] notice.published Notice Error P2009");
    expect(line).not.toContain("S1234567D");
    expect(auditOk()).toBe(false);
    expect((await (await GET()).json()).auditOk).toBe(false);
    logged.mockRestore();
  });
});

describe("auditTx (Tier A)", () => {
  it("writes through the transaction client with the given actor", async () => {
    const { auditTx } = await import("./audit");
    const tx = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
    await auditTx(tx as never, { action: "invoice.marked_paid", entityType: "Invoice", entityId: "i1", actorUserId: null });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: { actorUserId: null, action: "invoice.marked_paid", entityType: "Invoice", entityId: "i1", beforeJson: undefined, afterJson: undefined },
    });
    expect(create).not.toHaveBeenCalled(); // never the global client
  });

  it("throws when the write fails, so the caller's transaction rolls back", async () => {
    const { auditTx, AuditWriteError } = await import("./audit");
    const { auditOk } = await import("./audit-status");
    const tx = { auditLog: { create: vi.fn().mockRejectedValue(new Error('db down: { afterJson: { nric: "S1234567D" } }')) } };
    const err = await auditTx(tx as never, { action: "x", entityType: "Y", actorUserId: "u" }).catch((e) => e);
    expect(err).toBeInstanceOf(AuditWriteError);
    expect(err.message).toBe("audit write failed for x; the action was not saved");
    expect(err.message).not.toContain("S1234567D"); // the payload stays out of the message
    expect(auditOk()).toBe(true); // Tier A failures surface as errors, not as the Tier-B counter
  });
});
