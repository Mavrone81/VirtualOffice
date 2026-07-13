import { format } from "date-fns";
import { FileText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { maskNric, maskAccount } from "@/lib/crypto";
import { decryptPiiAudited } from "@/server/pii";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "My P-File · Enshrine Portal" };

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
  const t = await getTranslations("portal");

  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={t("pfile.pageTitle")} subtitle={t("pfile.noProfile")} />;

  const [me, pfile] = await Promise.all([
    prisma.associate.findUnique({ where: { id: associateId }, include: { directUpline: { select: { associateCode: true, fullName: true } } } }),
    prisma.pFile.findUnique({ where: { associateId }, include: { documents: { orderBy: { filedAt: "desc" } } } }),
  ]);
  if (!me) return <PageHeader title={t("pfile.pageTitle")} subtitle={t("pfile.notFound")} />;

  const actorUserId = session?.user.id ?? null;
  const nricPlain = await decryptPiiAudited({ blob: me.nric, field: "nric", subjectType: "Associate", subjectId: me.id, actorUserId });
  const bankAcctPlain = await decryptPiiAudited({ blob: me.bankAccountNumber, field: "bankAccount", subjectType: "Associate", subjectId: me.id, actorUserId });

  const payTo = me.paymentMethod === "PayNow"
    ? me.paynowNumber
    : me.bankName ? `${me.bankName} · ${maskAccount(bankAcctPlain)}` : null;

  return (
    <>
      <PageHeader title={t("pfile.pageTitle")} subtitle={t("pfile.pageSubtitle")} />

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
              <Field label={t("pfile.fieldBusinessName")} value={me.businessName} />
              <Field label={t("pfile.fieldTeam")} value={me.teamName} />
              <Field label={t("pfile.fieldMobile")} value={me.mobileNumber} />
              <Field label={t("pfile.fieldEmail")} value={me.email} />
              <Field label={t("pfile.fieldNric")} value={maskNric(nricPlain)} />
              <Field label={t("pfile.fieldDob")} value={me.dateOfBirth ? format(me.dateOfBirth, "dd MMM yyyy") : null} />
              <Field label={t("pfile.fieldJoinDate")} value={me.joinDate ? format(me.joinDate, "dd MMM yyyy") : null} />
              <Field label={t("pfile.fieldDirectUpline")} value={me.directUpline ? `${me.directUpline.associateCode} · ${me.directUpline.fullName}` : null} />
              <Field label={t("pfile.fieldPayout")} value={me.paymentMethod ? `${humanize(me.paymentMethod)}${payTo ? ` · ${payTo}` : ""}` : null} />
            </div>
          </Card>
        </div>

        <div>
          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">{t("pfile.docsHeading")}</h2>
            {!pfile || pfile.documents.length === 0 ? (
              <p className="text-[13px] text-muted">{t("pfile.noDocs")}</p>
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
