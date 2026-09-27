import { describe, it, expect, vi, beforeEach } from "vitest";

// Pins the actorUserId contract logAudit's callers rely on (R1/DevSecOps):
// a backfill/CLI script must always pass one explicitly (null for a
// system/background run), because omitting it triggers a dynamic import of
// @/auth that isn't available outside a request — see lib/audit.ts's comment.

const { authMock, auditLogCreateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: { auditLog: { create: auditLogCreateMock } } }));

import { logAudit } from "./audit";

beforeEach(() => {
  authMock.mockReset();
  auditLogCreateMock.mockReset();
  auditLogCreateMock.mockResolvedValue(undefined);
});

describe("logAudit's actorUserId contract", () => {
  it("actorUserId omitted: calls auth() and records the session user's id", async () => {
    authMock.mockResolvedValue({ user: { id: "session-user-1" } });
    await logAudit({ action: "test.action", entityType: "Test" });
    expect(authMock).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorUserId: "session-user-1" }) }),
    );
  });

  it("actorUserId explicitly null: never calls auth(), records a null actor", async () => {
    await logAudit({ action: "test.action", entityType: "Test", actorUserId: null });
    expect(authMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorUserId: null }) }),
    );
  });

  it("actorUserId given explicitly: never calls auth(), records exactly that id", async () => {
    await logAudit({ action: "test.action", entityType: "Test", actorUserId: "explicit-actor-9" });
    expect(authMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorUserId: "explicit-actor-9" }) }),
    );
  });
});
