import { OnboardingStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { OnboardForm } from "./onboard-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome to Enshrine · Onboarding" };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper">
      <div className="border-b border-line bg-ink text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 font-display text-lg">E</div>
          <div className="leading-tight">
            <div className="font-display text-[16px]">Enshrine</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">Associate Onboarding</div>
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
  const c = await prisma.candidate.findUnique({
    where: { onboardingToken: token },
    select: { fullName: true, intendedDesignation: true, onboardingStage: true },
  });

  if (!c) {
    return (
      <Shell>
        <Notice title="Link not found" body="This onboarding link is invalid or has expired. Please contact your Enshrine recruiter for a new link." />
      </Shell>
    );
  }

  if (c.onboardingStage === OnboardingStage.Approved) {
    return (
      <Shell>
        <Notice title="You're already onboarded" body="Your application has been approved. Please check your email for your virtual-office login details." />
      </Shell>
    );
  }

  if (c.onboardingStage === OnboardingStage.Rejected) {
    return (
      <Shell>
        <Notice title="Application closed" body="This onboarding application is no longer active. Please contact your Enshrine recruiter if you believe this is a mistake." />
      </Shell>
    );
  }

  const alreadySubmitted = c.onboardingStage !== OnboardingStage.Invited;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="font-display text-[26px] leading-tight text-ink">Welcome, {c.fullName.split(" ")[0]}</h1>
        <p className="mt-1 text-[14px] text-muted">
          You&rsquo;ve been invited to join Enshrine as a {humanize(c.intendedDesignation ?? "Sales Consultant")}. Complete
          your details below and sign the Associate Agreement — it takes about 3 minutes.
        </p>
      </div>
      <OnboardForm token={token} alreadySubmitted={alreadySubmitted} />
    </Shell>
  );
}
