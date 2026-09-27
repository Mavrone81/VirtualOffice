// A-0b's server bound (lib/schemas.ts saleSchema) accepts 1–24 instalments.
export const INSTALLMENT_MONTHS = Array.from({ length: 24 }, (_, i) => i + 1);
