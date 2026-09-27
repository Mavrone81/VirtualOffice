import type { ReactNode } from "react";

/** Promotes the ad hoc `px-5 py-10 text-center text-muted` empty-list pattern (e.g. admin/commission's ledgerEmpty) to a shared component. */
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center text-[13px] text-muted">
      <p>{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
