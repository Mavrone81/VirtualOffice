import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { OnboardingStage } from "@prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The blank Associate Agreement the candidate signs (the same file the portal's
 *  Documents page offers). Bump the version in the onboarding copy with it. */
const AGREEMENT_FILE = path.join(process.cwd(), "public", "templates", "associate-agreement.pdf");

/**
 * The full Associate Agreement for a candidate mid-onboarding. The candidate
 * isn't logged in, so /templates/… (behind auth) is out of reach; the
 * onboarding token is the credential here, same as the onboarding page itself.
 * `?download=1` saves the file; otherwise it opens in the browser.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await prisma.candidate.findUnique({ where: { onboardingToken: token }, select: { onboardingStage: true } });
  if (!c || c.onboardingStage === OnboardingStage.Rejected) return new NextResponse("Not found", { status: 404 });

  const data = await fs.readFile(AGREEMENT_FILE);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="Enshrine-Associate-Agreement.pdf"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
