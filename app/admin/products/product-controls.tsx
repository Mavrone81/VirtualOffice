"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProductActive, addComCode, toggleComCode } from "@/server/products/actions";

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => start(async () => { await setProductActive(id, !active); router.refresh(); })}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        active ? "bg-success-50 text-success" : "bg-paper-200 text-muted"
      }`}
    >
      {pending ? "…" : active ? "Active" : "Inactive"}
    </button>
  );
}

export function ComCodeManager({
  productId,
  comCodes,
}: {
  productId: string;
  comCodes: { id: string; comCode: string; label: string; valueType: string; value: string; active: boolean }[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ comCode: "", label: "", valueType: "Percentage" as "Percentage" | "Absolute", value: "" });

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {comCodes.length === 0 && <span className="text-[11px] text-muted-2">No add-on com codes</span>}
        {comCodes.map((c) => (
          <button
            key={c.id}
            disabled={pending}
            onClick={() => start(async () => { await toggleComCode(c.id, !c.active); router.refresh(); })}
            title="Toggle active"
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              c.active ? "border-action-200 bg-action-50 text-action" : "border-line bg-paper-200 text-muted line-through"
            }`}
          >
            {c.label} · {c.valueType === "Percentage" ? `${c.value}%` : `$${c.value}`}
          </button>
        ))}
        <button onClick={() => setOpen((v) => !v)} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:bg-paper-100">
          + com code
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-line-200 bg-paper-100 p-2">
          <input className="h-8 w-24 rounded border border-line px-2 text-[12px]" placeholder="CODE" value={f.comCode} onChange={(e) => setF({ ...f, comCode: e.target.value })} />
          <input className="h-8 w-32 rounded border border-line px-2 text-[12px]" placeholder="Label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <select className="h-8 rounded border border-line px-2 text-[12px]" value={f.valueType} onChange={(e) => setF({ ...f, valueType: e.target.value as "Percentage" | "Absolute" })}>
            <option value="Percentage">%</option>
            <option value="Absolute">$</option>
          </select>
          <input className="h-8 w-20 rounded border border-line px-2 text-[12px]" placeholder="Value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await addComCode(productId, f);
                if (r.ok) { setF({ comCode: "", label: "", valueType: "Percentage", value: "" }); setOpen(false); router.refresh(); }
              })
            }
            className="h-8 rounded-lg bg-action px-3 text-[12px] font-medium text-white"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
