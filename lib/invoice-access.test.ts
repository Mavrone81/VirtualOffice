import { describe, it, expect } from "vitest";
import { canManageSignedInvoice, canViewPaymentAck } from "./invoice-access";

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

// B-7 (owner ruling): closer, direct upline, or 2nd upline — the two tiers
// the register tracks, not a recursive chain. Route coverage already proves
// this end-to-end on real rows (server/invoices/b7-ack-routes.test.ts); this
// is the fast, isolated guard on the predicate itself.
describe("canViewPaymentAck", () => {
  const inv = { closingAssociateId: "closer", closingAssociateDirectUplineId: "upline1", closingAssociateSecondUplineId: "upline2" };

  it("allows the closing associate", () => {
    expect(canViewPaymentAck(inv, { associateId: "closer", role: "SalesAssociate" })).toBe(true);
  });

  it("allows the direct upline", () => {
    expect(canViewPaymentAck(inv, { associateId: "upline1", role: "SalesAssociate" })).toBe(true);
  });

  it("allows the 2nd upline", () => {
    expect(canViewPaymentAck(inv, { associateId: "upline2", role: "SalesAssociate" })).toBe(true);
  });

  it("denies an associate who is neither the closer nor either upline tier", () => {
    expect(canViewPaymentAck(inv, { associateId: "unrelated", role: "SalesAssociate" })).toBe(false);
  });

  it("denies a 3rd-tier upline (beyond what the register tracks)", () => {
    const noSecondUpline = { ...inv, closingAssociateSecondUplineId: null };
    expect(canViewPaymentAck(noSecondUpline, { associateId: "upline3-would-be", role: "SalesAssociate" })).toBe(false);
  });

  it("allows a Business Admin regardless of associate link", () => {
    expect(canViewPaymentAck(inv, { associateId: null, role: "Admin" })).toBe(true);
  });

  it("allows Accounts (finance back-office)", () => {
    expect(canViewPaymentAck(inv, { associateId: null, role: "Accounts" })).toBe(true);
  });

  it("denies when the principal has no associate link and is not back-office", () => {
    expect(canViewPaymentAck(inv, { associateId: null, role: "SalesDirector" })).toBe(false);
  });
});
