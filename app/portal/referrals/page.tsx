import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Referral partner list · Enshrine Portal" };

// Everyone sees every referral partnership submission, whatever its status
// (consolidated menu, Sep 2026): before approaching a vendor, an associate
// checks here whether someone already engaged them. Rejected rows stay listed
// so a repeat approach is an informed one.
export default async function ReferralPartnerListPage() {
  const t = await getTranslations("referrals");

  const referrals = await prisma.vendorReferral.findMany({
    orderBy: { submittedAt: "desc" },
    include: { submittedByAssociate: true },
  });

  return (
    <>
      <PageHeader title={t("list.title")} subtitle={t("list.subtitle")}>
        <Button asChild>
          <Link href="/portal/referrals/new">{t("list.newSubmission")}</Link>
        </Button>
      </PageHeader>

      <Card className="overflow-hidden">
        {referrals.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{t("list.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("list.colVendor")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colType")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colReferredBy")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colDate")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{r.vendorName}</td>
                    <td className="px-5 py-3 text-muted">{r.vendorType ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{r.submittedByAssociate?.fullName ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{format(r.submittedAt, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3"><StatusPill status={r.approvalStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
