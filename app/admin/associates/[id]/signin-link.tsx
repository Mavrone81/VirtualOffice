"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createSignInLink } from "@/server/account/actions";

/**
 * "Create sign-in link": a one-time, 72-hour link for the associate to set
 * their own password, wrapped in a short ready-to-send message the admin can
 * copy into WhatsApp. For when the welcome email doesn't arrive — or any time.
 */
export function SignInLinkButton({ associateId }: { associateId: string }) {
  const t = useTranslations("associates");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [copied, setCopied] = useState(false);

  function create() {
    setError(undefined);
    setCopied(false);
    start(async () => {
      const r = await createSignInLink(associateId);
      if (r.ok && r.url && r.loginUrl && r.email) {
        setMessage(t("signinLink.message", { name: r.name ?? "", email: r.email, url: r.url, login: r.loginUrl }));
      } else setError(r.error ?? t("signinLink.failed"));
    });
  }

  async function copy() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setError(t("signinLink.copyFailed"));
    }
  }

  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" onClick={create} disabled={pending}>
        {pending ? t("signinLink.creating") : message ? t("signinLink.again") : t("signinLink.button")}
      </Button>
      <p className="mt-1 text-[11px] text-muted-2">{t("signinLink.hint")}</p>
      {message && (
        <div className="mt-2 rounded-lg border border-line bg-paper-100 p-3">
          <textarea readOnly value={message} rows={9} onFocus={(e) => e.currentTarget.select()}
            className="w-full resize-none bg-transparent text-[12px] leading-relaxed text-ink focus:outline-none" />
          <div className="mt-2 flex items-center gap-3">
            <Button size="sm" onClick={copy}>{copied ? t("signinLink.copied") : t("signinLink.copy")}</Button>
            <span className="text-[11px] text-muted-2">{t("signinLink.oneTime")}</span>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
