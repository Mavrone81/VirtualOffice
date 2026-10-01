"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MarketingCollection, MarketingAsset } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  createMarketingCollection,
  archiveMarketingCollection,
  archiveMarketingAsset,
  deleteMarketingCollection,
} from "@/server/marketing/actions";

type CollectionWithAssets = MarketingCollection & { assets: MarketingAsset[] };

const MAX_BYTES = 20_000_000;

function formatBytes(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.ceil(n / 1000)} KB`;
}

export function AdminMarketingLibrary({
  category,
  collections,
  usageBytes,
  capBytes,
}: {
  category: string;
  collections: CollectionWithAssets[];
  usageBytes: number;
  capBytes: number;
}) {
  const t = useTranslations("adminMarketing");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [uploadingCollectionId, setUploadingCollectionId] = useState<string>();
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const usagePct = capBytes > 0 ? Math.min(100, (usageBytes / capBytes) * 100) : 0;
  const nearCap = usagePct >= 80;

  function createCollection() {
    const name = newName.trim();
    if (!name) return;
    setError(undefined);
    start(async () => {
      const r = await createMarketingCollection({ category: category as never, name });
      if (r.ok) {
        setNewName("");
        router.refresh();
      } else {
        setError(t("uploadError", { reason: r.error ?? "" }));
      }
    });
  }

  async function uploadFile(collectionId: string, file: File) {
    if (file.size > MAX_BYTES) {
      setError(t("fileTooLarge"));
      return;
    }
    setError(undefined);
    setWarning(undefined);
    setUploadingCollectionId(collectionId);
    try {
      const res = await fetch(`/admin/marketing/upload?collectionId=${collectionId}`, {
        method: "POST",
        headers: { "x-file-name": file.name, "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      const json = (await res.json()) as { ok: boolean; error?: string; warnNearCap?: boolean };
      if (!json.ok) setError(t("uploadError", { reason: json.error ?? "" }));
      else if (json.warnNearCap) setWarning(t("libraryNearCap"));
      router.refresh();
    } catch {
      setError(t("uploadError", { reason: "uploadFailed" }));
    } finally {
      setUploadingCollectionId(undefined);
    }
  }

  function toggleCollection(id: string, archived: boolean) {
    start(async () => {
      await archiveMarketingCollection(id, archived);
      router.refresh();
    });
  }

  function toggleAsset(id: string, archived: boolean) {
    start(async () => {
      await archiveMarketingAsset(id, archived);
      router.refresh();
    });
  }

  function removeCollection(id: string) {
    if (!window.confirm(t("deleteConfirm"))) return;
    start(async () => {
      await deleteMarketingCollection(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex items-center justify-between text-[12px]">
          <span className={nearCap ? "font-medium text-danger" : "text-muted"}>
            {t("libraryUsage", { used: formatBytes(usageBytes), cap: formatBytes(capBytes) })}
          </span>
          <span className={nearCap ? "font-medium text-danger" : "text-muted-2"}>{usagePct.toFixed(0)}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-200">
          <div className={`h-full ${nearCap ? "bg-danger" : "bg-action"}`} style={{ width: `${usagePct}%` }} />
        </div>
      </Card>

      {warning && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{warning}</p>}

      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">{t("newCollectionHeading")}</h2>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="cn">{t("collectionName")}</Label>
            <Input id="cn" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("collectionNamePlaceholder")} />
          </div>
          <Button onClick={createCollection} disabled={pending || !newName.trim()}>
            {t("createCollection")}
          </Button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      </Card>

      {collections.length === 0 ? (
        <EmptyState message={t("emptyLibrary")} />
      ) : (
        collections.map((c) => (
          <Card key={c.id} className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line-200 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{c.name}</span>
                  {c.archivedAt && <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] text-muted">{t("archived")}</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-2">{t("assetCount", { count: c.assets.length })}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[12px]">
                <input
                  ref={(el) => { fileInputs.current[c.id] = el; }}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(c.id, f); e.target.value = ""; }}
                />
                <button
                  type="button"
                  disabled={pending || uploadingCollectionId === c.id}
                  onClick={() => fileInputs.current[c.id]?.click()}
                  className="text-action hover:underline disabled:opacity-50"
                >
                  {uploadingCollectionId === c.id ? t("uploading") : t("uploadAction")}
                </button>
                <button type="button" disabled={pending} onClick={() => toggleCollection(c.id, !c.archivedAt)} className="text-action hover:underline disabled:opacity-50">
                  {c.archivedAt ? t("unarchive") : t("archive")}
                </button>
                <button type="button" disabled={pending} onClick={() => removeCollection(c.id)} className="text-danger hover:underline disabled:opacity-50">
                  {t("delete")}
                </button>
              </div>
            </div>
            {c.assets.length === 0 ? (
              <div className="px-5 py-6 text-center text-[13px] text-muted">{t("emptyCollection")}</div>
            ) : (
              <div className="divide-y divide-line-200">
                {c.assets.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <a href={`/marketing/files/${a.id}`} target="_blank" rel="noopener" className="truncate font-medium text-action hover:underline">
                        {a.fileName} ↗
                      </a>
                      <div className="mt-0.5 text-[11px] text-muted-2">
                        {formatBytes(a.sizeBytes)} {a.archivedAt && `· ${t("archived")}`}
                      </div>
                    </div>
                    <button type="button" disabled={pending} onClick={() => toggleAsset(a.id, !a.archivedAt)} className="shrink-0 text-[12px] text-action hover:underline disabled:opacity-50">
                      {a.archivedAt ? t("unarchive") : t("archive")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
