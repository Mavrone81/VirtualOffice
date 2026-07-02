// Supported locales for the app. Cookie-based (no URL segment).
export const locales = ["en", "zh-CN"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  "zh-CN": "中文",
};

// Short labels for the compact switcher.
export const localeShort: Record<Locale, string> = {
  en: "EN",
  "zh-CN": "中",
};

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (locales as readonly string[]).includes(v);
}
