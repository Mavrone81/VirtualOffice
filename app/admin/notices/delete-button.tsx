"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteNotice } from "@/server/notices/actions";
import { useTranslations } from "next-intl";

export function DeleteNoticeButton({ id }: { id: string }) {
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await deleteNotice(id); router.refresh(); })}
      className="text-[12px] text-danger hover:underline disabled:opacity-50"
    >
      {pending ? t("removing") : t("delete")}
    </button>
  );
}
