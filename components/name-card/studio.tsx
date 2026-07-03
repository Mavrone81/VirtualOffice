"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { updateNameCard } from "@/server/name-card/actions";

const FRONT = "/namecard/card-front-blank.png";
const BACK = "/namecard/card-back.jpg";
const LOGO = "/namecard/enshrine-logo.png";
const ADDRESS = ["74 Lorong 6 Geylang", "Singapore 399226"];
const WEB = "www.enshrine.sg";
const FB = "www.facebook.com/enshrinefuneralservices";
const W = 661, H = 1075, DISPLAY_SCALE = 0.5;

export type CardData = {
  chineseName: string;
  englishName: string;
  title: string;
  hp: string | null;
  email: string | null;
  qrDataUrl: string;
};

const socialCircle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, borderRadius: "50%", background: "#2e5aa0",
};

export function NameCardStudio({ data, editable }: { data: CardData; editable: boolean }) {
  const t = useTranslations("nameCard");
  const frontRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"front" | "back">("front");
  const [busy, setBusy] = useState(false);

  // editor state
  const [pending, start] = useTransition();
  const [chineseName, setChineseName] = useState(data.chineseName);
  const [customTitle, setCustomTitle] = useState(data.title);
  const [saved, setSaved] = useState(false);

  async function toFrontPng(): Promise<string> {
    const { toPng } = await import("html-to-image");
    // wait for fonts to be ready so the capture includes the brush/serif faces
    if (document.fonts?.ready) await document.fonts.ready;
    return toPng(frontRef.current!, { width: W, height: H, pixelRatio: 2, cacheBust: true });
  }

  async function downloadPng() {
    setBusy(true);
    try {
      const url = await toFrontPng();
      const a = document.createElement("a");
      a.href = url;
      a.download = `enshrine-namecard-${data.englishName.replace(/[^\w]+/g, "-").toLowerCase()}.png`;
      a.click();
    } finally { setBusy(false); }
  }

  async function downloadPdf() {
    setBusy(true);
    try {
      const front = await toFrontPng();
      const back = await fetch(BACK).then((r) => r.blob()).then(blobToDataUrl);
      const { jsPDF } = await import("jspdf");
      const wmm = 54, hmm = +(54 * H / W).toFixed(2); // keep the card's aspect ratio
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [wmm, hmm] });
      doc.addImage(front, "PNG", 0, 0, wmm, hmm);
      doc.addPage([wmm, hmm], "portrait");
      doc.addImage(back, "JPEG", 0, 0, wmm, hmm);
      doc.save(`enshrine-namecard-${data.englishName.replace(/[^\w]+/g, "-").toLowerCase()}.pdf`);
    } finally { setBusy(false); }
  }

  function save() {
    setSaved(false);
    start(async () => {
      await updateNameCard({ chineseName, customTitle });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  // live-preview values reflect the editor immediately
  const preview: CardData = { ...data, chineseName, title: customTitle || data.title };

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      {/* Display fonts loaded via <link> (not next/font) so html-to-image can
          embed them into the exported PNG/PDF. React hoists these to <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Playfair+Display:ital,wght@1,700&display=swap"
        rel="stylesheet"
      />

      {/* Card preview */}
      <div>
        <div className="mb-3 inline-flex rounded-lg border border-line bg-white p-0.5 text-[12px]">
          {(["front", "back"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)}
              className={`rounded-md px-3 py-1 font-medium ${side === s ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {t(s)}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-line shadow-sm" style={{ width: W * DISPLAY_SCALE, height: H * DISPLAY_SCALE, overflow: "hidden" }}>
          <div style={{ transform: `scale(${DISPLAY_SCALE})`, transformOrigin: "top left", position: "relative", width: W, height: H }}>
            {/* FRONT — always rendered (this exact node is captured for PNG/PDF) */}
            <div ref={frontRef} style={{ width: W, height: H, position: "relative", backgroundImage: `url(${FRONT})`, backgroundSize: "cover", fontFamily: "Georgia, 'Times New Roman', serif" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO} alt="Enshrine" crossOrigin="anonymous" style={{ position: "absolute", top: 40, left: (W - 540) / 2, width: 540 }} />
              {preview.chineseName && (
                <div style={{ position: "absolute", top: 410, left: 0, right: 0, textAlign: "center", fontFamily: "'Ma Shan Zheng', cursive", fontSize: 38, color: "#1a1f2b" }}>{preview.chineseName}</div>
              )}
              <div style={{ position: "absolute", top: 460, left: 0, right: 0, textAlign: "center", fontFamily: "'Playfair Display', Georgia, serif", fontStyle: "italic", fontWeight: 700, fontSize: 46, color: "#111" }}>{preview.englishName}</div>
              <div style={{ position: "absolute", top: 520, left: 0, right: 0, textAlign: "center", fontSize: 29, color: "#33383f" }}>{preview.title}</div>
              {preview.hp && <div style={{ position: "absolute", top: 560, left: 0, right: 0, textAlign: "center", fontSize: 29, fontWeight: 700, color: "#1a1f2b" }}>HP: {preview.hp}</div>}
              {preview.email && <div style={{ position: "absolute", top: 602, left: 0, right: 0, textAlign: "center", fontStyle: "italic", fontSize: 26, color: "#222" }}>Email: {preview.email}</div>}
              <div style={{ position: "absolute", top: 875, left: 60, fontSize: 32, color: "#1a1f2b", lineHeight: 1.25 }}>{ADDRESS[0]}<br />{ADDRESS[1]}</div>
              <div style={{ position: "absolute", top: 978, left: 60, fontStyle: "italic", fontSize: 20, color: "#1a1f2b" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}><span style={socialCircle}><Globe size={13} color="#fff" /></span> {WEB}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ ...socialCircle, fontFamily: "Georgia, serif", fontStyle: "normal", fontWeight: 700, fontSize: 15, color: "#fff" }}>f</span> {FB}</div>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.qrDataUrl} alt="QR" style={{ position: "absolute", left: 508, top: 944, width: 112, height: 112 }} />
            </div>

            {/* BACK — static artwork, overlaid on top of the front when selected */}
            {side === "back" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={BACK} alt="Services" style={{ position: "absolute", inset: 0, width: W, height: H }} />
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button onClick={downloadPdf} disabled={busy}>{busy ? t("preparing") : t("downloadPdf")}</Button>
          <Button variant="secondary" onClick={downloadPng} disabled={busy}>{t("downloadImage")}</Button>
        </div>
      </div>

      {/* Editor */}
      {editable && (
        <Card className="h-fit max-w-sm p-5">
          <h2 className="mb-4 font-display text-[16px] text-ink">{t("editTitle")}</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cn">{t("chineseName")}</Label>
              <Input id="cn" value={chineseName} onChange={(e) => setChineseName(e.target.value)} placeholder="张三" />
            </div>
            <div>
              <Label htmlFor="ct">{t("cardTitle")}</Label>
              <Input id="ct" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} />
              <p className="mt-1 text-[12px] text-muted-2">{t("cardTitleHint")}</p>
            </div>
            <Button onClick={save} disabled={pending}>{pending ? t("saving") : t("save")}</Button>
            {saved && <p className="text-[13px] text-success">{t("saved")}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}
