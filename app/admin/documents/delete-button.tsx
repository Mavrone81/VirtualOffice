"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDocument } from "@/server/documents/actions";

export function DeleteDocumentButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await deleteDocument(id); router.refresh(); })}
      className="text-[12px] text-danger hover:underline disabled:opacity-50"
    >
      {pending ? "Removing…" : "Delete"}
    </button>
  );
}
