import { format } from "date-fns";
import { FileText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { documentVisibilityWhere } from "@/lib/documents";
import { transactionScopeIds } from "@/lib/transaction-scope";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export const metadata = { title: "Documents · Enshrine Portal" };

// Doc Template's Pets/Human Afterlife tabs and the signed-agreements list were
// folded in here (C-6, 2026-10-02) — one documents home instead of two. Both
// category tabs render even when one is empty (PD ruling, 2026-10-03 — the
// client's own slide shows both as a visible pair). The built-in templates
// below are the SAME sha-pinned e-signing generation masters Doc Template
// served (lib/pdf/agreement.ts, lib/pdf/associate-agreement-coordinates.ts);
// "replacing" them is the catastrophic case, so an admin upload for a
// category only ever adds a row alongside them (B-5 Option 1), never
// substitutes into this list.
const CATEGORY_TEMPLATES = {
  PetsAfterlife: [
    { key: "tplAshes", href: "/templates/storage-of-pets-ashes-agreement.pdf" },
    { key: "tplReferral", href: "/templates/referral-partnership-agreement.pdf" },
  ],
  HumanAfterlife: [] as { key: string; href: string }[],
};

const CATEGORY_KEYS = Object.keys(CATEGORY_TEMPLATES) as (keyof typeof CATEGORY_TEMPLATES)[];

export default async function PortalDocumentsPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const session = await auth();
  const t = await getTranslations("portal");
  const ta = await getTranslations("agreements");
  const sp = await searchParams;
  const activeCat = CATEGORY_KEYS.includes(sp.cat as keyof typeof CATEGORY_TEMPLATES)
    ? (sp.cat as keyof typeof CATEGORY_TEMPLATES)
    : CATEGORY_KEYS[0];

  if (!session?.user) return <PageHeader title={t("documents.pageTitle")} />;

  const assoc = session.user.associateId
    ? await prisma.associate.findUnique({ where: { id: session.user.associateId }, select: { teamName: true } })
    : null;
  const visibility = documentVisibilityWhere(session.user.associateId, assoc?.teamName ?? null);

  // Category-tagged rows (at most one non-retired per category, B-5) render
  // in the grouped template sections below, never in the flat "Filed
  // documents" list — `category: null` keeps the two lists from duplicating
  // the same row.
  const [categoryDocs, docs, agreements] = await Promise.all([
    prisma.document.findMany({
      where: { AND: [visibility, { category: { not: null }, retiredAt: null }] },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, category: true },
    }),
    prisma.document.findMany({ where: { AND: [visibility, { category: null }] }, orderBy: { createdAt: "desc" } }),
    (async () => {
      const ids = await transactionScopeIds(session.user.role, session.user.associateId ?? null);
      return prisma.petsAshesAgreement.findMany({
        where: ids === null ? {} : { submission: { closingAssociateId: { in: ids } } },
        orderBy: { updatedAt: "desc" },
        include: { submission: { include: { closingAssociate: { select: { fullName: true } } } } },
      });
    })(),
  ]);

  // Official blank agreement templates, downloadable by every associate.
  const generalTemplates = [
    { title: t("documents.tplAssociate"), href: "/templates/associate-agreement.pdf" },
  ];

  const categorySections = (Object.keys(CATEGORY_TEMPLATES) as (keyof typeof CATEGORY_TEMPLATES)[]).map((cat) => ({
    cat,
    items: [
      ...CATEGORY_TEMPLATES[cat].map((tpl) => ({ href: tpl.href, label: t(`documents.${tpl.key}`) })),
      ...categoryDocs.filter((d) => d.category === cat).map((d) => ({ href: `/documents/${d.id}/download`, label: d.title })),
    ],
  }));

  const templateCard = (href: string, label: string) => (
    <a key={href} href={href} target="_blank" rel="noopener" className="block">
      <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-paper-100">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-action-50 text-action">
          <FileText className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{label}</div>
          <div className="mt-0.5 text-[11px] text-muted-2">{t("documents.templateTag")}</div>
        </div>
      </Card>
    </a>
  );

  return (
    <>
      <PageHeader title={t("documents.pageTitle")} subtitle={t("documents.pageSubtitle")} />

      <h2 className="mb-3 font-display text-[16px] text-ink">{t("documents.templatesHeading")}</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {generalTemplates.map((tpl) => templateCard(tpl.href, tpl.title))}
      </div>

      {/* Both category tabs always render, even one with nothing behind it
          yet — PD ruling (2026-10-03): the client's own slide (Associate p15
          / Admin p8) shows Pets Afterlife | Human Afterlife as a visible tab
          pair, and hiding an empty tab would lose that affordance that a
          second category exists. URL-param-driven, same pattern as
          components/recruitment/recruitment-view.tsx's tabs — no client JS. */}
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={ta("docTemplate.title")}>
        {CATEGORY_KEYS.map((cat) => (
          <Link
            key={cat}
            href={`/portal/documents?cat=${cat}`}
            aria-current={cat === activeCat ? "page" : undefined}
            className={
              "rounded-xl border-2 border-ink px-5 py-2.5 text-[14px] font-semibold transition-colors " +
              (cat === activeCat ? "bg-ink text-white" : "bg-white text-ink hover:bg-paper-100")
            }
          >
            {ta(`docTemplate.cat.${cat === "PetsAfterlife" ? "pets" : "human"}`)}
          </Link>
        ))}
      </nav>
      <div className="mb-8">
        {(() => {
          const active = categorySections.find((s) => s.cat === activeCat)!;
          return active.items.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {active.items.map((tpl) => templateCard(tpl.href, tpl.label))}
            </div>
          ) : (
            <Card className="px-5 py-12 text-center text-[13px] text-muted">{ta("docTemplate.none")}</Card>
          );
        })()}
      </div>

      <h2 className="mb-1 font-display text-[16px] text-ink">{ta("docTemplate.signedHeading")}</h2>
      <p className="mb-3 text-[12.5px] text-muted">{ta("list.subtitle")}</p>
      <Card className="mb-8 overflow-hidden">
        {agreements.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{ta("list.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{ta("list.colClient")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{ta("list.colNiche")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{ta("list.colAmount")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{ta("list.colAssociate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{ta("list.colUpdated")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{ta("list.colStatus")}</th>
                  <th className={`px-5 py-3 ${TABLE_HEAD_CELL_CLS}`}></th>
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
                          {ta("list.viewPdf")}
                        </a>
                      ) : (
                        <Link href={`/portal/sales/${a.submissionId}/agreement`} className="text-[12px] text-action hover:underline">
                          {ta("list.continue")}
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
      <p className="mb-8 -mt-6 text-[12.5px] text-muted-2">
        {ta("list.legacyNote")}{" "}
        <Link href="/portal/sales-agreements" className="text-action hover:underline">{ta("list.legacyLink")}</Link>
      </p>

      <h2 className="mb-3 font-display text-[16px] text-ink">{t("documents.filedHeading")}</h2>
      {docs.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("documents.noDocs")}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {docs.map((d) => (
            <a key={d.id} href={`/documents/${d.id}/download`} target="_blank" rel="noopener" className="block">
              <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-paper-100">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-action-50 text-action">
                  <FileText className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{d.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted-2">{humanize(d.type)} · {format(d.createdAt, "dd MMM yyyy")}</div>
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
