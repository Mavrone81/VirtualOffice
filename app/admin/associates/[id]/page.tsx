import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { decryptPII, maskNric, maskAccount } from "@/lib/crypto";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { ResetPasswordButton } from "./reset-password";

export const metadata = { title: "Associate · Enshrine Admin" };

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

export default async function AdminAssociateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await prisma.associate.findUnique({
    where: { id },
    include: {
      directUpline: { select: { associateCode: true, fullName: true } },
      user: { select: { email: true, isActive: true } },
      pFile: { include: { documents: { orderBy: { filedAt: "desc" } } } },
    },
  });
  if (!a) notFound();

  const payTo = a.paymentMethod === "PayNow"
    ? a.paynowNumber
    : a.bankName ? `${a.bankName} · ${maskAccount(safeDecrypt(a.bankAccountNumber))}` : null;

  return (
    <>
      <PageHeader title={a.fullName} subtitle={`${humanize(a.designation)} · ${a.associateCode}`}>
        <Button asChild variant="secondary"><Link href="/admin/associates">← All associates</Link></Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-4">
              {a.photoFileKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${a.photoFileKey}`} alt={a.fullName} className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-paper-200 text-lg font-semibold text-muted">{a.fullName.slice(0, 1)}</div>
              )}
              <div className="flex items-center gap-2">
                <StatusPill status={a.approvalStatus} />
                <StatusPill status={a.associateStatus} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" value={a.businessName} />
              <Field label="Team" value={a.teamName} />
              <Field label="Mobile" value={a.mobileNumber} />
              <Field label="Email" value={a.email} />
              <Field label="NRIC / FIN" value={maskNric(safeDecrypt(a.nric))} />
              <Field label="Date of birth" value={a.dateOfBirth ? format(a.dateOfBirth, "dd MMM yyyy") : null} />
              <Field label="Join date" value={a.joinDate ? format(a.joinDate, "dd MMM yyyy") : null} />
              <Field label="Direct upline" value={a.directUpline ? `${a.directUpline.associateCode} · ${a.directUpline.fullName}` : null} />
              <Field label="Login" value={a.user ? `${a.user.email}${a.user.isActive ? "" : " (disabled)"}` : "Not provisioned"} />
              <Field label="Payout" value={a.paymentMethod ? `${humanize(a.paymentMethod)}${payTo ? ` · ${payTo}` : ""}` : null} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {a.user && (
            <Card className="p-5">
              <h2 className="mb-1 font-display text-[16px] text-ink">Login</h2>
              <p className="mb-3 text-[12px] text-muted">{a.user.email}</p>
              <ResetPasswordButton associateId={a.id} />
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">P-file documents</h2>
            {!a.pFile || a.pFile.documents.length === 0 ? (
              <p className="text-[13px] text-muted">No documents filed.</p>
            ) : (
              <div className="space-y-2">
                {a.pFile.documents.map((d) => (
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
