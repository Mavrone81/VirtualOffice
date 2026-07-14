import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ForceResetForm } from "./force-reset-form";

export const metadata: Metadata = { title: "Set a new password · Enshrine Virtual Office" };

export default async function ForcePasswordResetPage() {
  const session = await auth();
  // Only reachable while a reset is actually required; otherwise go home.
  if (!session?.user) redirect("/login");
  if (!session.user.mustResetPassword) redirect("/");

  const t = await getTranslations("forceReset");
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="font-display text-[26px] text-ink">{t("title")}</h1>
          <p className="mt-1 text-[14px] text-muted">{t("subtitle")}</p>
        </div>
        <Card className="p-5">
          <ForceResetForm />
        </Card>
      </div>
    </main>
  );
}
