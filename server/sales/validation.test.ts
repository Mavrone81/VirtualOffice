import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get() { throw new Error("DB must not be touched on invalid input"); } }) }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { associateId: "a1" } }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
import { submitSale } from "./actions";
describe("submitSale validation", () => {
  it("returns invalidInput and never touches the DB for malformed input", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed input, per Task 2 brief Step 1
    const r = await submitSale({ clientName: "", lines: [] } as any);
    expect(r).toEqual({ ok: false, error: "invalidInput" });
  });
});
