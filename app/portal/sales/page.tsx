import { MySalesPageWithBase } from "./my-sales-page";

export const metadata = { title: "My sales · Enshrine Portal" };

export default async function MySalesPage() {
  return MySalesPageWithBase({ basePath: "/portal/sales" });
}
