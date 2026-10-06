// Item 9: the plain-list landing spot SaleForm's basePath="/admin/sales"
// falls back to when a submission has no split-exception warning and no
// legacy TXN code. Reuses the portal's own "my sales" list as-is — same
// rough edge as app/admin/sales/[id]/page.tsx's comment: its row/button
// links still point into /portal/sales/..., not fixed here.
export { default } from "@/app/portal/sales/page";
export const metadata = { title: "My sales · Enshrine Admin" };
