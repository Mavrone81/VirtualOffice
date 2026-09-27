"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const selectCls =
  "h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus:border-action focus:outline-none disabled:opacity-50";
const dateCls = "h-9 w-36 px-2 text-[13px]";
const textCls = "h-9 w-40 px-2 text-[13px]";
const TEXT_DEBOUNCE_MS = 400;

export type FilterOption = { value: string; label: string };

export type FilterField =
  | { type: "select"; key: string; label: string; options: FilterOption[]; emptyLabel?: string }
  | { type: "date-range"; fromKey: string; toKey: string; labelFrom: string; labelTo: string }
  // B-2: a free-text filter (e.g. Txn ID). Debounced so it doesn't push a URL
  // change on every keystroke — every OTHER field type navigates immediately.
  | { type: "text"; key: string; label: string; placeholder?: string };

/**
 * B-2/B-3/B-4's shared filter bar: read/writes filters as URL query params
 * (shareable/bookmarkable, per build-plan-a-b.md's B-3 acceptance criterion),
 * combined with AND by whatever server-side query builder the page uses.
 * Changing a filter resets `page` back to the first page.
 */
export function FilterBar({ fields, clearAllLabel }: { fields: FilterField[]; clearAllLabel: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const managedKeys = fields.flatMap((f) => (f.type === "date-range" ? [f.fromKey, f.toKey] : [f.key]));
  const hasActive = managedKeys.some((k) => searchParams.get(k));

  function navigate(params: URLSearchParams) {
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    navigate(params);
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const k of managedKeys) params.delete(k);
    navigate(params);
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {fields.map((f) => {
        if (f.type === "date-range") {
          return (
            <div key={f.fromKey} className="flex items-end gap-2">
              <div>
                <Label htmlFor={f.fromKey}>{f.labelFrom}</Label>
                <Input id={f.fromKey} type="date" className={dateCls} value={searchParams.get(f.fromKey) ?? ""}
                  onChange={(e) => setParam(f.fromKey, e.target.value)} />
              </div>
              <div>
                <Label htmlFor={f.toKey}>{f.labelTo}</Label>
                <Input id={f.toKey} type="date" className={dateCls} value={searchParams.get(f.toKey) ?? ""}
                  onChange={(e) => setParam(f.toKey, e.target.value)} />
              </div>
            </div>
          );
        }
        if (f.type === "text") {
          return (
            <div key={f.key}>
              <Label htmlFor={f.key}>{f.label}</Label>
              <DebouncedTextInput id={f.key} className={textCls} placeholder={f.placeholder}
                value={searchParams.get(f.key) ?? ""} onCommit={(v) => setParam(f.key, v)} />
            </div>
          );
        }
        const noOptions = f.options.length === 0 && f.emptyLabel;
        return (
          <div key={f.key}>
            <Label htmlFor={f.key}>{f.label}</Label>
            {noOptions ? (
              <select id={f.key} className={selectCls} disabled>
                <option>{f.emptyLabel}</option>
              </select>
            ) : (
              <select id={f.key} className={selectCls} value={searchParams.get(f.key) ?? ""}
                onChange={(e) => setParam(f.key, e.target.value)}>
                <option value="">—</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
        );
      })}
      {hasActive && (
        <button type="button" onClick={clearAll} className="h-9 text-[12px] text-action hover:underline">
          {clearAllLabel}
        </button>
      )}
    </div>
  );
}

/**
 * A free-text filter field: local state for immediate typing feedback, the
 * URL (and therefore the server query) only updates TEXT_DEBOUNCE_MS after
 * the user stops typing — every keystroke pushing a URL change would be
 * disruptive (history spam, a query per character).
 */
function DebouncedTextInput({
  id, className, placeholder, value, onCommit,
}: {
  id: string; className: string; placeholder?: string; value: string; onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The URL value can change from outside (e.g. "Clear filters", browser
  // back/forward) — resync the draft when that happens.
  useEffect(() => setDraft(value), [value]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function onChange(v: string) {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(v), TEXT_DEBOUNCE_MS);
  }

  return (
    <Input
      id={id}
      className={className}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        if (timer.current) clearTimeout(timer.current);
        onCommit(draft);
      }}
    />
  );
}
