import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { buildVCard } from "@/lib/vcard";
import { PageHeader } from "@/components/ui/page-header";
import { NameCardStudio } from "@/components/name-card/studio";

export const metadata = { title: "Name Card · Enshrine Portal" };

export default async function NameCardPage() {
  const session = await auth();
  const tNav = await getTranslations("nav");
  const tCard = await getTranslations("nameCard");
  const tStatus = await getTranslations("status");

  const associateId = session?.user.associateId ?? null;
  if (!associateId) return <PageHeader title={tNav("nameCard")} />;

  const [me, card] = await Promise.all([
    prisma.associate.findUnique({ where: { id: associateId } }),
    prisma.nameCard.findFirst({ where: { userId: session!.user.id } }),
  ]);
  if (!me) return <PageHeader title={tNav("nameCard")} />;

  const title = card?.customTitle || tStatus(me.designation);
  const vcf = buildVCard({ fullName: me.fullName, businessName: me.businessName, title, mobile: me.mobileNumber, email: me.email, associateCode: me.associateCode });
  const qr = await QRCode.toDataURL(vcf, { margin: 1, width: 240, color: { dark: "#1a1f2b", light: "#ffffff" } });

  return (
    <>
      <PageHeader title={tNav("nameCard")} subtitle={tCard("subtitle")} />
      <NameCardStudio
        editable
        data={{ chineseName: card?.chineseName ?? "", englishName: me.fullName, title, hp: me.mobileNumber, email: me.email, qrDataUrl: qr }}
      />
    </>
  );
}
