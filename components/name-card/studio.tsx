"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { updateNameCard, updateAssociateNameCard } from "@/server/name-card/actions";
import { NAME_CARD_CHINESE_NAME_MAX, NAME_CARD_CUSTOM_TITLE_MAX } from "@/lib/name-card-limits";

const FRONT = "/namecard/card-front-blank.png";
const BACK = "/namecard/card-back.jpg";
const LOGO = "/namecard/enshrine-logo.png";
const ADDRESS = ["74 Lorong 6 Geylang", "Singapore 399226"];
// C-1 (owner ruling, VO_Website_Changes_-_Additional.pdf p.1): the domain changed to .com.sg.
const WEB = "www.enshrine.com.sg";
const FB = "www.facebook.com/enshrinefuneralservices";
// C-1: Designation/Contact/Email are explicitly Times New Roman per the spec — the
// parent's Georgia-first stack (line ~142) would otherwise win wherever Georgia is
// available, which isn't the font the owner's p.1 spec asked for.
//
// Tinos first, not 'Times New Roman' itself: Android ships neither Times New
// Roman nor Liberation Serif (its serif is Noto Serif, a different typeface
// with different metrics), so without a self-hosted face every Android render
// of this card silently used the wrong font — same latent-fidelity shape as
// the fonts-matcher fix, just for rendered pixels instead of an HTTP redirect.
// Tinos is Google's metric-compatible clone of Times New Roman (self-hosted
// below, SIL Open Font License 1.1 — same license as Liberation Serif itself,
// not the licensing distinction an earlier note assumed existed between them).
// Putting it first means every platform rasterizes the same face instead of
// whatever the device happens to have, trading "sometimes the device's own
// real Times New Roman" for "always this one" — deliberate, since consistency
// across platforms is the point.
const TIMES_NEW_ROMAN = "'Tinos', 'Times New Roman', Georgia, serif";
// C-1: Trattatello (the owner's original pick) is an Apple system font with no
// web/server embedding licence (Q4) — approved substitute is Alex Brush, SIL
// Open Font License 1.1 (self-hosted below, licence bundled alongside the font
// file at public/fonts/alex-brush/OFL.txt per the licence's own requirement
// that it travel with the font).
const ALEX_BRUSH = "'Alex Brush', cursive";
const W = 661, H = 1075, DISPLAY_SCALE = 0.5;
// Card-face typography the owner tunes by eye against a printed reference. Kept
// here as named constants so the next nudge is a number change, not a hunt
// through inline styles. All three are in card px (W = 661), NOT display px —
// the preview is drawn at DISPLAY_SCALE but exports at full size.
const NAME_STROKE = 0.9; // outline painted around the name's glyphs; see the note at its use
const TITLE_SHIFT = 40;  // designation, px right of centre
const HP_SHIFT = 40;     // mobile, px left of centre

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

export function NameCardStudio({
  data, editable, canEditTitle = false, associateId, lastEditedBy,
}: {
  data: CardData;
  editable: boolean;
  canEditTitle?: boolean;
  // B-8: when set, this is an admin editing ANOTHER associate's card — saves
  // go through the audited admin action instead of the self-service one.
  associateId?: string;
  lastEditedBy?: { name: string; date: string } | null;
}) {
  const t = useTranslations("nameCard");
  const router = useRouter();
  const frontRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"front" | "back">("front");
  const [busy, setBusy] = useState(false);

  // editor state
  const [pending, start] = useTransition();
  const [chineseName, setChineseName] = useState(data.chineseName);
  const [customTitle, setCustomTitle] = useState(data.title);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    start(async () => {
      const payload = {
        chineseName: editable ? chineseName : undefined,
        customTitle: canEditTitle ? customTitle : undefined,
      };
      const r = associateId ? await updateAssociateNameCard(associateId, payload) : await updateNameCard(payload);
      if (!r.ok) {
        setError(r.error ?? null);
        return;
      }
      setSaved(true);
      // Admin-edit-any: re-fetch the server-rendered "last edited by" line.
      if (associateId) router.refresh();
      setTimeout(() => setSaved(false), 2000);
    });
  }

  // live-preview values reflect the editor immediately
  const preview: CardData = { ...data, chineseName, title: customTitle || data.title };

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      {/* Display fonts loaded via <link>/<style> (not next/font) so html-to-image
          can embed them into the exported PNG/PDF. React hoists these to <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap"
        rel="stylesheet"
      />
      {/* C-1: Alex Brush is self-hosted (not a Google Fonts <link>) so its SIL
          OFL licence file can be bundled alongside the font it covers, in the
          same public/ directory — see public/fonts/alex-brush/OFL.txt. */}
      <style>{`
        @font-face {
          font-family: 'Alex Brush';
          src: url('/fonts/alex-brush/AlexBrush-Regular.ttf') format('truetype');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
      `}</style>
      {/* Tinos, same self-hosting reason as Alex Brush (SIL OFL licence file
          bundled alongside — public/fonts/tinos/OFL.txt). Only the two faces
          actually used below: italic (title, email) and bold (HP) — no plain
          upright face is ever requested, so none is shipped. */}
      <style>{`
        @font-face {
          font-family: 'Tinos';
          src: url('/fonts/tinos/Tinos-Italic.woff2') format('woff2');
          font-weight: 400;
          font-style: italic;
          font-display: swap;
        }
        @font-face {
          font-family: 'Tinos';
          src: url('/fonts/tinos/Tinos-Bold.woff2') format('woff2');
          font-weight: 700;
          font-style: normal;
          font-display: swap;
        }
      `}</style>

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
              {/* The owner asked for the name in bold (2026-10-07), then for MORE bold after
                  seeing it (same day) — hence the paint-based thickening rather than a higher
                  font-weight. Alex Brush ships ONE file (AlexBrush-Regular.ttf, weight 400)
                  and has no bold face, so font-weight can only ever ask the browser to
                  synthesise one. Synthetic bold on a cursive face is both too weak to read as
                  bold at 600 and, pushed to 700, closes up the script's loops — and how much
                  it thickens is up to the rasteriser, so the printed PNG need not match the
                  screen. -webkit-text-stroke paints a measured outline around the real
                  glyph outlines instead: the letterforms are unchanged, the amount is
                  explicit in px rather than left to a font-matching heuristic, and it is an
                  ordinary paint operation, so html-to-image's rasterisation reproduces it.
                  Weight stays 400 so the two mechanisms cannot compound.

                  The card exports by rasterising this DOM (html-to-image toPng), so what
                  renders here is exactly what the PNG and the PDF carry — no separate
                  handling is needed in the export path. */}
              <div style={{ position: "absolute", top: 460, left: 0, right: 0, textAlign: "center", fontFamily: ALEX_BRUSH, fontSize: 52, fontWeight: 400, WebkitTextStroke: `${NAME_STROKE}px #111`, color: "#111" }}>{preview.englishName}</div>
              {/* Designation sits right of centre and the mobile left of it, matching the
                  reference card the owner supplied (2026-10-07). Padding, not a transform:
                  the box still spans the full width and still centres its text, so the shift
                  survives a long designation (it re-centres within the narrowed box instead
                  of overflowing one edge), and it is plain box model that rasterises
                  identically in the PNG export. NOTE the factor of two — padding narrows the
                  box from one side only, so the CENTRE moves by half the padding. The
                  constants below are the intended centre shift; the doubling happens here. */}
              <div style={{ position: "absolute", top: 520, left: 0, right: 0, paddingLeft: TITLE_SHIFT * 2, textAlign: "center", fontFamily: TIMES_NEW_ROMAN, fontStyle: "italic", fontSize: 29, color: "#33383f" }}>{preview.title}</div>
              {preview.hp && <div style={{ position: "absolute", top: 560, left: 0, right: 0, paddingRight: HP_SHIFT * 2, textAlign: "center", fontFamily: TIMES_NEW_ROMAN, fontSize: 29, fontWeight: 700, color: "#1a1f2b" }}>HP: {preview.hp}</div>}
              {preview.email && <div style={{ position: "absolute", top: 602, left: 0, right: 0, textAlign: "center", fontFamily: TIMES_NEW_ROMAN, fontStyle: "italic", fontSize: 26, color: "#222" }}>Email: {preview.email}</div>}
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
      {(editable || canEditTitle) && (
        <Card className="h-fit max-w-sm p-5">
          <h2 className="mb-4 font-display text-[16px] text-ink">{t("editTitle")}</h2>
          <div className="space-y-4">
            {editable && (
              <div>
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="cn">{t("chineseName")}</Label>
                  <span className="text-[11px] text-muted-2">{chineseName.length}/{NAME_CARD_CHINESE_NAME_MAX}</span>
                </div>
                <Input id="cn" value={chineseName} maxLength={NAME_CARD_CHINESE_NAME_MAX} onChange={(e) => setChineseName(e.target.value)} placeholder="中文名" />
              </div>
            )}
            {canEditTitle && (
              <div>
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="ct">{t("cardTitle")}</Label>
                  <span className="text-[11px] text-muted-2">{customTitle.length}/{NAME_CARD_CUSTOM_TITLE_MAX}</span>
                </div>
                <Input id="ct" value={customTitle} maxLength={NAME_CARD_CUSTOM_TITLE_MAX} onChange={(e) => setCustomTitle(e.target.value)} />
                <p className="mt-1 text-[12px] text-muted-2">{t("cardTitleHint")}</p>
              </div>
            )}
            <Button onClick={save} disabled={pending}>{pending ? t("saving") : t("save")}</Button>
            {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
            {saved && <p className="text-[13px] text-success">{t("saved")}</p>}
            {lastEditedBy && (
              <p className="text-[12px] text-muted-2">
                {t("lastEditedBy", { admin: lastEditedBy.name, date: lastEditedBy.date })}
              </p>
            )}
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
