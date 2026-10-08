import { EditSalePageWithBase } from "@/app/portal/sales/[id]/edit/edit-sale-page";

// The admin-side edit route. Without it the detail page's Edit button pointed at
// a /portal path that bounces.
export const metadata = { title: "Edit sale · Enshrine Admin" };
export default async function AdminEditSalePage({ params }: { params: Promise<{ id: string }> }) {
  return EditSalePageWithBase({ params, basePath: "/admin/sales" });
}
