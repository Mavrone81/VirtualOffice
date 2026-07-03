"use server";

import { revalidatePath } from "next/cache";
import { VendorStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";

export type VendorInput = {
  vendorName: string;
  vendorType?: string;
  contact?: string;
  remarks?: string;
};

/** Submit a vendor referral to the registry (any signed-in associate). */
export async function submitVendor(input: VendorInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user) return { ok: false, error: t("forbidden") };
  if (!input.vendorName?.trim()) return { ok: false, error: t("vendorNameRequired") };

  await prisma.vendorReferral.create({
    data: {
      vendorName: input.vendorName.trim(),
      vendorType: input.vendorType?.trim() || null,
      contact: input.contact?.trim() || null,
      remarks: input.remarks?.trim() || null,
      submittedByAssociateId: session.user.associateId ?? null,
      status: VendorStatus.Active,
    },
  });
  revalidatePath("/portal/vendors");
  revalidatePath("/admin/vendors");
  return { ok: true };
}

export async function setVendorStatus(id: string, status: "Active" | "Lapsed"): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };
  await prisma.vendorReferral.update({ where: { id }, data: { status: VendorStatus[status] } });
  revalidatePath("/admin/vendors");
  revalidatePath("/portal/vendors");
  return { ok: true };
}
