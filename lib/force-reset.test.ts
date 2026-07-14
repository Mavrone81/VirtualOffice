import { describe, it, expect } from "vitest";
import { FORCE_RESET_PATH, shouldForceReset } from "@/lib/force-reset";

describe("shouldForceReset", () => {
  it("redirects a logged-in must-reset user away from a normal page", () => {
    expect(shouldForceReset({ isLoggedIn: true, mustReset: true, pathname: "/admin/dashboard" })).toBe(true);
  });

  it("does NOT redirect when already on the force-reset page (no loop)", () => {
    expect(shouldForceReset({ isLoggedIn: true, mustReset: true, pathname: FORCE_RESET_PATH })).toBe(false);
  });

  it("does not redirect a user who does not need to reset", () => {
    expect(shouldForceReset({ isLoggedIn: true, mustReset: false, pathname: "/admin/dashboard" })).toBe(false);
  });

  it("does not redirect an anonymous user (login flow handles that)", () => {
    expect(shouldForceReset({ isLoggedIn: false, mustReset: true, pathname: "/admin/dashboard" })).toBe(false);
  });

  it("still forces reset even from the login page", () => {
    expect(shouldForceReset({ isLoggedIn: true, mustReset: true, pathname: "/login" })).toBe(true);
  });
});
