import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { buildVCard } from "@/lib/vcard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.associateId) return new NextResponse("Unauthorized", { status: 401 });

  const a = await prisma.associate.findUnique({ where: { id: session.user.associateId } });
  if (!a) return new NextResponse("Not found", { status: 404 });

  const vcf = buildVCard({
    fullName: a.fullName,
    businessName: a.businessName,
    title: humanize(a.designation),
    mobile: a.mobileNumber,
    email: a.email,
    associateCode: a.associateCode,
  });

  return new NextResponse(vcf, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${a.associateCode}.vcf"`,
      "Cache-Control": "no-store",
    },
  });
}
