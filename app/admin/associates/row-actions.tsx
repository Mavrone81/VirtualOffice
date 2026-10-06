"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { setApprovalStatus, setAssociateStatus, archiveAssociate, deleteAssociate } from "@/server/associates/actions";

// Archive (the normal "remove this person" path, reversible) and delete (the
// narrow, permanent one) are deliberately not the same control: archive stays
// a single click, same weight as Suspend/Reactivate above; delete uses the
// expand-then-confirm panel idiom from app/admin/sales/verify/reject-button.tsx
// rather than a browser confirm() — the refusal message carries a count
// ("has 3 associates reporting to them") that a confirm() dialog can't be
// tested or styled around, and this panel renders it as ordinary page text.
function DeleteAssociateControl({ id }: { id: string }) {
  const t = useTranslations("associates");
  const tc = useTranslations("common");
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string>();
  const router = useRouter();

  function confirmDelete() {
    setErr(undefined);
    start(async () => {
      const r = await deleteAssociate(id);
      if (r.ok) { setOpen(false); router.refresh(); }
      else setErr(r.error ?? t("failed"));
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => setOpen(true)}>
        {tc("delete")}
      </Button>
    );
  }

  return (
    <div className="inline-flex flex-col gap-2 rounded-lg border border-line bg-paper-100 p-3 text-[12px]">
      {err ? (
        <span className="text-danger" role="alert">{err}</span>
      ) : (
        <span>{t("deleteConfirm")}?</span>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="danger" disabled={pending} onClick={confirmDelete}>
          {pending ? "…" : t("deleteConfirm")}
        </Button>
        <button type="button" className="text-muted hover:underline" onClick={() => { setOpen(false); setErr(undefined); }}>
          {tc("cancel")}
        </button>
      </div>
    </div>
  );
}

export function AssociateRowActions({
  id,
  approval,
  status,
  archived,
}: {
  id: string;
  approval: string;
  status: string;
  archived: boolean;
}) {
  const t = useTranslations("associates");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const router = useRouter();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? t("failed"));
      else router.refresh();
    });

  if (archived) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => archiveAssociate(id, false))}>
          {t("unarchive")}
        </Button>
        {err && <span className="text-[11px] text-danger" role="alert">{err}</span>}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {approval === "Pending" && (
        <>
          <Button size="sm" disabled={pending} onClick={() => run(() => setApprovalStatus(id, "Approved"))}>
            {t("approve")}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setApprovalStatus(id, "Rejected"))}>
            {t("reject")}
          </Button>
        </>
      )}
      {approval === "Approved" && status === "Active" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setAssociateStatus(id, "Suspended"))}>
          {t("suspend")}
        </Button>
      )}
      {approval === "Approved" && status === "Suspended" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setAssociateStatus(id, "Active"))}>
          {t("reactivate")}
        </Button>
      )}
      {/* Both deactivated states, matching the server guard. Suspend is the only
          way this UI takes an APPROVED associate out of service, so gating on
          Inactive alone hid these controls from every such record. */}
      {(status === "Inactive" || status === "Suspended") && (
        <>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => archiveAssociate(id, true))}>
            {t("archive")}
          </Button>
          <DeleteAssociateControl id={id} />
        </>
      )}
      {err && <span className="text-[11px] text-danger" role="alert">{err}</span>}
    </span>
  );
}
