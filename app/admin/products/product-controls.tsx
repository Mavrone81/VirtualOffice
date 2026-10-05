"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { setProductActive, addComCode, toggleComCode, addProductRequiredDocument, removeProductRequiredDocument, setProductAshesAgreementFlag, deleteProduct } from "@/server/products/actions";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { bilingualLabel } from "@/lib/labels";

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const tc = useTranslations("common");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => start(async () => { await setProductActive(id, !active); router.refresh(); })}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        active ? "bg-success-50 text-success" : "bg-paper-200 text-muted"
      }`}
    >
      {pending ? "…" : active ? tc("active") : tc("inactive")}
    </button>
  );
}

// Entry point to the details edit screen (updateProduct). `canManage` is the
// caller's `can(role, "manage_products")` — a courtesy so a user the action
// would reject never sees the link; the server gate is what enforces it.
export function EditProductLink({ productId, canManage }: { productId: string; canManage: boolean }) {
  const t = useTranslations("products");
  if (!canManage) return null;
  return (
    <Link href={`/admin/products/${productId}/edit`} className="text-[12px] text-action hover:underline">
      {t("editProduct")}
    </Link>
  );
}

export function ComCodeManager({
  productId,
  comCodes,
}: {
  productId: string;
  comCodes: { id: string; comCode: string; label: string; valueType: string; value: string; active: boolean }[];
}) {
  const t = useTranslations("products");
  const [pending, start] = useTransition();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ comCode: "", label: "", valueType: "Percentage" as "Percentage" | "Absolute", value: "" });

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {comCodes.length === 0 && <span className="text-[11px] text-muted-2">{t("noComCodes")}</span>}
        {comCodes.map((c) => (
          <button
            key={c.id}
            disabled={pending}
            onClick={() => start(async () => { await toggleComCode(c.id, !c.active); router.refresh(); })}
            title={t("toggleActive")}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              c.active ? "border-action-200 bg-action-50 text-action" : "border-line bg-paper-200 text-muted line-through"
            }`}
          >
            {c.label} · {c.valueType === "Percentage" ? `${c.value}%` : `$${c.value}`}
          </button>
        ))}
        <button onClick={() => setOpen((v) => !v)} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:bg-paper-100">
          {t("addComCode")}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-line-200 bg-paper-100 p-2">
          <input className="h-8 w-24 rounded border border-line px-2 text-[12px]" placeholder={t("codePlaceholder")} value={f.comCode} onChange={(e) => setF({ ...f, comCode: e.target.value })} />
          <input className="h-8 w-32 rounded border border-line px-2 text-[12px]" placeholder={t("labelPlaceholder")} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <select className="h-8 rounded border border-line px-2 text-[12px]" value={f.valueType} onChange={(e) => setF({ ...f, valueType: e.target.value as "Percentage" | "Absolute" })}>
            <option value="Percentage">%</option>
            <option value="Absolute">$</option>
          </select>
          <input className="h-8 w-20 rounded border border-line px-2 text-[12px]" placeholder={t("valuePlaceholder")} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await addComCode(productId, f);
                if (r.ok) { setF({ comCode: "", label: "", valueType: "Percentage", value: "" }); setOpen(false); router.refresh(); }
              })
            }
            className="h-8 rounded-lg bg-action px-3 text-[12px] font-medium text-white"
          >
            {t("add")}
          </button>
        </div>
      )}
    </div>
  );
}

// A-17 screen 6 (flag-gated by the caller): per-product required documents.
// Bilingual label pair per entry — the key is server-generated, never shown
// as editable (lib/product-requirement-key.ts). Capped at
// MAX_REQUIRED_DOCUMENTS_PER_PRODUCT (20) server-side; the add form's error
// surfaces the server's refusal (limit reached / forbidden / not found) as-is.
export function RequiredDocumentsManager({
  productId,
  requiredDocuments,
}: {
  productId: string;
  requiredDocuments: { key: string; label_en: string; label_zh: string }[];
}) {
  const t = useTranslations("products");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ labelEn: "", labelZh: "" });
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <div className="text-[11px] font-medium text-muted">{t("requiredDocuments")}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {requiredDocuments.length === 0 && <span className="text-[11px] text-muted-2">{t("noRequiredDocuments")}</span>}
        {requiredDocuments.map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1 rounded-full border border-line bg-paper-200 px-2 py-0.5 text-[11px] text-ink">
            {bilingualLabel(locale, d)}
            <button
              type="button"
              disabled={pending}
              title={t("removeRequiredDocument")}
              onClick={() => start(async () => { await removeProductRequiredDocument(productId, d.key); router.refresh(); })}
              className="text-muted hover:text-danger"
            >
              ×
            </button>
          </span>
        ))}
        <button onClick={() => { setOpen((v) => !v); setError(null); }} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:bg-paper-100">
          {t("addRequiredDocument")}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-line-200 bg-paper-100 p-2">
          <input className="h-8 w-40 rounded border border-line px-2 text-[12px]" placeholder={t("labelEnPlaceholder")} value={f.labelEn} onChange={(e) => setF({ ...f, labelEn: e.target.value })} />
          <input className="h-8 w-40 rounded border border-line px-2 text-[12px]" placeholder={t("labelZhPlaceholder")} value={f.labelZh} onChange={(e) => setF({ ...f, labelZh: e.target.value })} />
          <button
            disabled={pending || !f.labelEn.trim() || !f.labelZh.trim()}
            onClick={() =>
              start(async () => {
                const r = await addProductRequiredDocument(productId, f);
                if (r.ok) { setF({ labelEn: "", labelZh: "" }); setOpen(false); setError(null); router.refresh(); }
                else setError(r.error ?? null);
              })
            }
            className="h-8 rounded-lg bg-action px-3 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {t("add")}
          </button>
          {error && <span className="text-[11px] text-danger">{error}</span>}
        </div>
      )}
    </div>
  );
}

// A-17 screen 6 (flag-gated by the caller): whether this product's submit
// flow automatically drafts a Pet Ash agreement (§4 of a17-design.md).
export function AshesAgreementToggle({ productId, requiresAshesAgreement }: { productId: string; requiresAshesAgreement: boolean }) {
  const t = useTranslations("products");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => start(async () => { await setProductAshesAgreementFlag(productId, !requiresAshesAgreement); router.refresh(); })}
      title={t("ashesAgreementToggleHint")}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        requiresAshesAgreement ? "bg-gold/10 text-gold" : "bg-paper-200 text-muted"
      }`}
    >
      {pending ? "…" : requiresAshesAgreement ? t("ashesAgreementOn") : t("ashesAgreementOff")}
    </button>
  );
}

// Hard delete, and deliberately NOT shaped like the ActiveToggle above.
//
// The owner's model is two-step — "Delete cannot work if product is sold it can
// only be deactivated" — so these are two different controls with two different
// outcomes, and this one must not read as another state pill. ActiveToggle is a
// small inline pill next to the product code; this is a danger-toned text action
// in the card's footer that expands into a confirmation panel naming the product.
//
// No window.confirm(): that is the marketing library's pattern, not the admin
// area's. This follows the inline "expand, then confirm" panel used by
// app/admin/sales/verify/reject-button.tsx (Button variant="danger" + Banner for
// the server's refusal), so a refusal is readable prose in the page rather than
// a browser dialog that has already closed.
//
// The server's refusal is RETURNED, not thrown, and it names which history blocks
// the delete and points at the Active toggle — so it is shown verbatim here
// instead of being replaced with a generic failure message.
export function DeleteProductButton({
  productId,
  productCode,
  productName,
  canManage,
}: {
  productId: string;
  productCode: string;
  productName: string;
  canManage: boolean;
}) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string>();

  // Courtesy gate only, matching EditProductLink: a user the action would reject
  // never sees the control. requireAdmin() in the action is what enforces it.
  if (!canManage) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setErr(undefined); }}
        className="text-[12px] text-muted hover:text-danger hover:underline"
      >
        {t("deleteProduct")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-danger/20 bg-danger-50 p-3 text-[12px]">
      <div className="font-medium text-ink">{t("deleteProductQuestion", { code: productCode, name: productName })}</div>
      <div className="text-muted">{t("deleteProductWarning")}</div>
      {err && <Banner tone="danger">{err}</Banner>}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await deleteProduct(productId);
              // On success the row is gone, so the panel goes with it on refresh.
              if (r.ok) { setOpen(false); router.refresh(); }
              else setErr(r.error ?? t("deleteProduct"));
            })
          }
        >
          {pending ? "…" : t("deleteProductConfirm")}
        </Button>
        <button type="button" className="text-muted hover:underline" onClick={() => { setOpen(false); setErr(undefined); }}>
          {tc("cancel")}
        </button>
      </div>
    </div>
  );
}
