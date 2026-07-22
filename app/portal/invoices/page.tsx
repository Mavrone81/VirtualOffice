import { redirect } from "next/navigation";

// Retired 2026-07-22 (16-Jul quotation workflow): the rep surface is now
// "My Quotations" (download quotation + signed-docs docket + paid-invoice link).
export default function InvoicesRedirect() {
  redirect("/portal/quotations");
}
