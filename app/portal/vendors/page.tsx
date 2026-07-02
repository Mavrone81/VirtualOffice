import { VendorStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { VendorForm } from "./vendor-form";

export const metadata = { title: "Vendor registry · Enshrine Portal" };

export default async function PortalVendorsPage() {
  const vendors = await prisma.vendorReferral.findMany({
    where: { status: VendorStatus.Active },
    orderBy: { vendorName: "asc" },
  });

  return (
    <>
      <PageHeader title="Vendor registry" subtitle="Approved vendors you can refer clients to — and submit new ones for review." />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <VendorForm />

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-[17px] text-ink">Active vendors ({vendors.length})</h2>
          </div>
          {vendors.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-muted">No vendors in the registry yet.</p>
          ) : (
            <div className="divide-y divide-line-200">
              {vendors.map((v) => (
                <div key={v.id} className="px-5 py-4">
                  <div className="font-medium text-ink">{v.vendorName}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-[12px] text-muted">
                    {v.vendorType && <span>{v.vendorType}</span>}
                    {v.contact && <span>{v.contact}</span>}
                  </div>
                  {v.remarks && <p className="mt-1 text-[12px] text-muted-2">{v.remarks}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
