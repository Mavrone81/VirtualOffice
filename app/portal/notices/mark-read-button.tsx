"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNoticeRead } from "@/server/notices/actions";
import { useTranslations } from "next-intl";

export function MarkReadButton({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations("portal");
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await markNoticeRead(id); router.refresh(); })}
      className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-action hover:bg-paper-100 disabled:opacity-50"
    >
      {pending ? "…" : t("notices.markAsRead")}
    </button>
  );
}
