// Covers the gap a return-value test would never catch: a correct server action
// nobody can reach is still a failure. Renders the REAL AssociateRowActions
// component (jsdom, @testing-library/react — see vitest.config.ts's "components"
// project), clicks the actual Delete control, and asserts the refusal's {count}
// appears as text on the screen — not on deleteAssociate's return value, which a
// passing test here never even inspects directly.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  deleteAssociate: vi.fn(),
  archiveAssociate: vi.fn(),
  setApprovalStatus: vi.fn(),
  setAssociateStatus: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/server/associates/actions", () => ({
  deleteAssociate: mocks.deleteAssociate,
  archiveAssociate: mocks.archiveAssociate,
  setApprovalStatus: mocks.setApprovalStatus,
  setAssociateStatus: mocks.setAssociateStatus,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
// Real message strings, not key echoes: the point of this test is that the
// {count} the server already interpolated (see server/associates/actions.ts)
// reaches the screen, so the translation function has to behave like the real
// one for the one key this test touches, not just return the key name back.
// The component calls useTranslations twice, with different namespaces
// ("associates" and "common") — this mock ignores which one was requested, so
// the lookup table below has to cover both. Real strings, not key echoes: the
// point of these tests is that text a user would actually read reaches the
// screen, and a mock that just returns the key name back would make
// `getByRole("button", { name: "Delete" })` fail to find "delete" regardless
// of whether the real translation file and the component agree.
const STRINGS: Record<string, string> = {
  archive: "Archive",
  unarchive: "Unarchive",
  deleteConfirm: "Delete permanently",
  failed: "Failed",
  delete: "Delete",
  cancel: "Cancel",
};
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => STRINGS[key] ?? key,
}));

import { AssociateRowActions } from "./row-actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssociateRowActions — delete", () => {
  it("renders the refusal message, WITH its count, after a real click — not the action's return value", async () => {
    // Exactly what deleteAssociate (server/associates/actions.ts) actually
    // returns for this case — same shape, same key, same interpolated count.
    mocks.deleteAssociate.mockResolvedValue({ ok: false, error: "Has 3 associate(s) reporting to them — archive instead of deleting." });

    render(<AssociateRowActions id="a1" approval="Approved" status="Inactive" archived={false} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    // The count is asserted as RENDERED TEXT, found via getByRole("alert") (this
    // component sets role="alert" on the error span) — not by reading
    // mocks.deleteAssociate's resolved value, which this assertion never touches.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Has 3 associate(s) reporting to them — archive instead of deleting.");
    expect(alert.textContent).toContain("3");

    expect(mocks.deleteAssociate).toHaveBeenCalledWith("a1");
    expect(mocks.refresh).not.toHaveBeenCalled(); // refused — the row must not refresh as if it succeeded
  });

  it("on success, closes the panel and refreshes — no refusal text left on screen", async () => {
    mocks.deleteAssociate.mockResolvedValue({ ok: true });

    render(<AssociateRowActions id="a2" approval="Approved" status="Inactive" archived={false} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Archive and Delete are not the same control: both render, and Delete alone requires a second click to act", async () => {
    render(<AssociateRowActions id="a3" approval="Approved" status="Inactive" archived={false} />);

    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton).toBeTruthy();

    const user = userEvent.setup();
    await user.click(deleteButton);
    // The real server action must NOT have been called by the first click alone
    // — only the expand panel appears. This is the "not a browser confirm()"
    // requirement made concrete: a single click must be reversible with no
    // side effect yet.
    expect(mocks.deleteAssociate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeTruthy();
  });

  it("archived=true renders Unarchive, not Archive/Delete", () => {
    render(<AssociateRowActions id="a4" approval="Approved" status="Inactive" archived={true} />);
    expect(screen.getByRole("button", { name: "Unarchive" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
