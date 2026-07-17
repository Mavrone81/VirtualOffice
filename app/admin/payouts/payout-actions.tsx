"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { runPayouts, approveAllPayouts, setPayoutStatus } from "@/server/payouts/actions";

export function RunPayoutsBar({ month }: { month: string }) {
  const t = useTranslations("payouts");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runPayouts(month);
            setMsg(r.ok ? t("aggregated", { count: r.count ?? 0 }) : r.error);
            router.refresh();
          })
        }
      >
        {pending ? t("running") : t("runPayouts")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => { await approveAllPayouts(month); router.refresh(); })}
      >
        {t("approveAll")}
      </Button>
      <BankFileButton month={month} />
      {msg && <span className="text-[12px] text-muted">{msg}</span>}
    </div>
  );
}

/**
 * Bank/GIRO file download, gated by a fresh password re-entry. The old bare GET
 * <a> link is gone: the button reveals an inline password field that POSTs to
 * the reauth-gated route, and the CSV is downloaded from the response blob only
 * after the server verifies the password (and audits the generation).
 */
function BankFileButton({ month }: { month: string }) {
  const t = useTranslations("payouts");
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.set("month", month);
      body.set("password", password);
      const res = await fetch("/admin/payouts/bank-file", { method: "POST", body });
      if (!res.ok) {
        const text = await res.text();
        setError(text || t("bankFileError"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `giro-payout-${month}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
      setPassword("");
    } catch {
      setError(t("bankFileError"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => { setError(undefined); setOpen(true); }}>
        {t("bankFile")}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (!busy && password) void download(); }}
    >
      <span className="text-[12px] text-muted">{t("bankFilePrompt")}</span>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("bankFilePassword")}
        aria-label={t("bankFilePassword")}
        className="h-8 rounded-lg border border-line bg-white px-3 text-[13px] text-ink"
      />
      <Button size="sm" type="submit" disabled={busy || !password}>
        {t("bankFileConfirm")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        type="button"
        disabled={busy}
        onClick={() => { setOpen(false); setPassword(""); setError(undefined); }}
      >
        {t("cancel")}
      </Button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </form>
  );
}

export function PayoutRowActions({ id, status }: { id: string; status: string }) {
  const t = useTranslations("payouts");
  const [pending, start] = useTransition();
  const router = useRouter();
  if (status === "Paid" || status === "Cancelled") return null;
  return (
    <span className="flex gap-1">
      {status === "Pending" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { await setPayoutStatus(id, "Approved"); router.refresh(); })}>
          {t("approve")}
        </Button>
      )}
      {status === "Approved" && (
        <Button size="sm" disabled={pending} onClick={() => start(async () => { await setPayoutStatus(id, "Paid"); router.refresh(); })}>
          {t("markPaid")}
        </Button>
      )}
    </span>
  );
}
