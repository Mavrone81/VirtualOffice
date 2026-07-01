"use server";

import { revalidatePath } from "next/cache";
import { Prisma, LedgerStatus, LedgerLineType, PayoutStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

/** Aggregate this month's Eligible ledger lines into monthly_payouts per associate. */
export async function runPayouts(month: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Forbidden" };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "Bad month" };

  const lines = await prisma.commissionLedger.findMany({
    where: { payoutMonth: month, status: LedgerStatus.Eligible, associateId: { not: null } },
    include: { associate: true },
  });

  type Agg = { personal: Prisma.Decimal; override: Prisma.Decimal; addon: Prisma.Decimal; assoc: NonNullable<(typeof lines)[number]["associate"]> };
  const byAssoc = new Map<string, Agg>();
  for (const l of lines) {
    if (!l.associateId || !l.associate) continue;
    const a = byAssoc.get(l.associateId) ?? {
      personal: new Prisma.Decimal(0), override: new Prisma.Decimal(0), addon: new Prisma.Decimal(0), assoc: l.associate,
    };
    if (l.lineType === LedgerLineType.Personal) a.personal = a.personal.add(l.amount);
    else if (l.lineType === LedgerLineType.Override) a.override = a.override.add(l.amount);
    else if (l.lineType === LedgerLineType.AddOn) a.addon = a.addon.add(l.amount);
    byAssoc.set(l.associateId, a);
  }

  let count = 0;
  for (const [associateId, v] of byAssoc) {
    const total = v.personal.add(v.override).add(v.addon);
    await prisma.monthlyPayout.upsert({
      where: { associateId_payoutMonth: { associateId, payoutMonth: month } },
      update: { personalCommission: v.personal, overrideCommission: v.override, addonCommission: v.addon, totalPayable: total },
      create: {
        payoutMonth: month, associateId, associateName: v.assoc.fullName, designation: v.assoc.designation,
        personalCommission: v.personal, overrideCommission: v.override, addonCommission: v.addon, totalPayable: total,
        paymentMethod: v.assoc.paymentMethod, paynowNumber: v.assoc.paynowNumber,
        bankName: v.assoc.bankName, bankAccountNumber: v.assoc.bankAccountNumber, payoutStatus: PayoutStatus.Pending,
      },
    });
    count++;
  }
  revalidatePath("/admin/payouts");
  return { ok: true, count };
}

export async function setPayoutStatus(payoutId: string, status: "Approved" | "Paid"): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Forbidden" };
  await prisma.monthlyPayout.update({
    where: { id: payoutId },
    data: {
      payoutStatus: status === "Paid" ? PayoutStatus.Paid : PayoutStatus.Approved,
      paidDate: status === "Paid" ? new Date() : undefined,
    },
  });
  revalidatePath("/admin/payouts");
  return { ok: true };
}

export async function approveAllPayouts(month: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Forbidden" };
  await prisma.monthlyPayout.updateMany({
    where: { payoutMonth: month, payoutStatus: PayoutStatus.Pending },
    data: { payoutStatus: PayoutStatus.Approved },
  });
  revalidatePath("/admin/payouts");
  return { ok: true };
}
