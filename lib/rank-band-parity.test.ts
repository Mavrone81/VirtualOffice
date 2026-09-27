import { describe, it, expect } from "vitest";
import en from "../messages/en.json";
import zhCN from "../messages/zh-CN.json";
import { RANK_BANDS } from "./rank-band";

// A-2 (DevLead review): band labels live in messages, keyed by
// portal.dashboard.band.<RANK_BANDS id>, not in RANK_BANDS itself. No
// whole-file en/zh key-parity test exists yet (lib/check-duplicate-keys.test.ts
// only checks for duplicate keys within one file) — this pins parity for
// just these 6 keys, so a future band edit can't add an id without both
// translations.
describe("portal.dashboard.band — en/zh key parity with RANK_BANDS", () => {
  const enBand = (en as { portal: { dashboard: { band: Record<string, string> } } }).portal.dashboard.band;
  const zhBand = (zhCN as { portal: { dashboard: { band: Record<string, string> } } }).portal.dashboard.band;

  it.each(RANK_BANDS.map((b) => b.id))("has a non-empty en AND zh label for band id '%s'", (id) => {
    expect(enBand[id]?.length).toBeGreaterThan(0);
    expect(zhBand[id]?.length).toBeGreaterThan(0);
  });

  it("has no extra band keys beyond RANK_BANDS' ids, in either language", () => {
    const ids = new Set(RANK_BANDS.map((b) => b.id));
    expect(new Set(Object.keys(enBand))).toEqual(ids);
    expect(new Set(Object.keys(zhBand))).toEqual(ids);
  });
});
