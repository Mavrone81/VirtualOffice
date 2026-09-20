/**
 * The fanned name cards on the sign-in brand panel.
 *
 * One entry per organisation in the group. When an organisation's card artwork
 * is ready, drop the file into /public/namecard/ and set `art` (and `logo` if
 * the design carries one) — nothing else needs to change. Until then the entry
 * renders as a quiet tinted card, so the fan never shows invented branding.
 *
 * Card proportions follow the real print card: 661 x 1075 (portrait).
 */

type OrgCard = {
  /** Organisation the card belongs to. Read by screen readers, not printed on the card. */
  org: string;
  /** Card front artwork under /public. Omit until the design exists. */
  art?: string;
  /** Logo composited on the artwork, as the name-card studio does. */
  logo?: string;
  /** Ground used while the organisation has no artwork yet. */
  ground: string;
};

const ORG_CARDS: OrgCard[] = [
  {
    org: "Enshrine Pets Paradise",
    ground: "linear-gradient(160deg, #24384f 0%, #35506b 55%, #1d2c40 100%)",
  },
  {
    org: "Enshrine Services",
    art: "/namecard/card-front-blank.png",
    logo: "/namecard/enshrine-logo.png",
    ground: "#cfe0f7",
  },
  {
    org: "Enshrine Afterlife Planner",
    ground: "linear-gradient(160deg, #2b2f46 0%, #3d4360 55%, #222537 100%)",
  },
];

/** left ghost, centre (front-most), right ghost */
const PLACEMENT = [
  "-translate-x-[72%] -translate-y-[4%] rotate-[-11deg] scale-[0.88] opacity-70",
  "z-10 rotate-[-1deg]",
  "translate-x-[72%] -translate-y-[4%] rotate-[11deg] scale-[0.88] opacity-70",
];

export function NameCardFan({ caption }: { caption: string }) {
  return (
    <div className="flex flex-col items-center gap-7">
      <div className="relative flex h-[300px] w-full items-center justify-center">
        {ORG_CARDS.map((card, i) => (
          <figure
            key={card.org}
            className={`absolute aspect-[661/1075] w-[166px] overflow-hidden rounded-[11px] shadow-[0_22px_48px_-14px_rgba(0,0,0,0.7)] ring-1 ring-white/12 ${PLACEMENT[i]}`}
            style={card.art ? undefined : { background: card.ground }}
          >
            {card.art ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={card.art} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : null}
            {card.logo ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={card.logo} alt="" className="absolute left-1/2 top-[14%] w-[62%] -translate-x-1/2" />
            ) : null}
            {card.art ? null : (
              <span
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(145deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 42%), radial-gradient(70% 40% at 50% 22%, rgba(216,178,90,0.18) 0%, rgba(216,178,90,0) 70%)",
                }}
              />
            )}
            <figcaption className="sr-only">{card.org}</figcaption>
          </figure>
        ))}
      </div>
      <p className="max-w-[16rem] text-center text-[12.5px] leading-relaxed text-white/45">{caption}</p>
    </div>
  );
}
