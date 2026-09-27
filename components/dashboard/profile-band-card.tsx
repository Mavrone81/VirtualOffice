import { Suspense } from "react";
import { Medal } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { myRankResult } from "@/server/dashboard/rank";

/**
 * A-2 — profile card: name, designation, position band (docs/design/
 * a2-profile-band.md). Name/designation are session/profile data (no
 * fetch); the band row is its own async boundary so a slower or failing
 * rank query never delays or breaks the rest of the card.
 */
export function ProfileBandCard({ name, designation, associateId }: { name: string; designation: string; associateId: string }) {
  return (
    <Card className="max-w-sm p-4">
      <p className="font-display text-[18px] text-ink">{name}</p>
      <p className="text-[13px] text-muted">{designation}</p>
      <Suspense fallback={<BandSkeleton />}>
        <RankBandRow associateId={associateId} />
      </Suspense>
    </Card>
  );
}

function BandSkeleton() {
  return <div className="mt-3 h-5 w-24 animate-pulse rounded-full bg-paper-200" />;
}

async function RankBandRow({ associateId }: { associateId: string }) {
  const [result, t, formatter] = await Promise.all([
    myRankResult(associateId).catch(() => null),
    getTranslations("portal.dashboard"),
    getFormatter(),
  ]);
  // Error, or not found among the active population: hide the band row and
  // caption entirely — name/designation above are unaffected (spec's
  // "Error" state; no red banner on a dashboard for a non-critical stat).
  if (!result) return null;

  // Band labels come from messages (portal.dashboard.band.<id>), not the
  // RANK_BANDS config — this app's locales are "en"/"zh-CN" (i18n/config.ts),
  // and next-intl's own translator already dispatches on the real locale
  // (DevLead review: a plain labelEn/labelZh check against "zh" was always
  // false, since the Chinese locale is "zh-CN").
  const label = t(`band.${result.band.id}`);
  const year = new Date().getFullYear();
  // next-intl's formatter, not date-fns — a "dd MMM yyyy" pattern hard-codes
  // English month names even under the zh-CN locale (DevLead review).
  const updated = formatter.dateTime(new Date(), { dateStyle: "medium" });

  return (
    <>
      <div className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <Medal className="h-4 w-4 text-gold-300" aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-[11px] text-muted-2">{t("rankCaption", { year })}</p>
      <p className="text-[11px] text-muted-2">{t("rankUpdated", { date: updated })}</p>
    </>
  );
}
