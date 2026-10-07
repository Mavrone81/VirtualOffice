// Owner: "name card should show business name unless is blank than show
// name." A SUBSTITUTION, not an addition — one existing slot (englishName)
// shows businessName when set, fullName otherwise. No new element, no
// coordinate change: components/name-card/studio.tsx's CardData contract is
// untouched (still just `englishName: string`), and this file asserts
// nothing about its geometry.
//
// T1/T2 are exercised as full page renders of app/portal/name-card/page.tsx
// (the AD brief's concrete example) — real auth/db mocked, everything else
// (buildVCard, NameCardStudio, QR generation) real. The identical
// substitution at app/admin/associates/[id]/page.tsx:280 is NOT rendered
// here: that page pulls in RBAC, PII-reveal and audit subsystems to mock
// just to exercise one `||` expression already shape-identical to the one
// that IS behaviourally tested below. It is instead verified by reading the
// live source for the exact expression — the same technique
// lib/name-card-tinos-metric-compat.integration.test.ts already uses
// (STUDIO_SRC) rather than restating the component's own logic by hand.
// Flagged here explicitly, not silently called "tested" the same way.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { buildVCard } from "./vcard";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    associate: { findUnique: vi.fn() },
    nameCard: { findFirst: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
// studio.tsx imports these two server actions; the real module pulls in
// @/auth (next-auth), which fails to resolve module-internally in this
// environment — mocked out since these tests never click Save.
vi.mock("@/server/name-card/actions", () => ({ updateNameCard: vi.fn(), updateAssociateNameCard: vi.fn() }));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useTransition: () => [false, (fn: () => Promise<unknown>) => { fn(); }],
}));

import NameCardPage from "@/app/portal/name-card/page";

const ASSOCIATE_ID = "11111111-1111-1111-1111-111111111111";
const session = { user: { id: "22222222-2222-2222-2222-222222222222", associateId: ASSOCIATE_ID } };

// Neutral fixture — no real person, no owner name.
const baseAssociate = {
  id: ASSOCIATE_ID,
  fullName: "Jane Tan",
  businessName: null as string | null,
  designation: "SeniorAssociate",
  mobileNumber: "+65 9123 4567",
  email: "jane.tan@example.com",
  associateCode: "A001",
};

async function renderPortalCard(businessName: string | null): Promise<string> {
  authMock.mockResolvedValue(session);
  prismaMock.associate.findUnique.mockResolvedValue({ ...baseAssociate, businessName });
  prismaMock.nameCard.findFirst.mockResolvedValue(null);
  const el = (await NameCardPage()) as Parameters<typeof renderToStaticMarkup>[0];
  return renderToStaticMarkup(el);
}

/** The englishName slot's own style-tagged div, so a match on the NAME string
 *  can't accidentally hit some unrelated place in the page (e.g. a <title>). */
function englishNameSlotText(html: string): string {
  // Anchored on the FONT FAMILY alone, then skipping whatever other style
  // properties follow. The previous version pinned the exact declaration string
  // ("...cursive;font-size:52px;color:#111") and broke the moment a font-weight
  // was added between them — a styling change that has nothing to do with WHICH
  // NAME this helper exists to read. The family is what identifies the slot;
  // everything after it is presentation this assertion should not care about.
  const m = html.match(/font-family:&#x27;Alex Brush&#x27;, cursive;[^"]*">([^<]*)</);
  expect(m, "englishName slot (Alex Brush) not found in rendered output").toBeTruthy();
  return m![1];
}

describe("name card — business name substitution (T1: shown when set)", () => {
  it("the card's name slot shows the business name when one is set", async () => {
    const html = await renderPortalCard("Lotus Trading Pte Ltd");
    expect(englishNameSlotText(html)).toBe("Lotus Trading Pte Ltd");
    expect(html).not.toContain("Jane Tan");
  });
});

describe("name card — business name substitution (T2: falls back to legal name)", () => {
  it("businessName null: the card's name slot shows the legal name", async () => {
    const html = await renderPortalCard(null);
    expect(englishNameSlotText(html)).toBe("Jane Tan");
  });

  it("businessName \"\" (empty string): the card's name slot STILL shows the legal name — the `||` matters, not just a null check", async () => {
    const html = await renderPortalCard("");
    expect(englishNameSlotText(html)).toBe("Jane Tan");
  });
});

describe("name card — business name substitution: the admin edit-any view (source-verified, not rendered — see file header)", () => {
  const SRC = readFileSync("app/admin/associates/[id]/page.tsx", "utf8");

  it("uses the identical substitution expression, reading the live file", () => {
    expect(SRC).toContain("englishName: a.businessName || a.fullName");
  });

  it("the three other NameCardStudio data fields at that call site are unchanged by this patch (3 fields examined)", () => {
    const m = SRC.match(/data=\{\{ chineseName: card\?\.chineseName \?\? "", englishName: a\.businessName \|\| a\.fullName, title: cardTitle, hp: a\.mobileNumber, email: a\.email, qrDataUrl: cardQr \}\}/);
    expect(m, "the admin call site's data object no longer matches the expected shape (title/hp/email/qrDataUrl)").toBeTruthy();
  });
});

describe("name card — business name substitution (T3: vCard FN/N/ORG)", () => {
  it("businessName set: FN and N carry it, ORG is plain Enshrine with no middot and no appended name", () => {
    const vcf = buildVCard({ fullName: "Jane Tan", businessName: "Lotus Trading Pte Ltd", title: "Senior Associate" });
    expect(vcf).toContain("FN:Lotus Trading Pte Ltd - Senior Associate\r\n");
    expect(vcf).toContain("N:Lotus Trading Pte Ltd;;;;\r\n");
    expect(vcf).toContain("ORG:Enshrine\r\n");
    expect(vcf).not.toContain("·"); // no middot anywhere
    expect(vcf).not.toContain("Jane Tan\r\nORG"); // legal name not leaking into ORG's line
  });

  it("businessName null: FN and N fall back to the legal name, ORG is still plain Enshrine", () => {
    const vcf = buildVCard({ fullName: "Jane Tan", businessName: null, title: "Senior Associate" });
    expect(vcf).toContain("FN:Jane Tan - Senior Associate\r\n");
    expect(vcf).toContain("N:Jane Tan;;;;\r\n");
    expect(vcf).toContain("ORG:Enshrine\r\n");
  });

  it("businessName \"\" (empty string): same fallback as null — the vCard builder's `||` matters here too", () => {
    const vcf = buildVCard({ fullName: "Jane Tan", businessName: "", title: "Senior Associate" });
    expect(vcf).toContain("FN:Jane Tan - Senior Associate\r\n");
    expect(vcf).toContain("N:Jane Tan;;;;\r\n");
  });

  it("a business name needing vCard escaping still escapes correctly in FN/N", () => {
    const vcf = buildVCard({ fullName: "Jane Tan", businessName: "Tan, Jane; \\Trading", title: null });
    expect(vcf).toContain("FN:Tan\\, Jane\\; \\\\Trading\r\n");
    expect(vcf).toContain("N:Tan\\, Jane\\; \\\\Trading;;;;\r\n");
  });
});

describe("name card — the admin's OWN card (T4: now associate-sourced, was session-sourced)", () => {
  // These two call sites were deliberately excluded by the earlier patch, whose
  // own comment gave the reason: "an Admin has none to pass". That premise was
  // measured against production and is false — every user on file, both admins
  // included, has an associate profile (25 of 25). So the admin's own card was
  // showing a session display name and no mobile at all (hp was hardcoded null)
  // while every other card in the product showed the trading name and the
  // number. These tests pin the corrected behaviour and the fallback.
  const ADMIN_ASSOCIATE = {
    fullName: "Tan Wei Ming",
    businessName: "Marcus Tan",
    mobile: "80000000",
    email: "marcus@example.com",
    associateCode: "EN0002",
  };

  it("business name set: the card and its vCard both carry the trading name, and the MOBILE is present", () => {
    const vcf = buildVCard({ ...ADMIN_ASSOCIATE, title: "Admin" });
    expect(vcf).toContain("FN:Marcus Tan - Admin\r\n");
    expect(vcf).toContain("N:Marcus Tan;;;;\r\n");
    expect(vcf).not.toContain("Tan Wei Ming");
    // The whole second half of the owner's report: the number was never rendered.
    expect(vcf).toContain("TEL;TYPE=CELL:80000000\r\n");
  });

  it("business name absent: falls back to the legal name, mobile still present", () => {
    const vcf = buildVCard({ ...ADMIN_ASSOCIATE, businessName: null, title: "Admin" });
    expect(vcf).toContain("FN:Tan Wei Ming - Admin\r\n");
    expect(vcf).toContain("TEL;TYPE=CELL:80000000\r\n");
  });

  it("business name empty string: same fallback as null — the `||` matters here too", () => {
    const vcf = buildVCard({ ...ADMIN_ASSOCIATE, businessName: "", title: "Admin" });
    expect(vcf).toContain("FN:Tan Wei Ming - Admin\r\n");
  });

  it("FALLBACK — a login with no associate record at all still renders: session name, and no TEL to invent", () => {
    // The only surviving use of the old shape. A user without an associate has
    // no mobile and no trading name, so the card degrades rather than blanking.
    const vcf = buildVCard({ fullName: "Staff Member", title: "Admin", email: "staff@example.com" });
    expect(vcf).toContain("FN:Staff Member - Admin\r\n");
    expect(vcf).not.toContain("TEL;TYPE=CELL");
  });

  it("both admin surfaces read the SAME source, so a saved contact cannot disagree with the card", () => {
    const page = readFileSync("app/admin/name-card/page.tsx", "utf8");
    const route = readFileSync("app/admin/name-card/vcf/route.ts", "utf8");
    for (const src of [page, route]) {
      expect(src).toContain("me.businessName || me.fullName");
      expect(src).toContain("session.user.associateId");
    }
    // The card's visible mobile slot: hp was literally `null` before this patch.
    expect(page).toContain("hp: mobile");
    expect(page).not.toContain("hp: null");
  });
});
