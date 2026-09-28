import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import zhCN from "@/messages/zh-CN.json";

function keyPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("i18n key parity (en vs zh-CN)", () => {
  it("has the same set of message keys in both locales", () => {
    const enKeys = new Set(keyPaths(en));
    const zhKeys = new Set(keyPaths(zhCN));
    expect([...enKeys].filter((k) => !zhKeys.has(k))).toEqual([]);
    expect([...zhKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  // A14, revised by Samuel 28 Sep: the name-card field reads "Chinese Name" in
  // English and 中文名 in Chinese (its placeholder is 中文名, not a sample name).
  it("nameCard.chineseName reads Chinese Name / 中文名", () => {
    expect(en.nameCard.chineseName).toBe("Chinese Name");
    expect(zhCN.nameCard.chineseName).toBe("中文名");
  });

  // A-15 revised by Samuel 28 Sep: the associate Marketing menu item and its
  // page title read "Customisation" (same wording as the admin library), not 中文名.
  it("the associate Customisation menu item and its page title read Customisation", () => {
    expect(en.nav.chineseNameMenu).toBe(en.nav.customisation);
    expect(zhCN.nav.chineseNameMenu).toBe(zhCN.nav.customisation);
    expect(en.marketing.customisation.title).toBe(en.nav.customisation);
    expect(zhCN.marketing.customisation.title).toBe(zhCN.nav.customisation);
  });

  it("the admin Marketing library keeps the Customisation label", () => {
    expect(en.nav.customisation).toBe("Customisation");
    expect(zhCN.nav.customisation).toBe("定制服务");
  });
});
