import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { VendorStatusToggle } from "./status-toggle";

export const metadata = { title: "Vendors · Enshrine Admin" };

export default async function AdminVendorsPage() {
  const vendors = await prisma.vendorReferral.findMany({
    orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
    include: { submittedByAssociate: { select: { fullName: true, associateCode: true } } },
  });

  return (
    <>
      <PageHeader title="Vendors" subtitle="Vendor referrals submitted by associates. Keep the registry current — mark lapsed vendors inactive." />

      <Card className="overflow-hidden">
        {vendors.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">No vendor referrals yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Vendor</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-5 py-3 font-medium">Submitted by</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3">
                      <div className="text-ink">{v.vendorName}</div>
                      {v.remarks && <div className="text-[11px] text-muted-2">{v.remarks}</div>}
                    </td>
                    <td className="px-5 py-3 text-muted">{v.vendorType ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{v.contact ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">
                      {v.submittedByAssociate ? `${v.submittedByAssociate.fullName} (${v.submittedByAssociate.associateCode})` : "—"}
                      <div className="text-[11px] text-muted-2">{format(v.submittedAt, "dd MMM yyyy")}</div>
                    </td>
                    <td className="px-5 py-3"><StatusPill status={v.status} /></td>
                    <td className="px-5 py-3 text-right"><VendorStatusToggle id={v.id} status={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
