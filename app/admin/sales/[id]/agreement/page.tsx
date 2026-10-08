export { default } from "@/app/portal/sales/[id]/agreement/page";

// The admin-side agreement route. /admin/agreements linked straight into
// /portal/sales/<id>/agreement, which bounced — this is the route that link now
// points at. The page itself takes no base path: it renders the agreement and
// owns no outward links into the sales tree.
export const metadata = { title: "Agreement · Enshrine Admin" };
