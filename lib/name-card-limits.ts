// Name card field length caps (B-8). Kept in their own tiny module — not
// lib/schemas.ts — so the client editor (components/name-card/studio.tsx,
// "use client") can import just these two numbers for maxLength/counters
// without pulling the whole zod schema module into the client bundle.
export const NAME_CARD_CHINESE_NAME_MAX = 20;
export const NAME_CARD_CUSTOM_TITLE_MAX = 60;
