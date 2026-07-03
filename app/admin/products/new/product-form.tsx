"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createProduct, type ProductInput } from "@/server/products/actions";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function ProductForm({ companies, today }: { companies: { id: string; name: string }[]; today: string }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [f, setF] = useState<ProductInput>({
    productCode: "", productName: "", commissionType: "Percentage",
    closingCommPct: "10", companyCutPct: "40", asmOverridePct: "10", smOverridePct: "20", sdOverridePct: "10",
    isExternal: false, effectiveDate: today, defaultCompanyId: companies[0]?.id,
  });
  const set = (patch: Partial<ProductInput>) => setF((p) => ({ ...p, ...patch }));

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await createProduct(f);
      if (r.ok) router.push("/admin/products");
      else setError(r.error ?? t("couldNotCreate"));
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="code">{t("productCodeLabel")}</Label>
            <Input id="code" value={f.productCode} onChange={(e) => set({ productCode: e.target.value.toUpperCase() })} placeholder="FUN-BASE" />
          </div>
          <div>
            <Label htmlFor="name">{t("productNameLabel")}</Label>
            <Input id="name" value={f.productName} onChange={(e) => set({ productName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="cat">{t("categoryLabel")}</Label>
            <Input id="cat" value={f.productCategory ?? ""} onChange={(e) => set({ productCategory: e.target.value })} placeholder="Funeral" />
          </div>
          <div>
            <Label htmlFor="co">{t("defaultBillingEntityLabel")}</Label>
            <select id="co" className={selectCls} value={f.defaultCompanyId ?? ""} onChange={(e) => set({ defaultCompanyId: e.target.value })}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="eff">{t("effectiveDateLabel")}</Label>
            <Input id="eff" type="date" value={f.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />
          </div>
          <label className="flex items-end gap-2 pb-3 text-[13px] text-body">
            <input type="checkbox" checked={f.isExternal} onChange={(e) => set({ isExternal: e.target.checked })} />
            {t("externalProductLabel")}
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">{t("commissionHeading")}</h2>
        {f.isExternal ? (
          <div className="max-w-xs">
            <Label htmlFor="ext">{t("enshrineRetainedLabel")}</Label>
            <Input id="ext" value={f.externalCompanyRetainedPct ?? "5"} onChange={(e) => set({ externalCompanyRetainedPct: e.target.value })} />
            <p className="mt-1 text-[12px] text-muted-2">{t("externalProviderNote")}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ct">{t("commissionTypeLabel")}</Label>
              <select id="ct" className={selectCls} value={f.commissionType} onChange={(e) => set({ commissionType: e.target.value as "Percentage" | "Fixed" })}>
                <option value="Percentage">{t("percentageOfSale")}</option>
                <option value="Fixed">{t("fixedAmount")}</option>
              </select>
            </div>
            <div>
              <Label htmlFor="closing">{f.commissionType === "Fixed" ? t("closingAmountFixed") : t("closingAmountPct")}</Label>
              {f.commissionType === "Fixed" ? (
                <Input id="closing" value={f.closingCommFixed ?? ""} onChange={(e) => set({ closingCommFixed: e.target.value })} placeholder="500" />
              ) : (
                <Input id="closing" value={f.closingCommPct ?? ""} onChange={(e) => set({ closingCommPct: e.target.value })} placeholder="10" />
              )}
            </div>
            <div>
              <Label htmlFor="cut">{t("companyCutPoolLabel")}</Label>
              <Input id="cut" value={f.companyCutPct} onChange={(e) => set({ companyCutPct: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="asm">{t("asmOverrideLabel")}</Label>
              <Input id="asm" value={f.asmOverridePct} onChange={(e) => set({ asmOverridePct: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sm">{t("smOverrideLabel")}</Label>
              <Input id="sm" value={f.smOverridePct} onChange={(e) => set({ smOverridePct: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sd">{t("sdOverrideLabel")}</Label>
              <Input id="sd" value={f.sdOverridePct} onChange={(e) => set({ sdOverridePct: e.target.value })} />
            </div>
          </div>
        )}
      </Card>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending || !f.productCode || !f.productName}>
        {pending ? tc("creating") : t("createProductBtn")}
      </Button>
    </div>
  );
}
