import { MySalesPageWithBase } from "@/app/portal/sales/page";

// The admin's own "my sales" list. Renders the portal page with the ADMIN base
// path, so its row and button links stay inside /admin — a /portal link bounces
// an admin out via app/portal/layout.tsx's role redirect, which is why an admin
// could submit a sale and then be unable to open it (owner, 2026-10-08).
export const metadata = { title: "My sales · Enshrine Admin" };
export default async function AdminSalesPage() {
  return MySalesPageWithBase({ basePath: "/admin/sales" });
}
