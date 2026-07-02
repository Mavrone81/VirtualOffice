import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isManagerRole } from "@/lib/rbac";

// Team dashboards are for Sales Managers / Directors only.
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isManagerRole(session.user.role)) redirect("/portal/dashboard");
  return <>{children}</>;
}
