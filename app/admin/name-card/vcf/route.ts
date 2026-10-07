import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { roleLabel } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { buildVCard } from "@/lib/vcard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  // Same source as the card itself (app/admin/name-card/page.tsx): the saved
  // contact has to match what the card shows, or a client saves one name and
  // reads another.
  const [user, me] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } }),
    session.user.associateId
      ? prisma.associate.findUnique({ where: { id: session.user.associateId } })
      : Promise.resolve(null),
  ]);
  const name = me ? me.businessName || me.fullName : session.user.name ?? "Enshrine";
  const vcf = buildVCard({
    fullName: me?.fullName ?? name,
    businessName: me?.businessName ?? null,
    // The DESIGNATION, matching the card (app/admin/name-card/page.tsx). A
    // route handler has no next-intl translator, so humanize() renders the enum
    // ("SalesDirector" -> "Sales Director"); the card's translated label and
    // this agree in English, which is what a saved contact carries.
    title: me ? humanize(me.designation) : roleLabel[session.user.role],
    mobile: me?.mobileNumber ?? null,
    email: me?.email ?? user?.email ?? session.user.email ?? null,
    associateCode: me?.associateCode,
  });

  return new NextResponse(vcf, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="enshrine-${name.replace(/[^\w]+/g, "-").toLowerCase()}.vcf"`,
      "Cache-Control": "no-store",
    },
  });
}
