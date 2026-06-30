"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { submitSale } from "@/server/sales/actions";

export type FormProduct = {
  id: string;
  productCode: string;
  productName: string;
  companyName: string;
  comCodes: { id: string; label: string; valueType: string; value: string }[];
};

type Line = { productId: string; amount: string; comCodeIds: string[] };

export function SaleForm({ products, today }: { products: FormProduct[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [salesDate, setSalesDate] = useState(today);
  const [plan, setPlan] = useState<"Full Payment" | "Installment">("Full Payment");
  const [deposit, setDeposit] = useState("");
  const [installmentCount, setInstallmentCount] = useState("3");
  const [lines, setLines] = useState<Line[]>([{ productId: products[0]?.id ?? "", amount: "", comCodeIds: [] }]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const total = lines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const res = await submitSale({
        salesDate,
        clientName,
        clientContact,
        paymentPlan: plan,
        deposit: plan === "Installment" ? parseFloat(deposit) || 0 : undefined,
        installmentCount: plan === "Installment" ? parseInt(installmentCount) || undefined : undefined,
        lines: lines
          .filter((l) => l.productId && parseFloat(l.amount) > 0)
          .map((l) => ({ productId: l.productId, lineSaleAmount: parseFloat(l.amount), comCodeIds: l.comCodeIds })),
      });
      if (res.ok) router.push("/portal/sales");
      else setError(res.error ?? "Could not submit.");
    });
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">Client & payment</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cn">Client name</Label>
            <Input id="cn" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Jane Tan" />
          </div>
          <div>
            <Label htmlFor="cc">Client contact</Label>
            <Input id="cc" value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="9xxx xxxx" />
          </div>
          <div>
            <Label htmlFor="sd">Sales date</Label>
            <Input id="sd" type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pp">Payment plan</Label>
            <select
              id="pp"
              value={plan}
              onChange={(e) => setPlan(e.target.value as "Full Payment" | "Installment")}
              className="h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none"
            >
              <option>Full Payment</option>
              <option>Installment</option>
            </select>
          </div>
          {plan === "Installment" && (
            <>
              <div>
                <Label htmlFor="dep">Deposit (S$)</Label>
                <Input id="dep" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" inputMode="decimal" />
              </div>
              <div>
                <Label htmlFor="ic"># Installments</Label>
                <Input id="ic" value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)} inputMode="numeric" />
              </div>
            </>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[17px] text-ink">Products</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((ls) => [...ls, { productId: products[0]?.id ?? "", amount: "", comCodeIds: [] }])}
          >
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </div>

        <div className="space-y-4">
          {lines.map((line, i) => {
            const product = productById.get(line.productId);
            return (
              <div key={i} className="rounded-lg border border-line-200 bg-paper-100 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
                  <div>
                    <Label htmlFor={`p${i}`}>Product</Label>
                    <select
                      id={`p${i}`}
                      value={line.productId}
                      onChange={(e) => setLine(i, { productId: e.target.value, comCodeIds: [] })}
                      className="h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.productName} ({p.companyName})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`a${i}`}>Amount (S$)</Label>
                    <Input id={`a${i}`} value={line.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="0" inputMode="decimal" />
                  </div>
                  <div className="flex items-end">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="mb-1 rounded-md p-2 text-muted hover:bg-danger-50 hover:text-danger" aria-label="Remove line">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {product && product.comCodes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {product.comCodes.map((cc) => (
                      <label key={cc.id} className="flex items-center gap-1.5 text-[12px] text-body">
                        <input
                          type="checkbox"
                          checked={line.comCodeIds.includes(cc.id)}
                          onChange={(e) =>
                            setLine(i, {
                              comCodeIds: e.target.checked
                                ? [...line.comCodeIds, cc.id]
                                : line.comCodeIds.filter((x) => x !== cc.id),
                            })
                          }
                        />
                        {cc.label} ({cc.valueType === "Percentage" ? `${cc.value}%` : `S$${cc.value}`})
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="text-[13px] text-muted">Sale total</span>
          <span className="font-display text-[20px] text-ink">
            S${total.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </Card>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending || !clientName || total <= 0}>
          {pending ? "Submitting…" : "Submit sale"}
        </Button>
        <span className="text-[12px] text-muted-2">Becomes official after Accounts/HR verification.</span>
      </div>
    </div>
  );
}
