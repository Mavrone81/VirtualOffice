import { format } from "date-fns";
import { ApprovalStatus, AssociateStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { humanize } from "@/lib/labels";

// Google-Contacts-compatible CSV: Approved AND status in {Active, Terminated} (PRD §6.9).
export async function GET() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return new Response("Forbidden", { status: 403 });

  const rows = await prisma.associate.findMany({
    where: {
      approvalStatus: ApprovalStatus.Approved,
      associateStatus: { in: [AssociateStatus.Active, AssociateStatus.Terminated] },
    },
    orderBy: { associateCode: "asc" },
  });

  const header = ["Associate ID", "Full Name", "Designation", "Email", "Mobile", "Date of Birth", "Status"];
  const lines = [header];
  for (const a of rows) {
    lines.push([
      a.associateCode,
      a.fullName,
      humanize(a.designation),
      a.email ?? "",
      a.mobileNumber ?? "",
      a.dateOfBirth ? format(a.dateOfBirth, "yyyy-MM-dd") : "",
      humanize(a.associateStatus),
    ]);
  }
  const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="enshrine-contacts.csv"`,
    },
  });
}
