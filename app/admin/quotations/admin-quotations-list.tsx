"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { formatSGD } from "@/lib/money";
import { voidQuotation } from "@/server/quotations/actions";
import type { QuotationLineSnapshot } from "@/server/quotations/actions";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export type AdminQuotationRow = {
  id: string;
  quotationCode: string;
  clientName: string;
  quoteDate: string;
  total: string;
  status: "Issued" | "Converted" | "Void";
  associateName: string;
  associateCode: string;
  lines: QuotationLineSnapshot[];
};

// A-17 screen 5: admin's read-only monitoring view of the standalone
// Quotation model (Business Admin or Accounts, canManageQuotation) — no
// approval step exists (createQuotation is self-service), so admin's only
// action here is Void, same reason-required flow as the portal's own list
// (app/portal/agreements/quotation-form.tsx), reusing that namespace's
// strings rather than duplicating them.
export function AdminQuotationsList({ quotations }: { quotations: AdminQuotationRow[] }) {
  const t = useTranslations("quotation");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [expandedId, setExpandedId] = useState<string>();
  const [voidingId, setVoidingId] = useState<string>();
  const [voidReason, setVoidReason] = useState("");

  function confirmVoid(id: string) {
    if (!voidReason.trim()) return;
    setError(undefined);
    start(async () => {
      const r = await voidQuotation(id, voidReason);
      if (r.ok) { setVoidingId(undefined); setVoidReason(""); router.refresh(); }
      else setError(r.error ?? t("list.voidConfirm"));
    });
  }

  if (quotations.length === 0) {
    return <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("list.empty")}</Card>;
  }

  return (
    <Card className="overflow-hidden">
      {error && <p className="px-5 pt-3 text-[12.5px] text-danger">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className={TABLE_HEAD_ROW_CLS}>
              <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colCode")}</th>
              <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colDate")}</th>
              <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colClient")}</th>
              <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("list.colAssociate")}</th>
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
                  <td className="px-5 py-3 text-muted whitespace-nowrap">{q.associateCode} · {q.associateName}</td>
                  <td className="px-5 py-3 text-muted">{q.lines.map((l) => l.productName).join(", ")}</td>
                  <td className="px-5 py-3 text-right text-ink">{formatSGD(q.total)}</td>
                  <td className="px-5 py-3 text-muted">{t(`status.${q.status.toLowerCase()}`)}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-3">
                      <button type="button" className="text-[12px] text-action hover:underline" onClick={() => setExpandedId((id) => (id === q.id ? undefined : q.id))}>
                        {t("list.view")}
                      </button>
                      {q.status === "Issued" && (
                        <button type="button" className="text-[12px] text-danger hover:underline" onClick={() => { setVoidingId(q.id); setVoidReason(""); }}>
                          {t("void")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedId === q.id && (
                  <tr className="border-b border-line-200 bg-paper-100">
                    <td colSpan={8} className="px-5 py-3">
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
                    <td colSpan={8} className="px-5 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="flex-1">
                          <Label htmlFor={`avr-${q.id}`} className="mb-0 text-[12px]">{t("list.voidReasonPrompt")}</Label>
                          <Input id={`avr-${q.id}`} className="h-9 text-[12px]" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
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
  );
}
