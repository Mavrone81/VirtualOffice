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

  // A14: the name-card field label is 中文名 (distinct from A-15 below).
  it("nameCard.chineseName reads 中文名 in both locales", () => {
    expect(en.nameCard.chineseName).toBe("中文名");
    expect(zhCN.nameCard.chineseName).toBe("中文名");
  });

  // A-15 (the project owner, Q10, 2026-09-26): split by portal. The associate Marketing
  // menu item + its page title read 中文名; the admin Marketing library keeps
  // "Customisation" (shared nav.customisation would otherwise leak into both).
  it("the associate Customisation menu item and its page title read 中文名", () => {
    expect(en.nav.chineseNameMenu).toBe("中文名");
    expect(zhCN.nav.chineseNameMenu).toBe("中文名");
    expect(en.marketing.customisation.title).toBe("中文名");
    expect(zhCN.marketing.customisation.title).toBe("中文名");
  });

  it("the admin Marketing library keeps the Customisation label", () => {
    expect(en.nav.customisation).toBe("Customisation");
    expect(zhCN.nav.customisation).toBe("定制服务");
  });
});
