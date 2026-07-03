import { OnboardingStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { getTranslations } from "next-intl/server";
import { OnboardForm } from "./onboard-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome to Enshrine · Onboarding" };

async function Shell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("onboarding");
  return (
    <main className="min-h-screen bg-paper">
      <div className="border-b border-line bg-ink text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 font-display text-lg">E</div>
          <div className="leading-tight">
            <div className="font-display text-[16px]">Enshrine</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">{t("header.subtitle")}</div>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-6 py-8">{children}</div>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-8 text-center">
      <h1 className="font-display text-[22px] text-ink">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

export default async function OnboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("onboarding");
  const c = await prisma.candidate.findUnique({
    where: { onboardingToken: token },
    select: { fullName: true, intendedDesignation: true, onboardingStage: true },
  });

  if (!c) {
    return (
      <Shell>
        <Notice title={t("linkNotFound.title")} body={t("linkNotFound.body")} />
      </Shell>
    );
  }

  if (c.onboardingStage === OnboardingStage.Approved) {
    return (
      <Shell>
        <Notice title={t("alreadyOnboarded.title")} body={t("alreadyOnboarded.body")} />
      </Shell>
    );
  }

  if (c.onboardingStage === OnboardingStage.Rejected) {
    return (
      <Shell>
        <Notice title={t("applicationClosed.title")} body={t("applicationClosed.body")} />
      </Shell>
    );
  }

  const alreadySubmitted = c.onboardingStage !== OnboardingStage.Invited;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="font-display text-[26px] leading-tight text-ink">
          {t("welcome", { name: c.fullName.split(" ")[0] })}
        </h1>
        <p className="mt-1 text-[14px] text-muted">
          {t("intro", { designation: humanize(c.intendedDesignation ?? "Sales Consultant") })}
        </p>
      </div>
      <OnboardForm token={token} alreadySubmitted={alreadySubmitted} />
    </Shell>
  );
}
