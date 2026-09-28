// A-17 screen 6: the required-document key is generated from the English
// label, never admin-typed (Backend's spec) — so it can't collide by
// accident, and editing a label later can't silently change the key that
// G3 and submission_documents.requirement_key already reference.
function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || "requirement";
}

// Deduped against the product's OWN existing keys only — the same label on
// two different products is fine, since G3 checks each product's list
// independently.
export function generateRequirementKey(labelEn: string, existingKeys: Iterable<string>): string {
  const existing = new Set(existingKeys);
  const base = slugify(labelEn);
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
