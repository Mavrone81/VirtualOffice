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
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(c.fullName)}`,
    `N:${esc(c.fullName)};;;;`,
    `ORG:${esc(c.businessName ? `Enshrine · ${c.businessName}` : "Enshrine")}`,
  ];
  if (c.title) lines.push(`TITLE:${esc(c.title)}`);
  if (c.mobile) lines.push(`TEL;TYPE=CELL:${esc(c.mobile)}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(c.email)}`);
  lines.push(`NOTE:${esc(`Enshrine Associate${c.associateCode ? ` ${c.associateCode}` : ""}`)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}
