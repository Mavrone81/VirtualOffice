import QRCode from "qrcode";
import { Phone, Mail } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { buildVCard } from "@/lib/vcard";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Name Card · Enshrine Portal" };

export default async function NameCardPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title="Name Card" subtitle="No associate profile is linked to this account." />;

  const a = await prisma.associate.findUnique({ where: { id: associateId } });
  if (!a) return <PageHeader title="Name Card" subtitle="Profile not found." />;

  const title = humanize(a.designation);
  const vcf = buildVCard({ fullName: a.fullName, businessName: a.businessName, title, mobile: a.mobileNumber, email: a.email, associateCode: a.associateCode });
  const qr = await QRCode.toDataURL(vcf, { margin: 1, width: 260, color: { dark: "#1a1f2b", light: "#ffffff" } });

  return (
    <>
      <PageHeader title="Name Card" subtitle="Your digital business card. Share the QR or save it to contacts.">
        <Button asChild variant="secondary"><a href="/portal/name-card/vcf">Save to contacts (.vcf)</a></Button>
      </PageHeader>

      <div className="mx-auto max-w-xl">
        {/* Card */}
        <div className="overflow-hidden rounded-2xl bg-ink text-white shadow-sm">
          <div className="flex items-stretch justify-between gap-4 p-7">
            <div className="flex min-w-0 flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 font-display text-base">E</div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Enshrine</div>
                </div>
                <h1 className="mt-5 font-display text-[24px] leading-tight">{a.fullName}</h1>
                <div className="mt-1 text-[13px] text-gold-300">{title}</div>
                {a.businessName && <div className="text-[12px] text-white/50">{a.businessName}</div>}
              </div>
              <div className="mt-6 space-y-1.5 text-[13px] text-white/75">
                {a.mobileNumber && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 opacity-70" strokeWidth={1.75} />{a.mobileNumber}</div>}
                {a.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 opacity-70" strokeWidth={1.75} />{a.email}</div>}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Scan to save contact" className="h-32 w-32 rounded-lg bg-white p-1.5" />
              <div className="mt-2 text-[10px] uppercase tracking-wide text-white/40">Scan to save</div>
            </div>
          </div>
          <div className="border-t border-white/10 px-7 py-3 text-[11px] text-white/40">
            {a.associateCode} · Enshrine Services · Pets Paradise · Afterlife Planner
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] text-muted-2">
          Scanning the QR code adds your details straight to a phone&rsquo;s contacts.
        </p>
      </div>
    </>
  );
}
