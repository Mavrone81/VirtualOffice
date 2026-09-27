import { format } from "date-fns";
import { ApprovalStatus, AssociateStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { auditTx } from "@/lib/audit";

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

  // Tier A (PII export): recorded before any row is written out — no record, no file.
  try {
    await auditTx(prisma, { action: "pii.exported", entityType: "Associate", entityId: null, actorUserId: session.user.id, after: { export: "contacts", rows: rows.length, fields: ["fullName", "email", "mobileNumber", "dateOfBirth"] } });
  } catch {
    return new Response("Temporarily unavailable — please try again", { status: 503 });
  }

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
