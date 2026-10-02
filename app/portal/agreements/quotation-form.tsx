"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { formatSGD } from "@/lib/money";
import { createQuotation, voidQuotation } from "@/server/quotations/actions";
import type { QuotationLineSnapshot } from "@/server/quotations/actions";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export type QuotationFormProduct = { id: string; productCode: string; productName: string };

export type QuotationRow = {
  id: string;
  quotationCode: string;
  clientName: string;
  quoteDate: string; // yyyy-MM-dd, already locale-formatted server-side is not worth it here — a plain ISO-ish date string
  total: string;
  status: "Issued" | "Converted" | "Void";
  lines: QuotationLineSnapshot[];
};

type Line = { productId: string; amount: string };

// A-17 screen 1 (docs/design/a17-quotation-flow.md): the associate prices each
// line themselves — a quotation is never approved or signed, so there is no
// server-side rate lookup the way a real sale's commission add-ons need one.
// createQuotation still re-validates through resolveSaleLines (same active-
// product filter as a real sale), it just has no comCodes to offer here.
export function QuotationForm({ products, today, quotations }: { products: QuotationFormProduct[]; today: string; quotations: QuotationRow[] }) {
  const t = useTranslations("quotation");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [quoteDate, setQuoteDate] = useState(today);
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: products[0]?.id ?? "", amount: "" }]);
  const [expandedId, setExpandedId] = useState<string>();
  const [voidingId, setVoidingId] = useState<string>();
  const [voidReason, setVoidReason] = useState("");

  const total = lines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const r = await createQuotation({
        clientName,
        clientContact: clientContact.trim() || undefined,
        quoteDate,
        validUntil: validUntil || undefined,
        lines: lines
          .filter((l) => l.productId && parseFloat(l.amount) > 0)
          .map((l) => ({ productId: l.productId, lineSaleAmount: parseFloat(l.amount), comCodeIds: [] })),
      });
      if (r.ok) {
        setClientName("");
        setClientContact("");
        setValidUntil("");
        setLines([{ productId: products[0]?.id ?? "", amount: "" }]);
        router.refresh();
      } else {
        setError(r.error ?? t("form.heading"));
      }
    });
  }

  function confirmVoid(id: string) {
    if (!voidReason.trim()) return;
    setError(undefined);
    startTransition(async () => {
      const r = await voidQuotation(id, voidReason);
      if (r.ok) {
        setVoidingId(undefined);
        setVoidReason("");
        router.refresh();
      } else {
        setError(r.error ?? t("list.voidConfirm"));
      }
    });
  }

  // Informational prefill only (design note §2: "the submission's own lines
  // are authoritative") — this doesn't call any server action or change the
  // quotation's status. The quotation only moves to Converted once submitSale
  // itself accepts a quotationId, which isn't built yet; until then, Convert
  // just gets the associate to a pre-filled submit form.
  function convert(q: QuotationRow) {
    const params = new URLSearchParams();
    params.set("fromQuotation", q.id);
    router.push(`/portal/sales/new?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <h2 className="mb-4 font-display text-[16px] text-ink">{t("form.heading")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="qcn">{t("form.clientName")}</Label>
            <Input id="qcn" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="qcc">{t("form.clientContact")}</Label>
            <Input id="qcc" value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="9xxx xxxx" />
          </div>
          <div>
            <Label htmlFor="qqd">{t("form.quoteDate")}</Label>
            <Input id="qqd" type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="qvu">{t("form.validUntil")}</Label>
            <Input id="qvu" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
              <div>
                <Label htmlFor={`qp${i}`}>{t("form.product")}</Label>
                <select
                  id={`qp${i}`}
                  value={line.productId}
                  onChange={(e) => setLine(i, { productId: e.target.value })}
                  className="h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.productName}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`qa${i}`}>{t("form.price")}</Label>
                <Input id={`qa${i}`} value={line.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="0" inputMode="decimal" />
              </div>
              <div className="flex items-end">
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="mb-1 rounded-md p-2 text-muted hover:bg-danger-50 hover:text-danger" aria-label={t("form.removeLine")}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, { productId: products[0]?.id ?? "", amount: "" }])}>
            <Plus className="h-4 w-4" /> {t("form.addLine")}
          </Button>
          <span className="text-[13px] text-muted">{t("form.total")}: <span className="font-medium text-ink">{formatSGD(total)}</span></span>
        </div>

        {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}

        <div className="mt-4">
          <Button disabled={!clientName.trim() || total <= 0 || pending} onClick={submit}>
            {pending ? "…" : t("form.issue")}
          </Button>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 font-display text-[16px] text-ink">{t("list.heading")}</h2>
        {quotations.length === 0 ? (
          <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("list.empty")}</Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className={TABLE_HEAD_ROW_CLS}>
                    <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colCode")}</th>
                    <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colDate")}</th>
                    <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colClient")}</th>
                    <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colProducts")}</th>
                    <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colTotal")}</th>
                    <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colStatus")}</th>
                    <th className={`px-5 py-3 ${TABLE_HEAD_CELL_CLS}`}></th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((q) => (
                    <>
                      <tr key={q.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100 align-top">
                        <td className="px-5 py-3 font-medium text-ink whitespace-nowrap">{q.quotationCode}</td>
                        <td className="px-5 py-3 text-muted whitespace-nowrap">{q.quoteDate}</td>
                        <td className="px-5 py-3 text-ink">{q.clientName}</td>
                        <td className="px-5 py-3 text-muted">{q.lines.map((l) => l.productName).join(", ")}</td>
                        <td className="px-5 py-3 text-right text-ink">{formatSGD(q.total)}</td>
                        <td className="px-5 py-3 text-muted">{t(`status.${q.status.toLowerCase()}`)}</td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-3">
                            <button type="button" className="text-[12px] text-action hover:underline" onClick={() => setExpandedId((id) => (id === q.id ? undefined : q.id))}>
                              {t("list.view")}
                            </button>
                            {q.status === "Issued" && (
                              <>
                                <button type="button" className="text-[12px] text-action hover:underline" onClick={() => convert(q)}>
                                  {t("list.convert")}
                                </button>
                                <button type="button" className="text-[12px] text-danger hover:underline" onClick={() => { setVoidingId(q.id); setVoidReason(""); }}>
                                  {t("void")}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedId === q.id && (
                        <tr className="border-b border-line-200 bg-paper-100">
                          <td colSpan={7} className="px-5 py-3">
                            <ul className="space-y-1 text-[12.5px] text-muted">
                              {q.lines.map((l, i) => (
                                <li key={i}>
                                  {l.productName} ({l.productCode}) — {formatSGD(l.amount)}
                                  {l.addOns.length > 0 && <span> · {l.addOns.map((a) => a.label).join(", ")}</span>}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                      {voidingId === q.id && (
                        <tr className="border-b border-line-200 bg-paper-100">
                          <td colSpan={7} className="px-5 py-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                              <div className="flex-1">
                                <Label htmlFor={`vr-${q.id}`} className="mb-0 text-[12px]">{t("list.voidReasonPrompt")}</Label>
                                <Input id={`vr-${q.id}`} className="h-9 text-[12px]" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                              </div>
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="danger" disabled={!voidReason.trim() || pending} onClick={() => confirmVoid(q.id)}>
                                  {pending ? "…" : t("list.voidConfirm")}
                                </Button>
                                <button type="button" className="text-[12px] text-muted hover:underline" onClick={() => setVoidingId(undefined)}>{t("list.cancel")}</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
