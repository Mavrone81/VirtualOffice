import { Designation, CommissionType, LedgerLineType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { computeLineCommission, type LedgerLineResult } from "@/server/commission/engine";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Commission · Enshrine Admin" };

const upline = {
  directUpline: { associateId: "sm", designation: Designation.SalesManager, eligible: true },
  secondUpline: { associateId: "sd", designation: Designation.SalesDirector, eligible: true },
};
// 16-Jul model: every % is of the SALES AMOUNT.
const rates = { companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3" };
const closer = { associateId: "closer", designation: Designation.SalesConsultant };

function row(lines: LedgerLineResult[], type: LedgerLineType, id?: string) {
  return lines.find((l) => l.lineType === type && (id === undefined || l.associateId === id));
}

async function Preview({
  title,
  subtitle,
  sale,
  result,
}: {
  title: string;
  subtitle: string;
  sale: string;
  result: ReturnType<typeof computeLineCommission>;
}) {
  const t = await getTranslations("commission");
  const { lines, reconciles } = result;
  const personal = row(lines, LedgerLineType.Personal)!;
  const sm = row(lines, LedgerLineType.Override, "sm")!;
  const sd = row(lines, LedgerLineType.Override, "sd")!;
  const retained = row(lines, LedgerLineType.CompanyRetained)!;

  const items = [
    { label: t("saleAmount"), value: formatSGD(sale), muted: true },
    { label: t("netToCloser"), value: formatSGD(personal.amount), accent: "ink" },
    { label: t("smOverride"), value: formatSGD(sm.amount), accent: "action" },
    { label: t("sdOverride"), value: formatSGD(sd.amount), accent: "action" },
    { label: t("companyRetained"), value: formatSGD(retained.amount), muted: true },
  ];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display text-[18px] text-ink">{title}</h3>
          <p className="text-[12px] text-muted">{subtitle}</p>
        </div>
        {reconciles && (
          <span className="rounded-full bg-success-50 px-2.5 py-1 text-[11px] font-medium text-success">
            {t("reconciles")}
          </span>
        )}
      </div>
      <div className="mt-4 divide-y divide-line-200">
        {items.map((it) => (
          <div key={it.label} className="flex items-center justify-between py-2 text-[13px]">
            <span className={it.muted ? "text-muted" : "text-body"}>{it.label}</span>
            <span
              className={
                it.accent === "action"
                  ? "font-medium text-action"
                  : it.accent === "ink"
                    ? "font-display text-[16px] text-ink"
                    : "text-body"
              }
            >
              {it.value}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const LINE_TONE: Record<string, "info" | "success" | "neutral" | "warn"> = {
  Personal: "success",
  Override: "info",
  AddOn: "warn",
  CompanyRetained: "neutral",
  ExternalPayable: "neutral",
};

export default async function CommissionPage() {
  const t = await getTranslations("commission");
  const tc = await getTranslations("common");

  const ledger = await prisma.commissionLedger.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { transaction: true, lineItem: true },
  });

  const percentage = computeLineCommission({
    lineItemId: "demo-pct", ...rates, ...upline, closer, comCodes: [], isExternal: false,
    commissionType: CommissionType.Percentage, lineSaleAmount: "10000", closingCommPct: "10",
  });
  const fixed = computeLineCommission({
    lineItemId: "demo-fixed", ...rates, ...upline, closer, comCodes: [], isExternal: false,
    commissionType: CommissionType.Fixed, lineSaleAmount: "3800", closingCommFixed: "500",
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Preview
          title={t("percentageProduct")}
          subtitle={t("percentageProductSubtitle")}
          sale="10000"
          result={percentage}
        />
        <Preview
          title={t("fixedProduct")}
          subtitle={t("fixedProductSubtitle")}
          sale="3800"
          result={fixed}
        />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-[18px] text-ink">{t("ledgerTitle")}</h3>
          <span className="text-[12px] text-muted">{t("ledgerLines", { count: ledger.length })}</span>
        </div>
        {ledger.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            {t("ledgerEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("colTxn")}</th>
                  <th className="px-5 py-3 font-medium">{t("colAssociate")}</th>
                  <th className="px-5 py-3 font-medium">{t("colLineType")}</th>
                  <th className="px-5 py-3 font-medium">{t("colBasis")}</th>
                  <th className="px-5 py-3 font-medium">{t("colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{tc("status")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{l.transaction.transactionCode}</td>
                    <td className="px-5 py-3 text-muted">{l.associateName ?? "—"}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={l.lineType} tone={LINE_TONE[l.lineType] ?? "neutral"} />
                      {l.comCode ? <span className="ml-1 text-[11px] text-muted-2">{l.comCode}</span> : null}
                    </td>
                    <td className="px-5 py-3 text-muted">{formatSGD(l.basisAmount)}</td>
                    <td className="px-5 py-3 font-medium text-ink">{formatSGD(l.amount)}</td>
                    <td className="px-5 py-3"><StatusPill status={l.status} /></td>
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
