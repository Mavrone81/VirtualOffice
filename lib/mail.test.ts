import { describe, it, expect } from "vitest";
import { approvalEmail } from "./mail";

// #29: approvalEmail no longer takes a password at all — nothing to leak by
// construction, since there's no plaintext parameter for the renderer to
// receive. This is the positive assertion on the rendered body: the set-
// password link is present, and nothing shaped like a credential is.
describe("approvalEmail (#29 — link, not a temp password)", () => {
  it("renders the set-password link and nothing credential-shaped", () => {
    const url = "https://vo.example.com/reset-password/abcDEF123-token";
    const m = approvalEmail("Jane Tan", url, "jane@example.com");

    expect(m.html).toContain(url);
    expect(m.html).toContain("jane@example.com");
    expect(m.html).not.toMatch(/temporary password/i);
    expect(m.html).not.toMatch(/临时密码/);
    expect(m.html).not.toMatch(/font-family:\s*monospace/); // the old credential-table styling
  });

  it("approvalEmail's own type signature has no password-shaped parameter", () => {
    // Compile-time guarantee, asserted at runtime too: the function takes
    // exactly 3 args (name, setPasswordUrl, email) — a 4th positional slot
    // for a password can't silently come back without this failing.
    expect(approvalEmail.length).toBe(3);
  });
});
