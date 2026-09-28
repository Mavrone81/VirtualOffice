// A-17 screen 4: unit coverage for VerifyPanel's own decision logic — the
// two things a server test can't touch, since they never leave the client
// (the enable-only-when-allPass rule, and the reload-on-refusal path).
// Extracted to plain functions specifically so this doesn't need a DOM/
// component-render harness the repo has never carried.
import { describe, it, expect } from "vitest";
import { canConfirmVerify, nextStateAfterVerifyRefusal, type ChecklistState } from "./verify-panel-logic";

const passing: ChecklistState = { gates: [{ key: "G1", pass: true }], allPass: true, contentVersion: 3 };
const failing: ChecklistState = { gates: [{ key: "G3", pass: false, reasonKey: "requiredDocumentsMissing" }], allPass: false, contentVersion: 3 };

describe("canConfirmVerify", () => {
  it("is false with no checklist loaded yet", () => {
    expect(canConfirmVerify(null, false)).toBe(false);
  });
  it("is false when the server-computed checklist doesn't allPass — never re-derived here", () => {
    expect(canConfirmVerify(failing, false)).toBe(false);
  });
  it("is true once allPass and not pending", () => {
    expect(canConfirmVerify(passing, false)).toBe(true);
  });
  it("is false while a request is pending, even if allPass", () => {
    expect(canConfirmVerify(passing, true)).toBe(false);
  });
});

describe("nextStateAfterVerifyRefusal", () => {
  it("shows the refusal error and reloads the CURRENT checklist (e.g. G4 stale-version)", () => {
    const reloaded = { ok: true as const, gates: failing.gates, allPass: false, contentVersion: 4 };
    const next = nextStateAfterVerifyRefusal("staleVersion", reloaded);
    expect(next).toEqual({ checklist: { gates: failing.gates, allPass: false, contentVersion: 4 }, error: "staleVersion" });
  });

  it("prefers the refusal's own error text over the reload succeeding", () => {
    const reloaded = { ok: true as const, gates: passing.gates, allPass: true, contentVersion: 5 };
    const next = nextStateAfterVerifyRefusal("splitNotApproved", reloaded);
    expect(next.error).toBe("splitNotApproved");
  });

  it("discards the stale checklist when the reload itself ALSO fails, rather than leaving a possibly-stale allPass:true showing next to a fresh error", () => {
    const reload = { ok: false as const, error: "forbidden" };
    const next = nextStateAfterVerifyRefusal("staleVersion", reload);
    expect(next).toEqual({ checklist: null, error: "staleVersion" });
  });

  it("falls back to the reload's own error when the refusal carried none", () => {
    const reload = { ok: false as const, error: "notFound" };
    const next = nextStateAfterVerifyRefusal(undefined, reload);
    expect(next).toEqual({ checklist: null, error: "notFound" });
  });
});
