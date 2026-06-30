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
  Active: "success", Approved: "success", Paid: "success", Eligible: "success", Verified: "success",
  Pending: "warn", Outstanding: "warn", PendingCollection: "warn", Submitted: "warn", Invited: "warn", Suspended: "warn",
  PartiallyEligible: "info",
  Inactive: "neutral", Lapsed: "neutral", Cancelled: "neutral",
  Rejected: "danger", Terminated: "danger", Incomplete: "danger", Ineligible: "danger",
};

export function StatusPill({ status, tone }: { status: string; tone?: Tone }) {
  const t = tone ?? STATUS_TONE[status] ?? "neutral";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[t]}`}>
      {humanize(status)}
    </span>
  );
}
