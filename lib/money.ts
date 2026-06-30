import { Prisma } from "@prisma/client";

// Money is always Prisma.Decimal (NUMERIC(14,2)) — never JS float.
// Round half-up to 2dp; residual is pushed into Company Retained by the engine
// so the per-line split always reconciles to the closing commission.
export type Money = Prisma.Decimal;

export type Numeric = Prisma.Decimal | number | string;

export const D = (v: Numeric): Prisma.Decimal => new Prisma.Decimal(v);

export const ZERO = new Prisma.Decimal(0);

/** Round to 2 decimal places, half-up. */
export function round2(v: Numeric): Prisma.Decimal {
  return new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** `amount * percentage%`, rounded to 2dp. */
export function pctOf(amount: Numeric, percentage: Numeric): Prisma.Decimal {
  return round2(D(amount).mul(D(percentage)).div(100));
}

export function sum(values: Numeric[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.add(D(v)), new Prisma.Decimal(0));
}

export function eq(a: Numeric, b: Numeric): boolean {
  return D(a).equals(D(b));
}

/** "1234.5" -> "1,234.50" */
export function formatSGD(v: Numeric): string {
  return (
    "S$" +
    round2(v)
      .toNumber()
      .toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
