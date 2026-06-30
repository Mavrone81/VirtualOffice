import { Designation, CommissionType, LedgerLineType } from "@prisma/client";
import { computeLineCommission, type LedgerLineResult } from "@/server/commission/engine";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Commission · Enshrine Admin" };

const upline = {
  directUpline: { associateId: "sm", designation: Designation.SalesManager, eligible: true },
  secondUpline: { associateId: "sd", designation: Designation.SalesDirector, eligible: true },
};
const rates = { companyCutPct: "40", asmOverridePct: "10", smOverridePct: "20", sdOverridePct: "10" };
const closer = { associateId: "closer", designation: Designation.SalesConsultant };

function row(lines: LedgerLineResult[], type: LedgerLineType, id?: string) {
  return lines.find((l) => l.lineType === type && (id === undefined || l.associateId === id));
}

function Preview({
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
  const { lines, reconciles } = result;
  const personal = row(lines, LedgerLineType.Personal)!;
  const sm = row(lines, LedgerLineType.Override, "sm")!;
  const sd = row(lines, LedgerLineType.Override, "sd")!;
  const retained = row(lines, LedgerLineType.CompanyRetained)!;
  const closing = personal.basisAmount;
  const pool = retained.basisAmount;

  const items = [
    { label: "Sale amount", value: formatSGD(sale), muted: true },
    { label: "Closing commission", value: formatSGD(closing), strong: true },
    { label: "Company cut pool (40%)", value: formatSGD(pool), muted: true },
    { label: "Net to closer", value: formatSGD(personal.amount), accent: "ink" },
    { label: "SM override (20% of pool)", value: formatSGD(sm.amount), accent: "action" },
    { label: "SD override (10% of pool)", value: formatSGD(sd.amount), accent: "action" },
    { label: "Company retained", value: formatSGD(retained.amount), muted: true },
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
            ✓ Reconciles
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
                    : it.strong
                      ? "font-medium text-ink"
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

export default function CommissionPage() {
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
        title="Commission engine"
        subtitle="Pool-based overrides · installment-aware · idempotent · zero rounding leakage."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Preview
          title="Percentage product"
          subtitle="Funeral System · 10% closing"
          sale="10000"
          result={percentage}
        />
        <Preview
          title="Fixed product"
          subtitle="Pet Cremation · S$500 flat (sale-amount independent)"
          sale="3800"
          result={fixed}
        />
      </div>

      <Card className="mt-6 p-6">
        <h3 className="font-display text-[17px] text-ink">Commission ledger</h3>
        <p className="mt-1.5 max-w-2xl text-[13px] text-muted">
          Both commission types feed the same company-cut pool → ASM/SM/SD override split → company retained,
          and overrides are paid out of the pool (never reducing the closer). Once sales submission and
          verification land, the engine writes per-line ledger entries here, gated by installment eligibility.
        </p>
      </Card>
    </>
  );
}
