import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { buildVCard } from "@/lib/vcard";
import { PageHeader } from "@/components/ui/page-header";
import { NameCardStudio } from "@/components/name-card/studio";
import { ownAssociate } from "@/server/name-card/own-associate";

export const metadata = { title: "Name Card · Enshrine Admin" };

export default async function AdminNameCardPage() {
  const session = await auth();
  const tNav = await getTranslations("nav");
  const tCard = await getTranslations("nameCard");
  const tRoles = await getTranslations("roles");
  const tStatus = await getTranslations("status");
  if (!session?.user) return <PageHeader title={tNav("nameCard")} />;

  // An admin's own card reads from their ASSOCIATE record, not the session, so
  // it shows what every other card shows: the name they trade under when they
  // have one, and their mobile. The earlier patch left this file out on the
  // stated premise that "an Admin has none to pass" — measured against
  // production that is false, every user on file including both admins has an
  // associate profile. The session fallback survives only for a login with no
  // associate record at all, so the page renders rather than blanks.
  const [user, card] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } }),
    prisma.nameCard.findFirst({ where: { userId: session.user.id } }),
  ]);
  // Shared with the .vcf route so the card and the saved contact cannot drift
  // apart — see server/name-card/own-associate.ts for why the email is tried
  // when the session carries no associateId.
  const loginEmail = user?.email ?? session.user.email ?? null;
  const me = await ownAssociate({ associateId: session.user.associateId, email: loginEmail });

  const name = me ? me.businessName || me.fullName : session.user.name ?? "Enshrine";
  const mobile = me?.mobileNumber ?? null;
  // The owner asked for the DESIGNATION ("Sales Director"), not the app role
  // ("Admin", which this app labels "Product Owner") — those are different
  // fields and an admin has both. Falls back to the role label only when there
  // is no associate record to read one from.
  const title = card?.customTitle || (me ? tStatus(me.designation) : tRoles(session.user.role));
  const email = me?.email ?? user?.email ?? session.user.email ?? null;

  const vcf = buildVCard({ fullName: me?.fullName ?? name, businessName: me?.businessName ?? null, title, mobile, email, associateCode: me?.associateCode });
  const qr = await QRCode.toDataURL(vcf, { margin: 1, width: 240, color: { dark: "#1a1f2b", light: "#ffffff" } });

  return (
    <>
      <PageHeader title={tNav("nameCard")} subtitle={tCard("subtitle")} />
      <NameCardStudio
        editable
        canEditTitle
        data={{ chineseName: card?.chineseName ?? "", englishName: name, title, hp: mobile, email, qrDataUrl: qr }}
      />
    </>
  );
}
