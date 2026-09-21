import Link from "next/link";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { transactionScopeIds } from "@/lib/transaction-scope";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Doc Template · Enshrine Portal" };

// Doc Template (associate-portal changes, Sep 2026 — A13): blank templates by
// category (Pets Afterlife / Human Afterlife) to download. Below them, the
// signed Storage of Pets Ashes agreements in the viewer's scope stay listed
// (same visibility ladder as transactions) so nothing already signed is lost.
const TEMPLATES = {
  pets: [
    { key: "tplPetAsh", href: "/templates/storage-of-pets-ashes-agreement.pdf" },
    { key: "tplReferral", href: "/templates/referral-partnership-agreement.pdf" },
  ],
  human: [] as { key: string; href: string }[],
} as const;
type Cat = keyof typeof TEMPLATES;

export default async function PortalAgreementsPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const session = await auth();
  const t = await getTranslations("agreements");
  if (!session?.user) return null;
  const { cat: rawCat } = await searchParams;
  const cat: Cat = rawCat === "human" ? "human" : "pets";

  const ids = await transactionScopeIds(session.user.role, session.user.associateId ?? null);
  const agreements = await prisma.petsAshesAgreement.findMany({
    where: ids === null ? {} : { submission: { closingAssociateId: { in: ids } } },
    orderBy: { updatedAt: "desc" },
    include: { submission: { include: { closingAssociate: { select: { fullName: true } } } } },
  });

  const templates = TEMPLATES[cat];

  return (
    <>
      <PageHeader title={t("docTemplate.title")} subtitle={t("docTemplate.subtitle")} />

      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("docTemplate.title")}>
        {(["pets", "human"] as const).map((c) => (
          <Link
            key={c}
            href={c === "pets" ? "/portal/agreements" : "/portal/agreements?cat=human"}
            aria-current={c === cat ? "page" : undefined}
            className={
              "rounded-xl border-2 border-ink px-6 py-2.5 text-[14px] font-semibold transition-colors " +
              (c === cat ? "bg-ink text-white" : "bg-white text-ink hover:bg-paper-100")
            }
          >
            {t(`docTemplate.cat.${c}`)}
          </Link>
        ))}
      </nav>

      <div className="mb-8 flex flex-col gap-2">
        {templates.length === 0 ? (
          <Card className="px-5 py-10 text-center text-[13px] text-muted">{t("docTemplate.none")}</Card>
        ) : (
          templates.map((tpl) => (
            <a key={tpl.href} href={tpl.href} target="_blank" rel="noopener" className="block">
              <Card className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-paper-100">
                <FileText className="h-5 w-5 shrink-0 text-action" strokeWidth={1.75} />
                <span className="font-medium text-ink">{t(`docTemplate.${tpl.key}`)}</span>
                <span className="ml-auto text-[12px] text-action">{t("docTemplate.download")}</span>
              </Card>
            </a>
          ))
        )}
      </div>

      {cat === "pets" && (
        <>
      <h2 className="mb-1 font-display text-[16px] text-ink">{t("docTemplate.signedHeading")}</h2>
      <p className="mb-3 text-[12.5px] text-muted">{t("list.subtitle")}</p>
      <Card className="overflow-hidden">
        {agreements.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{t("list.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("list.colClient")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colNiche")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colAssociate")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colUpdated")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colStatus")}</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((a) => (
                  <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-ink">{a.applicant1Name}</td>
                    <td className="px-5 py-3 text-muted">{a.nicheUnit ?? "—"}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(a.amountNumeric)}</td>
                    <td className="px-5 py-3 text-muted">{a.submission.closingAssociate.fullName}</td>
                    <td className="px-5 py-3 text-muted">{format(a.updatedAt, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3"><StatusPill status={a.status} /></td>
                    <td className="px-5 py-3 text-right">
                      {a.agreementPdfKey ? (
                        <a href={`/api/files/${a.agreementPdfKey}`} target="_blank" rel="noopener" className="text-[12px] text-action hover:underline">
                          {t("list.viewPdf")}
                        </a>
                      ) : (
                        <Link href={`/portal/sales/${a.submissionId}/agreement`} className="text-[12px] text-action hover:underline">
                          {t("list.continue")}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-4 text-[12.5px] text-muted-2">
        {t("list.legacyNote")}{" "}
        <Link href="/portal/sales-agreements" className="text-action hover:underline">{t("list.legacyLink")}</Link>
      </p>
        </>
      )}
    </>
  );
}
