// Template provenance guard — the decision itself.
//
// This guard's failure mode is a document that looks correct, so "it compiled
// and nothing threw" is worth nothing here. What has to be demonstrated is that
// the guard actually SEPARATES the cases: that it says yes to a row signed
// against the current master and no to each distinct way a row can fail to be
// one, including the absent case that every pre-swap row in the real table has.
//
// Every table below asserts its own length before asserting behaviour. A guard
// test that iterates an accidentally-empty fixture passes every assertion in it
// and has measured nothing, which is the same shape of false comfort the guard
// itself exists to prevent.
import { describe, it, expect } from "vitest";
import { MASTER_TEMPLATE_SHA256 } from "./associate-agreement-coordinates";
import {
  checkAgreementTemplateProvenance,
  parseTemplateGuardOverride,
  TemplateGuardConfigError,
  type TemplateRefusalCode,
} from "./agreement-template-guard";

/** Obviously-fake 64-hex shas — never a real template digest. */
const FAKE_OTHER_SHA = "b".repeat(64);

const basePayload = {
  businessName: "Fake Trading Co",
  agreementAcceptedAt: "2026-09-01T00:00:00.000Z",
  agreementTemplateVersion: "V.2026-04",
};

describe("checkAgreementTemplateProvenance — stored sha matches the current master", () => {
  it("proceeds, and only on an exact match", () => {
    const verdict = checkAgreementTemplateProvenance({
      ...basePayload,
      agreementTemplateSha256: MASTER_TEMPLATE_SHA256,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict).toEqual({ ok: true, storedSha: MASTER_TEMPLATE_SHA256 });
  });

  it("is not fooled by a sha that merely looks like the master's", () => {
    // Near-misses, each a real shape of mistake: truncated, one character off,
    // uppercased, whitespace-padded. None of these identify the pinned file.
    const nearMisses = [
      MASTER_TEMPLATE_SHA256.slice(0, 63),
      MASTER_TEMPLATE_SHA256.slice(0, 63) + (MASTER_TEMPLATE_SHA256.endsWith("6") ? "7" : "6"),
      MASTER_TEMPLATE_SHA256.toUpperCase(),
      ` ${MASTER_TEMPLATE_SHA256} `,
      MASTER_TEMPLATE_SHA256 + "0",
    ];
    expect(nearMisses).toHaveLength(5);
    expect(new Set(nearMisses).size).toBe(5); // all genuinely distinct from each other
    for (const sha of nearMisses) {
      const verdict = checkAgreementTemplateProvenance({ ...basePayload, agreementTemplateSha256: sha });
      expect(verdict.ok, `near-miss sha must refuse: ${JSON.stringify(sha)}`).toBe(false);
    }
  });
});

describe("checkAgreementTemplateProvenance — stored sha differs", () => {
  it("refuses, reporting both shas so the operator can see which template it was signed against", () => {
    const verdict = checkAgreementTemplateProvenance({ ...basePayload, agreementTemplateSha256: FAKE_OTHER_SHA });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.code).toBe<TemplateRefusalCode>("mismatch");
    expect(verdict.storedSha).toBe(FAKE_OTHER_SHA);
    expect(verdict.reason).toContain(FAKE_OTHER_SHA);
    expect(verdict.reason).toContain(MASTER_TEMPLATE_SHA256);
  });
});

describe("checkAgreementTemplateProvenance — no stored sha at all", () => {
  // 🔴 THE CASE THAT MATTERS MOST. agreementTemplateSha256 was introduced by the
  // same commit that swapped the master, so in the real table "absent" is not a
  // rare edge — it is the marker on every single row signed against the OLD
  // clause set. If absent were treated as "unknown, proceed", the guard would
  // pass exactly the rows it was built to stop, and refuse none of them.
  const absentShapes: [label: string, payload: unknown][] = [
    ["key missing entirely (every pre-swap row)", { ...basePayload }],
    ["explicit null", { ...basePayload, agreementTemplateSha256: null }],
    ["explicit undefined", { ...basePayload, agreementTemplateSha256: undefined }],
    ["empty string", { ...basePayload, agreementTemplateSha256: "" }],
    ["payload is null (no submittedPayload JSON)", null],
    ["payload is undefined", undefined],
  ];

  it("has a non-empty table of absent shapes", () => {
    expect(absentShapes).toHaveLength(6);
  });

  it.each(absentShapes)("refuses when the sha is absent: %s", (_label, payload) => {
    const verdict = checkAgreementTemplateProvenance(payload);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.code).toBe<TemplateRefusalCode>("absent");
    expect(verdict.storedSha).toBeNull();
    // The refusal must say WHY absence is a refusal, because the next person to
    // read it under time pressure is the one who might otherwise "fix" it.
    expect(verdict.reason).toMatch(/older master/i);
  });

  it("refuses a version marker with no sha — the marker alone does not identify the template", () => {
    // The Oct swap kept the footer marker identical, so a row carrying
    // agreementTemplateVersion "V.2026-04" and no sha proves nothing at all.
    const verdict = checkAgreementTemplateProvenance({
      agreementTemplateVersion: "V.2026-04",
      agreementAcceptedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.code).toBe<TemplateRefusalCode>("absent");
  });
});

describe("checkAgreementTemplateProvenance — unreadable provenance", () => {
  const malformed: [label: string, value: unknown][] = [
    ["number", 123],
    ["boolean true", true],
    ["object", { sha: MASTER_TEMPLATE_SHA256 }],
    ["array containing the right sha", [MASTER_TEMPLATE_SHA256]],
    ["not hex", "z".repeat(64)],
    ["too short", "abc123"],
  ];

  it("has a non-empty table of malformed shapes", () => {
    expect(malformed).toHaveLength(6);
  });

  it.each(malformed)("refuses an unreadable sha: %s", (_label, value) => {
    const verdict = checkAgreementTemplateProvenance({ ...basePayload, agreementTemplateSha256: value });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.code).toBe<TemplateRefusalCode>("malformed");
  });

  it("refuses a non-object payload rather than reading a property off it", () => {
    const nonObjects: unknown[] = ["a string", 7, true, [], Symbol("x")];
    expect(nonObjects).toHaveLength(5);
    for (const payload of nonObjects) {
      expect(checkAgreementTemplateProvenance(payload).ok).toBe(false);
    }
  });
});

describe("parseTemplateGuardOverride — explicit, reasoned, impossible by default", () => {
  const GOOD_REASON = "authorised on 2026-10-04 for two individually vetted rows";

  it("returns null when nothing is set — the default state needs no flag to stay safe", () => {
    expect(parseTemplateGuardOverride({})).toBeNull();
    expect(parseTemplateGuardOverride({ OVERRIDE_TEMPLATE_GUARD_IDS: "" })).toBeNull();
    expect(parseTemplateGuardOverride({ OVERRIDE_TEMPLATE_GUARD_IDS: "   " })).toBeNull();
  });

  it("parses an explicit per-record allowlist with a reason", () => {
    const parsed = parseTemplateGuardOverride({
      OVERRIDE_TEMPLATE_GUARD_IDS: "cand-0001, cand-0002",
      OVERRIDE_TEMPLATE_GUARD_REASON: GOOD_REASON,
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.ids.size).toBe(2);
    expect([...parsed!.ids].sort()).toEqual(["cand-0001", "cand-0002"]);
    expect(parsed!.reason).toBe(GOOD_REASON);
  });

  it("refuses ids without a reason", () => {
    expect(() => parseTemplateGuardOverride({ OVERRIDE_TEMPLATE_GUARD_IDS: "cand-0001" })).toThrow(
      TemplateGuardConfigError,
    );
  });

  it("refuses a reason too short to be one", () => {
    const tooShort = ["x", "ok", "owner said yes"];
    expect(tooShort).toHaveLength(3);
    for (const reason of tooShort) {
      expect(() =>
        parseTemplateGuardOverride({
          OVERRIDE_TEMPLATE_GUARD_IDS: "cand-0001",
          OVERRIDE_TEMPLATE_GUARD_REASON: reason,
        }),
      ).toThrow(TemplateGuardConfigError);
    }
  });

  it("refuses a reason with no ids, rather than silently overriding nothing", () => {
    expect(() => parseTemplateGuardOverride({ OVERRIDE_TEMPLATE_GUARD_REASON: GOOD_REASON })).toThrow(
      TemplateGuardConfigError,
    );
  });

  it("has no syntax for 'every row' — wildcards are rejected, not treated as an id", () => {
    const wildcards = ["*", "ALL", "all", "any", "-", "*.*", "cand-0001,*"];
    expect(wildcards).toHaveLength(7);
    for (const ids of wildcards) {
      expect(
        () =>
          parseTemplateGuardOverride({
            OVERRIDE_TEMPLATE_GUARD_IDS: ids,
            OVERRIDE_TEMPLATE_GUARD_REASON: GOOD_REASON,
          }),
        `wildcard must be rejected: ${ids}`,
      ).toThrow(TemplateGuardConfigError);
    }
  });

  it("cannot be enabled by any of the obvious bypass flags someone might reach for", () => {
    // None of these are the override's variables, so none of them do anything.
    // This pins the absence of a second, easier door.
    const decoys = [
      { FORCE: "1" },
      { SKIP_TEMPLATE_CHECK: "1" },
      { IGNORE_TEMPLATE_SHA: "true" },
      { OVERRIDE_TEMPLATE_GUARD: "1" },
      { ALLOW_TEMPLATE_MISMATCH: "1" },
    ];
    expect(decoys).toHaveLength(5);
    for (const env of decoys) {
      expect(parseTemplateGuardOverride(env)).toBeNull();
    }
  });
});
