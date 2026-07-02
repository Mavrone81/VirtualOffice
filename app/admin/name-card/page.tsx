import QRCode from "qrcode";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { roleLabel } from "@/lib/rbac";
import { buildVCard } from "@/lib/vcard";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { NameCardView } from "@/components/name-card/card-view";

export const metadata = { title: "Name Card · Enshrine Admin" };

export default async function AdminNameCardPage() {
  const session = await auth();
  if (!session?.user) return <PageHeader title="Name Card" />;

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } });
  const name = session.user.name ?? "Enshrine";
  const title = roleLabel[session.user.role];
  const email = user?.email ?? session.user.email ?? null;

  const vcf = buildVCard({ fullName: name, title, email });
  const qr = await QRCode.toDataURL(vcf, { margin: 1, width: 260, color: { dark: "#1a1f2b", light: "#ffffff" } });

  return (
    <>
      <PageHeader title="Name Card" subtitle="Your Enshrine digital business card.">
        <Button asChild variant="secondary"><a href="/admin/name-card/vcf">Save to contacts (.vcf)</a></Button>
      </PageHeader>

      <div className="mx-auto max-w-xl">
        <NameCardView
          name={name}
          title={title}
          email={email}
          qrDataUrl={qr}
          footer="Enshrine Services · Pets Paradise · Afterlife Planner"
        />
        <p className="mt-4 text-center text-[12px] text-muted-2">
          Scanning the QR code adds your details straight to a phone&rsquo;s contacts.
        </p>
      </div>
    </>
  );
}
