import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { EditAssociateForm, type EditInitial } from "./edit-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit associate · Enshrine Admin" };

// Admin-only edit of an associate's core record. Uplines are edited on the
// detail page (dedicated cycle-guarded editor); login/role/status are separate.
export default async function EditAssociatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isFullAdmin(session.user.role)) redirect("/admin/associates");
  const { id } = await params;
  const t = await getTranslations("associates");

  const a = await prisma.associate.findUnique({ where: { id } });
  const activeTeams = await prisma.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } });
  // The associate's CURRENT division is always offered, even when it is no
  // longer an active team or never matched one. Without this, opening the edit
  // form for someone on a deactivated or mistyped division shows a blank select
  // and silently rewrites their division the moment anything else is saved — a
  // data change nobody asked for and nobody would see.
  const teams = activeTeams.map((x) => x.name);
  if (a?.teamName && !teams.includes(a.teamName)) teams.push(a.teamName);
  if (!a) notFound();

  const initial: EditInitial = {
    fullName: a.fullName,
    businessName: a.businessName ?? "",
    mobileNumber: a.mobileNumber ?? "",
    email: a.email ?? "",
    dateOfBirth: a.dateOfBirth ? format(a.dateOfBirth, "yyyy-MM-dd") : "",
    joinDate: a.joinDate ? format(a.joinDate, "yyyy-MM-dd") : "",
    designation: a.designation,
    teamName: a.teamName ?? "",
    recruitingManager: a.recruitingManager ?? "",
    paymentMethod: a.paymentMethod === "BankTransfer" ? "Bank Transfer" : a.paymentMethod === "PayNow" ? "PayNow" : "PayNow",
    paynowNumber: a.paynowNumber ?? "",
    bankName: a.bankName ?? "",
    hasNric: !!a.nric,
    hasBankAccount: !!a.bankAccountNumber,
  };

  return (
    <>
      <PageHeader title={t("edit.title", { name: a.fullName })} subtitle={`${a.associateCode}`} />
      <EditAssociateForm id={id} initial={initial} teams={teams} />
    </>
  );
}
