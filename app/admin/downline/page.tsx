import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { DownlineLookupPanel } from "@/components/team/downline-lookup-panel";

export const metadata = { title: "Downline Lookup · Enshrine Admin" };

/**
 * ITEM 7's own URL, kept after the lookup also mounted on the admin
 * dashboard (owner's own words: "build it into the dashboard") -- an
 * existing link or bookmark to this path must not 404. Same component,
 * same authorisation path (downlineLookupScope via the functions this
 * renders), just without the dashboard's stat tiles above it.
 */
export default async function DownlineLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; subject?: string; period?: string }>;
}) {
  const session = await auth();
  const t = await getTranslations("team");
  if (!session?.user) return <PageHeader title={t("overview.pageTitle")} />;

  // Admin/Accounts have no associate record; downlineLookupScope never reads
  // viewer.associateId for them (short-circuits on role first), so this
  // placeholder is never dereferenced on that branch. A non-admin with no
  // associateId (should not happen -- every portal role has one) gets no
  // access rather than a crash, by passing an id downlineIds can't match.
  const viewer = { associateId: session.user.associateId ?? "00000000-0000-0000-0000-000000000000", role: session.user.role };

  return <DownlineLookupPanel viewer={viewer} searchParams={await searchParams} basePath="/admin/downline" />;
}
