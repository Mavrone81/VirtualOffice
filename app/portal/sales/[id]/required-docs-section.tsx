"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { bilingualLabel } from "@/lib/labels";
import { Banner } from "@/components/ui/banner";
import { RequiredDocUpload } from "./required-doc-upload";

type RequiredDoc = { key: string; label_en: string; label_zh: string };

// A-17 G3a: shows each of the sale's products' CURRENT required-document
// keys, split into already-attached (✓, append-only — never un-attaches)
// and still-missing (upload control). requiredKeys/attachedKeys come from
// getRequiredDocumentGate — the same resolveProductDocGate source
// verifySale/getVerifyChecklist gate on, so this list can't disagree with
// what actually blocks verification.
export function RequiredDocsSection({ submissionId, requiredDocs, attachedKeys, productRecordMissing }: { submissionId: string; requiredDocs: RequiredDoc[]; attachedKeys: string[]; productRecordMissing: boolean }) {
  const t = useTranslations("portal");
  const te = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [justAttached, setJustAttached] = useState<string[]>([]);

  // A product record behind one of the sale's line items is missing —
  // resolveProductDocGate can't tell "needs no documents" from "can't check",
  // and verifySale/getVerifyChecklist refuse this as G3 productRecordMissing.
  // Show the SAME message here rather than silently rendering nothing (the
  // gap Backend found: reviews/get-required-document-gate-missing-product-signal.md).
  if (productRecordMissing) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <Banner tone="danger">{te("productRecordMissing")}</Banner>
      </div>
    );
  }

  if (requiredDocs.length === 0) return null;

  const attached = new Set([...attachedKeys, ...justAttached]);
  const missing = requiredDocs.filter((d) => !attached.has(d.key));
  const done = requiredDocs.filter((d) => attached.has(d.key));

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-2">{t("saleDetail.requiredDocsTitle")}</div>
      <div className="space-y-2">
        {done.map((d) => (
          <div key={d.key} className="flex items-center justify-between text-[12px]">
            <span className="text-ink">{bilingualLabel(locale, d)}</span>
            <span className="text-action">✓ {t("saleDetail.requiredDocAttached")}</span>
          </div>
        ))}
        {missing.map((d) => (
          <RequiredDocUpload
            key={d.key}
            submissionId={submissionId}
            requirementKey={d.key}
            label={bilingualLabel(locale, d)}
            onDone={() => {
              setJustAttached((prev) => [...prev, d.key]);
              router.refresh();
            }}
          />
        ))}
      </div>
    </div>
  );
}
