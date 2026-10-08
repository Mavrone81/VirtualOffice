import { SaleDetailPageWithBase } from "@/app/portal/sales/[id]/page";

// Same component as the portal's sale detail, with the admin base path. It gates
// on session.associateId + row ownership, not on role or route, so it was always
// correct for an admin viewing their own submission — only its links were wrong.
export const metadata = { title: "Sale · Enshrine Admin" };
export default async function AdminSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return SaleDetailPageWithBase({ params, basePath: "/admin/sales" });
}
