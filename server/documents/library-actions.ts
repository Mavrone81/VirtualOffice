"use server";

import { TemplateCategory } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { uploadDocument, type DocumentUpload } from "./actions";
import { uploadDocTemplate } from "./template-actions";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

// One upload entry point for the admin Documents page (C-6 folded Doc Template
// into it). Two shapes, and the audience fields exist on only one of them: a
// category template is always shared with everyone, so it cannot be addressed
// to a team or an associate by construction.
export type LibraryUpload =
  | ({ category: null } & DocumentUpload)
  | { category: TemplateCategory; title: string; file: File; confirmedReplace?: boolean };

/**
 * A category upload retires the current template for that category, so it is
 * refused until the caller says it has shown the admin a confirmation
 * (`confirmedReplace`) — checked here, not just in the form, so a stale or
 * hand-built request cannot retire a template silently. The retire/supersede
 * itself is NOT done here: it is uploadDocTemplate's (partial unique index +
 * single transaction), called as-is.
 */
export async function uploadLibraryDocument(input: LibraryUpload): Promise<{ ok: boolean; error?: string }> {
  if (input.category === null) return uploadDocument(input);

  const t = await getTranslations("documents");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("form.errorForbidden") };
  if (!Object.values(TemplateCategory).includes(input.category)) return { ok: false, error: t("form.errorDefault") };

  if (!input.confirmedReplace) {
    const current = await prisma.document.findFirst({
      where: { category: input.category, retiredAt: null },
      select: { id: true },
    });
    if (current) return { ok: false, error: t("form.errorNeedsConfirm") };
  }

  // Only category, title and file are forwarded — never an audience.
  const r = await uploadDocTemplate({ category: input.category, title: input.title, file: input.file });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
