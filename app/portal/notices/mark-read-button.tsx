"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNoticeRead } from "@/server/notices/actions";

export function MarkReadButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await markNoticeRead(id); router.refresh(); })}
      className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-action hover:bg-paper-100 disabled:opacity-50"
    >
      {pending ? "…" : "Mark as read"}
    </button>
  );
}
