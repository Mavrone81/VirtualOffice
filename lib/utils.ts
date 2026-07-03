export function initialsOf(name?: string | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase() || "U";
}

// Localized current month label for the top-bar period chip (e.g. "July 2026" /
// "2026年7月").
export function currentPeriod(locale: string): string {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-SG", {
    month: "long",
    year: "numeric",
  }).format(new Date());
}
