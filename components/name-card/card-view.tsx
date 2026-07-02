import { Phone, Mail } from "lucide-react";

export type CardView = {
  name: string;
  title: string;
  business?: string | null;
  mobile?: string | null;
  email?: string | null;
  footer: string;
  qrDataUrl: string;
};

// Presentational digital name card, shared by the portal (associate) and admin
// name-card pages.
export function NameCardView(d: CardView) {
  return (
    <div className="overflow-hidden rounded-2xl bg-ink text-white shadow-sm">
      <div className="flex items-stretch justify-between gap-4 p-7">
        <div className="flex min-w-0 flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 font-display text-base">E</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Enshrine</div>
            </div>
            <h1 className="mt-5 font-display text-[24px] leading-tight">{d.name}</h1>
            <div className="mt-1 text-[13px] text-gold-300">{d.title}</div>
            {d.business && <div className="text-[12px] text-white/50">{d.business}</div>}
          </div>
          <div className="mt-6 space-y-1.5 text-[13px] text-white/75">
            {d.mobile && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 opacity-70" strokeWidth={1.75} />{d.mobile}</div>}
            {d.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 opacity-70" strokeWidth={1.75} />{d.email}</div>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.qrDataUrl} alt="Scan to save contact" className="h-32 w-32 rounded-lg bg-white p-1.5" />
          <div className="mt-2 text-[10px] uppercase tracking-wide text-white/40">Scan to save</div>
        </div>
      </div>
      <div className="border-t border-white/10 px-7 py-3 text-[11px] text-white/40">{d.footer}</div>
    </div>
  );
}
