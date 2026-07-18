import { describe, it, expect } from "vitest";
import { canManageSignedInvoice } from "./invoice-access";

// 16-Jul Flow: the closing associate gets the client to sign the generated
// invoice and uploads the signed copy. Back-office (Business Admin / Accounts)
// may also manage it; no one else can.
describe("canManageSignedInvoice", () => {
  const inv = { closingAssociateId: "a1" };

  it("allows the closing associate", () => {
    expect(canManageSignedInvoice(inv, { associateId: "a1", role: "SalesAssociate" })).toBe(true);
  });

  it("denies a different associate", () => {
    expect(canManageSignedInvoice(inv, { associateId: "a2", role: "SalesAssociate" })).toBe(false);
  });

  it("denies a manager who did not close the sale", () => {
    expect(canManageSignedInvoice(inv, { associateId: "sm1", role: "SalesManager" })).toBe(false);
  });

  it("allows a Business Admin regardless of associate link", () => {
    expect(canManageSignedInvoice(inv, { associateId: null, role: "Admin" })).toBe(true);
  });

  it("allows Accounts (finance back-office)", () => {
    expect(canManageSignedInvoice(inv, { associateId: null, role: "Accounts" })).toBe(true);
  });

  it("denies when the principal has no associate link and is not back-office", () => {
    expect(canManageSignedInvoice(inv, { associateId: null, role: "SalesDirector" })).toBe(false);
  });
});
