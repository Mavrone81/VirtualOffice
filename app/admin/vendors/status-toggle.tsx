"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setVendorStatus } from "@/server/vendors/actions";

export function VendorStatusToggle({ id, status }: { id: string; status: "Active" | "Lapsed" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = status === "Active" ? "Lapsed" : "Active";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await setVendorStatus(id, next); router.refresh(); })}
      className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-ink hover:bg-paper-100 disabled:opacity-50"
    >
      {pending ? "…" : status === "Active" ? "Mark lapsed" : "Reactivate"}
    </button>
  );
}
