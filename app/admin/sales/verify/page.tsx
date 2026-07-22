import { redirect } from "next/navigation";

// Retired 2026-07-22 (16-Jul quotation workflow): the Business-Admin review step
// moved to /admin/quotations, where approval unlocks the rep's quotation.
export default function VerifyRedirect() {
  redirect("/admin/quotations");
}
