import QRCode from "qrcode";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { buildVCard } from "@/lib/vcard";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { NameCardView } from "@/components/name-card/card-view";

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
        <NameCardView
          name={a.fullName}
          title={title}
          business={a.businessName}
          mobile={a.mobileNumber}
          email={a.email}
          qrDataUrl={qr}
          footer={`${a.associateCode} · Enshrine Services · Pets Paradise · Afterlife Planner`}
        />
        <p className="mt-4 text-center text-[12px] text-muted-2">
          Scanning the QR code adds your details straight to a phone&rsquo;s contacts.
        </p>
      </div>
    </>
  );
}
