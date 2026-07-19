import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { UAT_SECTIONS } from "@/lib/uat-cases";
import { UatRunner } from "./uat-runner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acceptance testing · Enshrine VirtualOffice" };

// Standalone UAT runner. Any signed-in account may record (keeps this off the
// public internet); results are grouped by the tester name they enter, not the
// role account, so one person's run holds together across role logins.
export default async function UatPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const assoc = session.user.associateId
    ? await prisma.associate.findUnique({ where: { id: session.user.associateId }, select: { fullName: true } })
    : null;
  const defaultTester = assoc?.fullName ?? session.user.name ?? "";

  return <UatRunner sections={UAT_SECTIONS} defaultTester={defaultTester} />;
}
