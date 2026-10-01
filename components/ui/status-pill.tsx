"use client";

import { useTranslations } from "next-intl";
import { humanize } from "@/lib/labels";

type Tone = "success" | "warn" | "danger" | "info" | "neutral";

const tones: Record<Tone, string> = {
  success: "bg-success-50 text-success",
  warn: "bg-gold/10 text-gold",
  danger: "bg-danger-50 text-danger",
  info: "bg-action-50 text-action",
  neutral: "bg-paper-200 text-muted",
};

// keyed by Prisma enum member names
const STATUS_TONE: Record<string, Tone> = {
  Active: "success", Approved: "success", Paid: "success", Eligible: "success", QuotationApproved: "success",
  Pending: "warn", Outstanding: "warn", PendingCollection: "warn", Submitted: "warn", Invited: "warn", Suspended: "warn",
  PartiallyEligible: "info",
  Inactive: "neutral", Lapsed: "neutral", Cancelled: "neutral",
  Rejected: "danger", Terminated: "danger", Incomplete: "danger", Ineligible: "danger",
};

// `status` always picks the tone (keyed by the raw enum member, shared
// across entities). `label` is an optional override for when the enum
// member's shared translation doesn't fit THIS entity — e.g. "Active" reads
// as 在职 ("in active employment"), right for an associate but wrong for a
// product or any other non-person record; pass the entity's own distinct
// copy instead of letting it fall through to the person-oriented one.
export function StatusPill({ status, tone, label }: { status: string; tone?: Tone; label?: string }) {
  const tr = useTranslations("status");
  const toneCls = tone ?? STATUS_TONE[status] ?? "neutral";
  // Translate the enum member; fall back to the humanized English label.
  const resolvedLabel = label ?? (tr.has(status) ? tr(status) : humanize(status));
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[toneCls]}`}>
      {resolvedLabel}
    </span>
  );
}
