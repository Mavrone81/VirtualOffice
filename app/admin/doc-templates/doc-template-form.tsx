"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TemplateCategory } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { uploadDocTemplate } from "@/server/documents/template-actions";
import { useTranslations } from "next-intl";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function DocTemplateForm() {
  const t = useTranslations("docTemplateAdmin");
  const tc = useTranslations("agreements");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [category, setCategory] = useState<TemplateCategory>("PetsAfterlife");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const CATEGORIES: { v: TemplateCategory; label: string }[] = [
    { v: "PetsAfterlife", label: tc("docTemplate.cat.pets") },
    { v: "HumanAfterlife", label: tc("docTemplate.cat.human") },
  ];

  function submit() {
    setError(undefined);
    if (!file) { setError(t("form.errorNoFile")); return; }
    start(async () => {
      const r = await uploadDocTemplate({ category, title, file });
      if (r.ok) { setTitle(""); setFile(null); router.refresh(); }
      else setError(r.error);
    });
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-display text-[17px] text-ink">{t("form.heading")}</h2>
      <div className="space-y-4">
        <div>
          <Label htmlFor="dtc">{t("form.categoryLabel")}</Label>
          <select id="dtc" className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
            {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="dtt">{t("form.titleLabel")}</Label>
          <Input id="dtt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("form.titlePlaceholder")} />
        </div>
        <div>
          <Label htmlFor="dtf">{t("form.fileLabel")}</Label>
          <input id="dtf" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-body file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-[13px] file:text-white hover:file:bg-ink-700" />
          <p className="mt-1 text-[12px] text-muted-2">{t("form.fileHint")}</p>
        </div>
        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button onClick={submit} disabled={pending || !title || !file}>{pending ? t("form.submitting") : t("form.submit")}</Button>
      </div>
    </Card>
  );
}
