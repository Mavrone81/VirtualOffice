"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createProduct, type ProductInput } from "@/server/products/actions";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function ProductForm({ companies, today }: { companies: { id: string; name: string }[]; today: string }) {
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
      else setError(r.error ?? "Could not create.");
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="code">Product code *</Label>
            <Input id="code" value={f.productCode} onChange={(e) => set({ productCode: e.target.value.toUpperCase() })} placeholder="FUN-BASE" />
          </div>
          <div>
            <Label htmlFor="name">Product name *</Label>
            <Input id="name" value={f.productName} onChange={(e) => set({ productName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="cat">Category</Label>
            <Input id="cat" value={f.productCategory ?? ""} onChange={(e) => set({ productCategory: e.target.value })} placeholder="Funeral" />
          </div>
          <div>
            <Label htmlFor="co">Default billing entity</Label>
            <select id="co" className={selectCls} value={f.defaultCompanyId ?? ""} onChange={(e) => set({ defaultCompanyId: e.target.value })}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="eff">Effective date</Label>
            <Input id="eff" type="date" value={f.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />
          </div>
          <label className="flex items-end gap-2 pb-3 text-[13px] text-body">
            <input type="checkbox" checked={f.isExternal} onChange={(e) => set({ isExternal: e.target.checked })} />
            External product (columbarium / niche / “Shifu”)
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">Commission</h2>
        {f.isExternal ? (
          <div className="max-w-xs">
            <Label htmlFor="ext">Enshrine retained %</Label>
            <Input id="ext" value={f.externalCompanyRetainedPct ?? "5"} onChange={(e) => set({ externalCompanyRetainedPct: e.target.value })} />
            <p className="mt-1 text-[12px] text-muted-2">Bulk routes to the external provider; Enshrine keeps this cut.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ct">Commission type</Label>
              <select id="ct" className={selectCls} value={f.commissionType} onChange={(e) => set({ commissionType: e.target.value as "Percentage" | "Fixed" })}>
                <option value="Percentage">Percentage of sale</option>
                <option value="Fixed">Fixed amount</option>
              </select>
            </div>
            <div>
              <Label htmlFor="closing">{f.commissionType === "Fixed" ? "Closing amount (S$)" : "Closing %"}</Label>
              {f.commissionType === "Fixed" ? (
                <Input id="closing" value={f.closingCommFixed ?? ""} onChange={(e) => set({ closingCommFixed: e.target.value })} placeholder="500" />
              ) : (
                <Input id="closing" value={f.closingCommPct ?? ""} onChange={(e) => set({ closingCommPct: e.target.value })} placeholder="10" />
              )}
            </div>
            <div>
              <Label htmlFor="cut">Company cut % (pool)</Label>
              <Input id="cut" value={f.companyCutPct} onChange={(e) => set({ companyCutPct: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="asm">ASM override %</Label>
              <Input id="asm" value={f.asmOverridePct} onChange={(e) => set({ asmOverridePct: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sm">SM override %</Label>
              <Input id="sm" value={f.smOverridePct} onChange={(e) => set({ smOverridePct: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sd">SD override %</Label>
              <Input id="sd" value={f.sdOverridePct} onChange={(e) => set({ sdOverridePct: e.target.value })} />
            </div>
          </div>
        )}
      </Card>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending || !f.productCode || !f.productName}>
        {pending ? "Creating…" : "Create product"}
      </Button>
    </div>
  );
}
