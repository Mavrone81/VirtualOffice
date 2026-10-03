"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { updateCompanyDetails } from "@/server/company/actions";

export type CompanyDetailsRow = {
  id: string;
  name: string;
  active: boolean;
  legalName: string | null;
  address: string | null;
  uen: string | null;
  paynowUen: string | null;
  contactEmail: string | null;
  phone: string | null;
  website: string | null;
};

function CompanyCard({ row }: { row: CompanyDetailsRow }) {
  const t = useTranslations("company");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({
    legalName: row.legalName ?? "",
    address: row.address ?? "",
    uen: row.uen ?? "",
    paynowUen: row.paynowUen ?? "",
    contactEmail: row.contactEmail ?? "",
    phone: row.phone ?? "",
    website: row.website ?? "",
  });
  const set = (p: Partial<typeof f>) => {
    setSaved(false);
    setF((x) => ({ ...x, ...p }));
  };
  const text = (id: string, key: keyof typeof f, label: string, type = "text") => (
    <div>
      <Label htmlFor={`${id}-${row.id}`}>{label}</Label>
      <Input id={`${id}-${row.id}`} type={type} value={f[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </div>
  );

  function save() {
    setError(undefined);
    start(async () => {
      const r = await updateCompanyDetails(row.id, f);
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(r.error ?? t("couldNotSave"));
      }
    });
  }

  return (
    <Card className="max-w-xl p-5">
      <div className="space-y-4">
        <h3 className="text-[15px] font-semibold text-ink">
          {row.name} <span className="text-[12px] font-normal text-muted-2">{row.active ? t("activeTag") : t("inactiveTag")}</span>
        </h3>
        {text("legalName", "legalName", t("legalNameLabel"))}
        {text("address", "address", t("addressLabel"))}
        {text("uen", "uen", t("uenLabel"))}
        {text("paynowUen", "paynowUen", t("paynowUenLabel"))}
        {text("contactEmail", "contactEmail", t("contactEmailLabel"), "email")}
        {text("phone", "phone", t("phoneLabel"))}
        {text("website", "website", t("websiteLabel"))}

        {saved && <p className="text-[12px] text-muted-2">{t("detailsSaved")}</p>}
        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button onClick={save} disabled={pending}>
          {pending ? tc("saving") : t("saveDetailsBtn")}
        </Button>
      </div>
    </Card>
  );
}

export function CompanyDetailsForm({ rows }: { rows: CompanyDetailsRow[] }) {
  const t = useTranslations("company");
  return (
    <section className="mb-8 space-y-4">
      <div>
        <h2 className="text-[16px] font-semibold text-ink">{t("detailsHeading")}</h2>
        <p className="text-[13px] text-muted-2">{t("detailsHint")}</p>
      </div>
      {rows.map((r) => (
        <CompanyCard key={r.id} row={r} />
      ))}
    </section>
  );
}
