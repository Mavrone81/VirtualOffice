// Individual target editors moved out of one flat list at the foot of the page
// and into each team card (owner, 2026-10-07). The regression that move invites
// is silent: team membership is OPTIONAL, so anyone belonging to no team can
// quietly end up with no editor anywhere on the site, and the page still looks
// complete. The headline assertion here is therefore about the WHOLE roster,
// with its denominator taken from the associate list rather than from the teams
// — counting only the people I expected to find would answer a different
// question than the one that matters.
//
// Renders the real client component (jsdom — see vitest.config.ts's
// "components" project) and reads the DOM, since the claim is about where
// controls appear on screen.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v?.period ? `${k}:${String(v.period)}` : k,
}));
vi.mock("@/server/quota/team-actions", () => ({
  setTeamQuota: vi.fn(), clearTeamQuota: vi.fn(), setIndividualQuota: vi.fn(), clearIndividualQuota: vi.fn(),
}));
vi.mock("@/server/teams/actions", () => ({
  createTeam: vi.fn(), addTeamMember: vi.fn(), removeTeamMember: vi.fn(), setTeamDirector: vi.fn(),
}));

import { TeamsAdmin } from "./teams-admin";

const MONTH = "2026-10", YEAR = "2026";
const assoc = (id: string, name: string) => ({ id, name, designation: "SalesAssociate", monthlyTarget: null, yearlyTarget: null });

// Sylvia's two, Vincent's one, and one person on no team at all.
const ASSOCIATES = [assoc("a1", "Lim Xiong (EN0002)"), assoc("a2", "Tay Zhao Bin (EN0004)"), assoc("a3", "Kee Kim Huat (EN0005)"), assoc("a4", "Nobody Steam (EN0099)")];
const TEAMS = [
  { id: "t1", name: "Sylvia Lee Division", directorId: null, memberIds: ["a1", "a2"], monthlyTarget: null, yearlyTarget: null },
  { id: "t2", name: "Vincent Lim Division", directorId: null, memberIds: ["a3"], monthlyTarget: null, yearlyTarget: null },
];

const renderAdmin = (teams = TEAMS, associates = ASSOCIATES) =>
  render(<TeamsAdmin teams={teams} associates={associates} month={MONTH} year={YEAR} />);

// The monthly individual input carries this id, so counting them counts editors.
const editorsFor = (id: string) => document.querySelectorAll(`#iq-${id}-${MONTH}`);

afterEach(cleanup);

describe("Teams admin — individual targets live on the team card", () => {
  it("every associate has an individual target editor, whatever their team", () => {
    renderAdmin();
    // Denominator from the roster, not from the teams.
    const missing = ASSOCIATES.filter((a) => editorsFor(a.id).length === 0).map((a) => a.name);
    expect(missing).toEqual([]);
  });

  it("a member's editor is inside their own team's card, not a page-level list", () => {
    renderAdmin();
    const sylvia = screen.getByText("Sylvia Lee Division").closest("div[class*='rounded']") as HTMLElement;
    // The editor itself, by id, rather than the name — a member's name is
    // already on screen twice inside this card (the membership chip and the
    // target row), so matching on text would assert the chip just as happily.
    expect(sylvia.querySelector(`#iq-a1-${MONTH}`)).toBeTruthy();
    expect(sylvia.querySelector(`#iq-a3-${MONTH}`)).toBeNull();
  });

  // The reason the leftover card still exists at all.
  it("someone on no team keeps an editor, under the not-in-a-team heading", () => {
    renderAdmin();
    const card = screen.getByText("individualTargetsUnassignedHeading").closest("div[class*='rounded']")!;
    expect(within(card as HTMLElement).getByText("Nobody Steam (EN0099)")).toBeTruthy();
    expect(within(card as HTMLElement).queryByText("Lim Xiong (EN0002)")).toBeNull();
  });

  it("the not-in-a-team card is absent when everyone has a team", () => {
    renderAdmin(TEAMS, ASSOCIATES.slice(0, 3));
    expect(screen.queryByText("individualTargetsUnassignedHeading")).toBeNull();
    expect(editorsFor("a1").length).toBe(1);
  });

  // Control: proves editorsFor can return 0, so the first test's empty
  // `missing` list means "all present" rather than "the selector never matches".
  it("control — the editor selector really can come up empty", () => {
    renderAdmin([], []);
    expect(editorsFor("a1").length).toBe(0);
  });
});
