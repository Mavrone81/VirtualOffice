import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";

type Dict = { [k: string]: unknown };

// Deep-merge active-locale messages over English so ANY missing key (at any
// nesting depth) falls back to the English string instead of showing the key.
function deepMerge(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") {
      out[k] = deepMerge(base[k] as Dict, v as Dict);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Resolve the active locale from the NEXT_LOCALE cookie (default English) and
// load its message catalog.
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  const en = (await import(`../messages/en.json`)).default as Dict;
  const messages = locale === "en" ? en : deepMerge(en, (await import(`../messages/${locale}.json`)).default as Dict);

  return { locale, messages };
});
