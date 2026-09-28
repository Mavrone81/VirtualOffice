"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { getVerifyChecklist, verifySale } from "@/server/sales/actions";
import { canConfirmVerify, nextStateAfterVerifyRefusal, type ChecklistState } from "@/lib/verify-panel-logic";

const GATE_KEYS = ["G1", "G2", "G3", "G4", "G5"] as const;

// A-17 screen 4: the G1-G5 checklist, read-only until Verify is pressed.
// getVerifyChecklist and verifySale share the SAME gate logic (Backend's
// design note, ADR-0001 §7) — this panel never re-derives a pass/fail, it
// only renders what the server already decided. contentVersion from the
// checklist load is what's sent back to verifySale (G4): if the sale
// changed underneath the admin, verifySale itself refuses and we reload the
// checklist so the screen reflects the current state before another attempt.
export function VerifyPanel({ id }: { id: string }) {
  const t = useTranslations("verify");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checklist, setChecklist] = useState<ChecklistState | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadChecklist() {
    setError(null);
    start(async () => {
      const r = await getVerifyChecklist(id);
      if (r.ok) setChecklist({ gates: r.gates, allPass: r.allPass, contentVersion: r.contentVersion });
      else setError(r.error);
    });
  }

  function confirmVerify() {
    if (!checklist) return;
    setError(null);
    start(async () => {
      const r = await verifySale(id, checklist.contentVersion);
      if (r.ok) { setChecklist(null); router.refresh(); }
      else {
        const refreshed = await getVerifyChecklist(id);
        const next = nextStateAfterVerifyRefusal(r.error, refreshed);
        setChecklist(next.checklist);
        setError(next.error);
      }
    });
  }

  if (!checklist) {
    return (
      <div className="inline-flex flex-col items-start gap-2">
        <Button size="sm" onClick={loadChecklist} disabled={pending}>{pending ? "…" : t("action")}</Button>
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-paper-100 p-3 text-[12px]">
      <ul className="space-y-1">
        {GATE_KEYS.map((key) => {
          const g = checklist.gates.find((x) => x.key === key);
          if (!g) return null;
          return (
            <li key={key} className="flex items-start gap-2">
              <span className={g.pass ? "text-success" : "text-danger"}>{g.pass ? "✓" : "✗"}</span>
              <span className="text-ink">{t(`gate.${key}`)}</span>
              {!g.pass && g.reasonKey && <span className="text-muted">— {te(g.reasonKey)}</span>}
            </li>
          );
        })}
      </ul>
      {error && <div className="mt-2"><Banner tone="danger">{error}</Banner></div>}
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={!canConfirmVerify(checklist, pending)} onClick={confirmVerify}>
          {pending ? "…" : t("action")}
        </Button>
        <button type="button" className="text-muted hover:underline" onClick={loadChecklist} disabled={pending}>{t("recheck")}</button>
        <button type="button" className="text-muted hover:underline" onClick={() => setChecklist(null)}>{t("cancel")}</button>
      </div>
    </div>
  );
}
