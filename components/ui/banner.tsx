import type { ReactNode } from "react";

type Tone = "info" | "warn" | "danger";

const TONES: Record<Tone, string> = {
  info: "border-action/20 bg-action-50 text-action",
  warn: "border-gold-300 bg-paper-100 text-ink",
  danger: "border-danger/20 bg-danger-50 text-danger",
};

/** Inline, non-dismissible banner (docs/design/README.md's shared-component list). */
export function Banner({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-lg border px-3.5 py-2.5 text-[13px] ${TONES[tone]}`}>{children}</div>;
}
