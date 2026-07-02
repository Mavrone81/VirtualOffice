import { format } from "date-fns";
import { FileText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { decryptPII, maskNric, maskAccount } from "@/lib/crypto";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "My P-File · Enshrine Portal" };

function safeDecrypt(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try { return decryptPII(blob); } catch { return null; }
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{label}</div>
      <div className="mt-0.5 text-[13px] text-ink">{value || "—"}</div>
    </div>
  );
}

export default async function MyPFilePage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title="My P-File" subtitle="No associate profile is linked to this account." />;

  const [me, pfile] = await Promise.all([
    prisma.associate.findUnique({ where: { id: associateId }, include: { directUpline: { select: { associateCode: true, fullName: true } } } }),
    prisma.pFile.findUnique({ where: { associateId }, include: { documents: { orderBy: { filedAt: "desc" } } } }),
  ]);
  if (!me) return <PageHeader title="My P-File" subtitle="Profile not found." />;

  const payTo = me.paymentMethod === "PayNow"
    ? me.paynowNumber
    : me.bankName ? `${me.bankName} · ${maskAccount(safeDecrypt(me.bankAccountNumber))}` : null;

  return (
    <>
      <PageHeader title="My P-File" subtitle="Your personnel record and filed documents." />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-4">
              {me.photoFileKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${me.photoFileKey}`} alt={me.fullName} className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-paper-200 text-lg font-semibold text-muted">
                  {me.fullName.slice(0, 1)}
                </div>
              )}
              <div>
                <div className="font-display text-[18px] text-ink">{me.fullName}</div>
                <div className="text-[13px] text-muted">{humanize(me.designation)} · {me.associateCode}</div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" value={me.businessName} />
              <Field label="Team" value={me.teamName} />
              <Field label="Mobile" value={me.mobileNumber} />
              <Field label="Email" value={me.email} />
              <Field label="NRIC / FIN" value={maskNric(safeDecrypt(me.nric))} />
              <Field label="Date of birth" value={me.dateOfBirth ? format(me.dateOfBirth, "dd MMM yyyy") : null} />
              <Field label="Join date" value={me.joinDate ? format(me.joinDate, "dd MMM yyyy") : null} />
              <Field label="Direct upline" value={me.directUpline ? `${me.directUpline.associateCode} · ${me.directUpline.fullName}` : null} />
              <Field label="Payout" value={me.paymentMethod ? `${humanize(me.paymentMethod)}${payTo ? ` · ${payTo}` : ""}` : null} />
            </div>
          </Card>
        </div>

        <div>
          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">Documents</h2>
            {!pfile || pfile.documents.length === 0 ? (
              <p className="text-[13px] text-muted">No documents filed yet.</p>
            ) : (
              <div className="space-y-2">
                {pfile.documents.map((d) => (
                  <a key={d.id} href={`/api/files/${d.fileKey}`} target="_blank" rel="noopener"
                    className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-paper-100">
                    <FileText className="h-4 w-4 shrink-0 text-action" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink">{d.title}</div>
                      <div className="text-[11px] text-muted-2">{humanize(d.docType)} · {format(d.filedAt, "dd MMM yyyy")}</div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
