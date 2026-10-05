// Minimal vCard 3.0 builder for an associate's digital name card.
export type CardContact = {
  fullName: string;
  businessName?: string | null;
  title?: string | null;
  mobile?: string | null;
  email?: string | null;
  associateCode?: string | null;
};

function esc(v: string): string {
  // Escape structural chars first, then fold every line ending (\n, \r\n, or a
  // bare \r) to the vCard line-continuation escape — a lone \r left unescaped
  // would otherwise break the line (B-8 architect review, Low note 1).
  return v.replace(/([,;\\])/g, "\\$1").replace(/\r\n?|\n/g, "\\n");
}

export function buildVCard(c: CardContact): string {
  // The owner: a card (and the vCard a client saves from it) should show the
  // name they trade under when they have one, their legal name otherwise —
  // not both. Same substitution the visible card makes
  // (components/name-card/studio.tsx's englishName), applied once here so
  // every call site stays consistent with no per-site logic.
  const displayName = c.businessName || c.fullName;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(displayName)}`,
    `N:${esc(displayName)};;;;`,
    // businessName now holds a PERSON's trading name, not a company — it must
    // never appear as this vCard's ORG, or a client who scans the QR would
    // read it as the person's organisation. Unconditional, no interpolation.
    "ORG:Enshrine",
  ];
  if (c.title) lines.push(`TITLE:${esc(c.title)}`);
  if (c.mobile) lines.push(`TEL;TYPE=CELL:${esc(c.mobile)}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(c.email)}`);
  lines.push(`NOTE:${esc(`Enshrine Associate${c.associateCode ? ` ${c.associateCode}` : ""}`)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}
