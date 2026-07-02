import { format } from "date-fns";
import { DocumentAssignment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DocumentForm } from "./document-form";
import { DeleteDocumentButton } from "./delete-button";

export const metadata = { title: "Documents · Enshrine Admin" };

function sharedWith(d: { assignment: DocumentAssignment; assignedTeam: string | null; assignedAssociate: { associateCode: string } | null }): string {
  if (d.assignment === DocumentAssignment.Team) return `Team · ${d.assignedTeam ?? "—"}`;
  if (d.assignment === DocumentAssignment.Associate) return `Associate · ${d.assignedAssociate?.associateCode ?? "—"}`;
  return "Everyone";
}

export default async function AdminDocumentsPage() {
  const docs = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    include: { assignedAssociate: { select: { associateCode: true } } },
  });

  return (
    <>
      <PageHeader title="Documents" subtitle="Shared templates and files for associates — company-wide, per team, or per associate." />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <DocumentForm />

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-[17px] text-ink">Library ({docs.length})</h2>
          </div>
          {docs.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-muted">No documents uploaded yet.</p>
          ) : (
            <div className="divide-y divide-line-200">
              {docs.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <a href={`/documents/${d.id}/download`} target="_blank" rel="noopener" className="font-medium text-action hover:underline">
                      {d.title} ↗
                    </a>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-muted-2">
                      <span>{humanize(d.type)}</span>
                      <span>{sharedWith(d)}</span>
                      <span>{format(d.createdAt, "dd MMM yyyy")}</span>
                    </div>
                  </div>
                  <DeleteDocumentButton id={d.id} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
