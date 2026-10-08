import { SaleDetailPageWithBase } from "./sale-detail-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sale · Enshrine Portal" };

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return SaleDetailPageWithBase({ params, basePath: "/portal/sales" });
}
