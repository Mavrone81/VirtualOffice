import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { roleLabel } from "@/lib/rbac";
import { buildVCard } from "@/lib/vcard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } });
  const name = session.user.name ?? "Enshrine";
  const vcf = buildVCard({ fullName: name, title: roleLabel[session.user.role], email: user?.email ?? session.user.email ?? null });

  return new NextResponse(vcf, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="enshrine-${name.replace(/[^\w]+/g, "-").toLowerCase()}.vcf"`,
      "Cache-Control": "no-store",
    },
  });
}
