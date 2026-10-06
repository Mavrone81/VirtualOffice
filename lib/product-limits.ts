// Product description length cap (owner-requested). Kept in its own tiny
// module — not lib/schemas.ts — so the client forms (app/admin/products/new/
// product-form.tsx, app/admin/products/[id]/edit/edit-product-form.tsx,
// both "use client") can import just this number for a live character
// counter without pulling the whole zod schema module into the client
// bundle. Same reasoning as lib/name-card-limits.ts.
export const PRODUCT_DESCRIPTION_MAX = 500;
