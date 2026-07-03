"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DocumentType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { uploadDocument } from "@/server/documents/actions";
import { useTranslations } from "next-intl";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function DocumentForm() {
  const t = useTranslations("documents");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocumentType>("CompanyTemplate");
  const [assignment, setAssignment] = useState<"All" | "Team" | "Associate">("All");
  const [team, setTeam] = useState("");
  const [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const TYPES: { v: DocumentType; label: string }[] = [
    { v: "CompanyTemplate", label: t("form.typeCompanyTemplate") },
    { v: "AssociateAgreement", label: t("form.typeAssociateAgreement") },
    { v: "VendorAgreement", label: t("form.typeVendorAgreement") },
    { v: "VendorMOU", label: t("form.typeVendorMOU") },
    { v: "SalesAgreement", label: t("form.typeSalesAgreement") },
    { v: "Other", label: t("form.typeOther") },
  ];

  function submit() {
    setError(undefined);
    if (!file) { setError(t("form.errorNoFile")); return; }
    start(async () => {
      const r = await uploadDocument({ title, type, assignment, assignedTeam: team, assignedAssociateCode: code, file });
      if (r.ok) { setTitle(""); setTeam(""); setCode(""); setFile(null); router.refresh(); }
      else setError(r.error ?? t("form.errorDefault"));
    });
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-display text-[17px] text-ink">{t("form.heading")}</h2>
      <div className="space-y-4">
        <div>
          <Label htmlFor="t">{t("form.titleLabel")}</Label>
          <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sales agreement template" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ty">{t("form.typeLabel")}</Label>
            <select id="ty" className={selectCls} value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {TYPES.map((tp) => <option key={tp.v} value={tp.v}>{tp.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="as">{t("form.sharedWithLabel")}</Label>
            <select id="as" className={selectCls} value={assignment} onChange={(e) => setAssignment(e.target.value as "All" | "Team" | "Associate")}>
              <option value="All">{t("form.assignAll")}</option>
              <option value="Team">{t("form.assignTeam")}</option>
              <option value="Associate">{t("form.assignAssociate")}</option>
            </select>
          </div>
          {assignment === "Team" && (
            <div>
              <Label htmlFor="tm">{t("form.teamNameLabel")}</Label>
              <Input id="tm" value={team} onChange={(e) => setTeam(e.target.value)} />
            </div>
          )}
          {assignment === "Associate" && (
            <div>
              <Label htmlFor="ac">{t("form.associateCodeLabel")}</Label>
              <Input id="ac" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EN0001" />
            </div>
          )}
        </div>
        <div>
          <Label htmlFor="f">{t("form.fileLabel")}</Label>
          <input id="f" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-body file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-[13px] file:text-white hover:file:bg-ink-700" />
          <p className="mt-1 text-[12px] text-muted-2">{t("form.fileHint")}</p>
        </div>
        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button onClick={submit} disabled={pending || !title || !file}>{pending ? t("form.submitting") : t("form.submit")}</Button>
      </div>
    </Card>
  );
}
