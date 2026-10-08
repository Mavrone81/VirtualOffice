import { EditSalePageWithBase } from "./edit-sale-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit sale · Enshrine Portal" };

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  return EditSalePageWithBase({ params, basePath: "/portal/sales" });
}
