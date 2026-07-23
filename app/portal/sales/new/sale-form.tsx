"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { submitSale, editSale } from "@/server/sales/actions";
import { PercentAmountInput } from "@/components/ui/percent-amount-input";
import { useTranslations } from "next-intl";

export type FormProduct = {
  id: string;
  productCode: string;
  productName: string;
  companyName: string;
  comCodes: { id: string; label: string; valueType: string; value: string }[];
};

type Line = { productId: string; amount: string; comCodeIds: string[] };
type Split = { associateId: string; valueType: "Percentage" | "Absolute"; value: string };

const selectCls = "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export type SaleFormInitial = {
  clientName: string; clientContact: string; salesDate: string; quoteDate: string;
  plan: "Full Payment" | "Installment"; deposit: string; installmentCount: string;
  lines: Line[]; split2: Split; split3: Split;
};

export function SaleForm({ products, associates, today, initial, submissionId }: { products: FormProduct[]; associates: { id: string; name: string }[]; today: string; initial?: SaleFormInitial; submissionId?: string }) {
  const isEdit = !!submissionId;
  const router = useRouter();
  const t = useTranslations("portal");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const [clientName, setClientName] = useState(initial?.clientName ?? "");
  const [clientContact, setClientContact] = useState(initial?.clientContact ?? "");
  const [salesDate, setSalesDate] = useState(initial?.salesDate ?? today);
  const [quoteDate, setQuoteDate] = useState(initial?.quoteDate ?? today);
  const [plan, setPlan] = useState<"Full Payment" | "Installment">(initial?.plan ?? "Full Payment");
  const [deposit, setDeposit] = useState(initial?.deposit ?? "");
  const [installmentCount, setInstallmentCount] = useState(initial?.installmentCount ?? "12");
  const [lines, setLines] = useState<Line[]>(initial?.lines ?? [{ productId: products[0]?.id ?? "", amount: "", comCodeIds: [] }]);
  const [split2, setSplit2] = useState<Split>(initial?.split2 ?? { associateId: "", valueType: "Percentage", value: "" });
  const [split3, setSplit3] = useState<Split>(initial?.split3 ?? { associateId: "", valueType: "Percentage", value: "" });
  const [documents, setDocuments] = useState<File[]>([]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const total = lines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const mkSplit = (s: Split) =>
    s.associateId && parseFloat(s.value) > 0
      ? { associateId: s.associateId, valueType: s.valueType, value: parseFloat(s.value) }
      : undefined;

  const splitRow = (label: string, s: Split, setS: (v: Split) => void) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label>{label}</Label>
        <select className={selectCls} value={s.associateId} onChange={(e) => setS({ ...s, associateId: e.target.value })}>
          <option value="">{t("saleForm.splitNone")}</option>
          {associates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <Label>{t("saleForm.splitValue")}</Label>
        <PercentAmountInput
          value={s.value}
          valueType={s.valueType}
          onValueChange={(v) => setS({ ...s, value: v })}
          onTypeChange={(tp) => setS({ ...s, valueType: tp })}
          placeholder="0"
          disabled={!s.associateId}
        />
      </div>
    </div>
  );

  function submit() {
    setError(undefined);
    // Keep the whole Server Action payload under the 10 MB body limit.
    const totalBytes = documents.reduce((n, f) => n + f.size, 0);
    if (!isEdit && totalBytes > 9_000_000) { setError(t("saleForm.docsTooLarge")); return; }
    const base = {
      salesDate,
      quoteDate: quoteDate || undefined,
      clientName,
      clientContact,
      paymentPlan: plan,
      deposit: plan === "Installment" ? parseFloat(deposit) || 0 : undefined,
      installmentCount: plan === "Installment" ? parseInt(installmentCount) || undefined : undefined,
      lines: lines
        .filter((l) => l.productId && parseFloat(l.amount) > 0)
        .map((l) => ({ productId: l.productId, lineSaleAmount: parseFloat(l.amount), comCodeIds: l.comCodeIds })),
      associate2: mkSplit(split2),
      associate3: mkSplit(split3),
    };
    startTransition(async () => {
      const res = isEdit
        ? await editSale({ id: submissionId!, ...base })
        : await submitSale({ ...base, documents });
      if (res.ok) router.push(isEdit ? `/portal/sales/${submissionId}` : "/portal/sales");
      else setError(res.error ?? t("saleForm.couldNotSubmit"));
    });
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">{t("saleForm.clientPayment")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cn">{t("saleForm.clientName")}</Label>
            <Input id="cn" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Jane Tan" />
          </div>
          <div>
            <Label htmlFor="cc">{t("saleForm.clientContact")}</Label>
            <Input id="cc" value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="9xxx xxxx" />
          </div>
          <div>
            <Label htmlFor="sd">{t("saleForm.salesDate")}</Label>
            <Input id="sd" type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="qd">{t("saleForm.quoteDate")}</Label>
            <Input id="qd" type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pp">{t("saleForm.paymentPlan")}</Label>
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
                <Label htmlFor="dep">{t("saleForm.deposit")}</Label>
                <Input id="dep" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" inputMode="decimal" />
              </div>
              <div>
                <Label htmlFor="ic">{t("saleForm.installmentPlan")}</Label>
                <select id="ic" value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)} className={selectCls}>
                  <option value="12">{t("saleForm.months12")}</option>
                  <option value="24">{t("saleForm.months24")}</option>
                </select>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[17px] text-ink">{t("saleForm.products")}</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((ls) => [...ls, { productId: products[0]?.id ?? "", amount: "", comCodeIds: [] }])}
          >
            <Plus className="h-4 w-4" /> {t("saleForm.addLine")}
          </Button>
        </div>

        <div className="space-y-4">
          {lines.map((line, i) => {
            const product = productById.get(line.productId);
            return (
              <div key={i} className="rounded-lg border border-line-200 bg-paper-100 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
                  <div>
                    <Label htmlFor={`p${i}`}>{t("saleForm.product")}</Label>
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
                    <Label htmlFor={`a${i}`}>{t("saleForm.amount")}</Label>
                    <Input id={`a${i}`} value={line.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="0" inputMode="decimal" />
                  </div>
                  <div className="flex items-end">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="mb-1 rounded-md p-2 text-muted hover:bg-danger-50 hover:text-danger" aria-label={t("saleForm.removeLine")}>
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
          <span className="text-[13px] text-muted">{t("saleForm.saleTotal")}</span>
          <span className="font-display text-[20px] text-ink">
            S${total.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-[17px] text-ink">{t("saleForm.splitTitle")}</h2>
        <p className="mb-4 mt-1 text-[12px] text-muted-2">{t("saleForm.splitNote")}</p>
        <div className="space-y-3">
          {splitRow(t("saleForm.splitAssociate2"), split2, setSplit2)}
          {splitRow(t("saleForm.splitAssociate3"), split3, setSplit3)}
        </div>
      </Card>

      {!isEdit && (
        <Card className="p-5">
          <h2 className="font-display text-[17px] text-ink">{t("saleForm.docsTitle")}</h2>
          <p className="mb-3 mt-1 text-[12px] text-muted-2">{t("saleForm.docsNote")}</p>
          <input
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setDocuments(Array.from(e.target.files ?? []))}
            className="block w-full text-[13px] text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-paper-100 file:px-3 file:py-1.5 file:text-[12px] file:text-ink hover:file:bg-paper-200"
          />
          {documents.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12px] text-muted">
              {documents.map((f, i) => (
                <li key={i}>· {f.name}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending || !clientName || total <= 0}>
          {pending ? t("saleForm.submitting") : isEdit ? t("saleForm.saveChanges") : t("saleForm.submitSale")}
        </Button>
        <span className="text-[12px] text-muted-2">{t("saleForm.verificationNote")}</span>
      </div>
    </div>
  );
}
