import Link from "next/link";
import { format } from "date-fns";
import { CommissionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActiveToggle, ComCodeManager } from "./product-controls";

export const metadata = { title: "Products & commission · Enshrine Admin" };

export default async function ProductsPage() {
  const products = await prisma.product.findMany({
    where: { archivedAt: null },
    include: { comCodes: true, defaultCompany: true },
    orderBy: { productCode: "asc" },
  });

  return (
    <>
      <PageHeader title="Products & commission" subtitle="Product catalogue, commission rates (versioned), and add-on com codes.">
        <Button asChild>
          <Link href="/admin/products/new">+ New product</Link>
        </Button>
      </PageHeader>

      <div className="space-y-4">
        {products.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{p.productCode}</span>
                  <span className="text-ink">· {p.productName}</span>
                  <ActiveToggle id={p.id} active={p.activeStatus === "Active"} />
                  {p.isExternal && <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] text-gold">External</span>}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {p.productCategory ?? "—"} · {p.defaultCompany?.name ?? "no default entity"} · eff. {format(p.effectiveDate, "dd MMM yyyy")}
                </div>
              </div>
              <div className="text-right text-[12px]">
                <div className="text-muted">Closing</div>
                <div className="font-display text-[18px] text-ink">
                  {p.commissionType === CommissionType.Fixed ? `S$${p.closingCommFixed ?? 0}` : `${p.closingCommPct ?? 0}%`}
                </div>
              </div>
            </div>

            {!p.isExternal ? (
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-muted">
                <span>Company cut <b className="text-ink">{String(p.companyCutPct)}%</b></span>
                <span>ASM <b className="text-ink">{String(p.asmOverridePct)}%</b></span>
                <span>SM <b className="text-ink">{String(p.smOverridePct)}%</b></span>
                <span>SD <b className="text-ink">{String(p.sdOverridePct)}%</b></span>
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-muted">
                External — Enshrine retains <b className="text-ink">{String(p.externalCompanyRetainedPct ?? 0)}%</b>, bulk to provider
              </div>
            )}

            <ComCodeManager
              productId={p.id}
              comCodes={p.comCodes.map((c) => ({ id: c.id, comCode: c.comCode, label: c.label, valueType: c.valueType, value: c.value.toString(), active: c.active }))}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
