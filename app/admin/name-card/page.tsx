import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { buildVCard } from "@/lib/vcard";
import { PageHeader } from "@/components/ui/page-header";
import { NameCardStudio } from "@/components/name-card/studio";

export const metadata = { title: "Name Card · Enshrine Admin" };

export default async function AdminNameCardPage() {
  const session = await auth();
  const tNav = await getTranslations("nav");
  const tCard = await getTranslations("nameCard");
  const tRoles = await getTranslations("roles");
  if (!session?.user) return <PageHeader title={tNav("nameCard")} />;

  const [user, card] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } }),
    prisma.nameCard.findFirst({ where: { userId: session.user.id } }),
  ]);
  const name = session.user.name ?? "Enshrine";
  const title = card?.customTitle || tRoles(session.user.role);
  const email = user?.email ?? session.user.email ?? null;

  const vcf = buildVCard({ fullName: name, title, email });
  const qr = await QRCode.toDataURL(vcf, { margin: 1, width: 240, color: { dark: "#1a1f2b", light: "#ffffff" } });

  return (
    <>
      <PageHeader title={tNav("nameCard")} subtitle={tCard("subtitle")} />
      <NameCardStudio
        editable
        canEditTitle
        data={{ chineseName: card?.chineseName ?? "", englishName: name, title, hp: null, email, qrDataUrl: qr }}
      />
    </>
  );
}
