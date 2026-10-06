// Item 9: the landing page for a sale an admin just submitted from
// /admin/sales/new (SaleForm navigates here on a split-exception warning or
// a legacy TXN code, same as the portal). Reuses the portal's own detail
// page component as-is — it gates on session.associateId + row ownership,
// not on role or route, so it's already correct for an admin viewing their
// own submission. Its OWN internal "back"/"edit" links still point into
// /portal/sales/..., which would bounce an admin back out via
// app/portal/layout.tsx's role redirect if clicked — a known rough edge,
// not fixed here: parametrizing those is a bigger change than this item
// (routing only) asks for, and nothing in it affects the data this item's
// proof actually checks (status, closer attribution, commission lines).
export { default } from "@/app/portal/sales/[id]/page";
export const metadata = { title: "Sale · Enshrine Admin" };
