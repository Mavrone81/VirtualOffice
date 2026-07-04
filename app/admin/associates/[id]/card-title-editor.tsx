"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setAssociateCardTitle } from "@/server/name-card/actions";

export function CardTitleEditor({ associateId, initial }: { associateId: string; initial: string }) {
  const t = useTranslations("nameCard");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(initial);
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(false);
    start(async () => {
      await setAssociateCardTitle(associateId, title);
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Funeral Director" />
      <p className="mt-1 text-[12px] text-muted-2">{t("cardTitleHint")}</p>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending}>{pending ? tc("saving") : tc("save")}</Button>
        {saved && <span className="text-[12px] text-success">{t("saved")}</span>}
      </div>
    </div>
  );
}
