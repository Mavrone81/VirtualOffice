"use server";

import { revalidatePath } from "next/cache";
import { UatStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { UAT_CASE_IDS } from "@/lib/uat-cases";

const STATUSES = new Set<string>(Object.values(UatStatus));

/**
 * Record a UAT result. Any signed-in user may record (prevents a public write
 * endpoint on prod); the row is keyed by the tester-entered name so one person's
 * run stays coherent across role logins. Idempotent upsert per (case, tester).
 */
export async function setUatResult(input: {
  caseId: string;
  testerName: string;
  status: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user) return { ok: false, error: t("forbidden") };

  const caseId = input.caseId?.trim();
  const testerName = input.testerName?.trim().slice(0, 80);
  if (!caseId || !UAT_CASE_IDS.has(caseId)) return { ok: false, error: t("notFound") };
  if (!testerName) return { ok: false, error: t("invalidInput") };
  if (!STATUSES.has(input.status)) return { ok: false, error: t("invalidInput") };

  const notes = input.notes?.trim().slice(0, 1000) || null;
  const data = { status: input.status as UatStatus, notes, updatedById: session.user.id };
  await prisma.uatResult.upsert({
    where: { caseId_testerName: { caseId, testerName } },
    create: { caseId, testerName, ...data },
    update: data,
  });

  revalidatePath("/uat");
  revalidatePath("/admin/uat");
  return { ok: true };
}

/** Distinct tester names that already have saved results — for resume autocomplete. */
export async function getUatTesters(): Promise<string[]> {
  const session = await auth();
  if (!session?.user) return [];
  const rows = await prisma.uatResult.findMany({ distinct: ["testerName"], select: { testerName: true }, orderBy: { testerName: "asc" } });
  return rows.map((r) => r.testerName);
}

/** Load one tester's saved results, keyed by case id, for the /uat runner. */
export async function getUatResults(testerName: string): Promise<Record<string, { status: string; notes: string | null }>> {
  const session = await auth();
  if (!session?.user) return {};
  const name = testerName?.trim().slice(0, 80);
  if (!name) return {};
  const rows = await prisma.uatResult.findMany({
    where: { testerName: name },
    select: { caseId: true, status: true, notes: true },
  });
  return Object.fromEntries(rows.map((r) => [r.caseId, { status: r.status, notes: r.notes }]));
}
