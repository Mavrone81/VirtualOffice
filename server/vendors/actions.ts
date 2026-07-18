"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { VendorStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { putObject } from "@/lib/storage";

const MAX_BYTES = 15_000_000;

export type VendorInput = {
  vendorName: string;
  vendorType?: string;
  contact?: string;
  remarks?: string;
  agreement?: File | null;
};

/** Submit a vendor referral to the registry (any signed-in associate). */
export async function submitVendor(input: VendorInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user) return { ok: false, error: t("forbidden") };
  if (!input.vendorName?.trim()) return { ok: false, error: t("vendorNameRequired") };

  let agreementFileKey: string | null = null;
  if (input.agreement && input.agreement.size > 0) {
    if (input.agreement.size > MAX_BYTES) return { ok: false, error: t("fileTooLarge") };
    const safeName = input.agreement.name.replace(/[^\w.\-]/g, "_").slice(-80) || "agreement";
    agreementFileKey = `vendors/${randomUUID()}/${safeName}`;
    await putObject(agreementFileKey, Buffer.from(await input.agreement.arrayBuffer()));
  }

  const vendor = await prisma.vendorReferral.create({
    data: {
      vendorName: input.vendorName.trim(),
      vendorType: input.vendorType?.trim() || null,
      contact: input.contact?.trim() || null,
      remarks: input.remarks?.trim() || null,
      agreementFileKey,
      submittedByAssociateId: session.user.associateId ?? null,
      status: VendorStatus.Active,
    },
  });
  await logAudit({ action: "vendor.submitted", entityType: "VendorReferral", entityId: vendor.id });
  revalidatePath("/portal/vendors");
  revalidatePath("/admin/vendors");
  return { ok: true };
}

export async function setVendorStatus(id: string, status: "Active" | "Lapsed"): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };
  await prisma.vendorReferral.update({ where: { id }, data: { status: VendorStatus[status] } });
  await logAudit({ action: `vendor.status_${status.toLowerCase()}`, entityType: "VendorReferral", entityId: id, actorUserId: session.user.id });
  revalidatePath("/admin/vendors");
  revalidatePath("/portal/vendors");
  return { ok: true };
}
