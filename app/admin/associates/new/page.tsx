import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { AssociateForm } from "./associate-form";

export const metadata = { title: "New associate · Enshrine Admin" };

export default async function NewAssociatePage() {
  const uplines = await prisma.associate.findMany({
    orderBy: { associateCode: "asc" },
    select: { associateCode: true, fullName: true, designation: true },
  });
  return (
    <>
      <PageHeader title="New associate" subtitle="Add an associate to the master record. Approve to provision their login." />
      <AssociateForm
        uplines={uplines.map((u) => ({ code: u.associateCode, label: `${u.associateCode} · ${u.fullName} (${humanize(u.designation)})` }))}
      />
    </>
  );
}
