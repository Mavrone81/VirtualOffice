import { getTranslations } from "next-intl/server";
import { Banner } from "@/components/ui/banner";

// A-17 screen 7: label a flow=Legacy sale so it isn't mistaken for a new
// closed-deal record once both exist side by side (build-plan-a-b.md A-17
// item 5 — "the 12 existing records stay as read-only history ... clearly
// labelled"). Reuses errors.legacyReadOnly, the same string verifySale and
// getVerifyChecklist already refuse a legacy submission with, so the reason
// a legacy record can't go through Verify and the label on it are one string,
// not two that could drift.
export async function LegacyBanner() {
  const t = await getTranslations("errors");
  return <Banner tone="info">{t("legacyReadOnly")}</Banner>;
}
