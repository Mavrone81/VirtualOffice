import { Prisma } from "@prisma/client";

export type LineRef = { id: string; amount: Prisma.Decimal };

export type NetNegativeDecision = { attach: boolean; note?: string };

export interface NetNegativePolicy {
  name: "hold" | "carry_forward" | "company_absorbs" | "recover";
  decide(ctx: { associateId: string; month: string; net: Prisma.Decimal; lines: LineRef[] }): NetNegativeDecision;
}

export class PolicyNotImplemented extends Error {
  constructor(public readonly policy: string) {
    super(`Net-negative policy "${policy}" is not implemented`);
  }
}

/** M5's existing behaviour: attach anyway, leave the payout Pending (never approved). */
const hold: NetNegativePolicy = {
  name: "hold",
  decide: () => ({ attach: true, note: "non-positive total" }),
};

/** M5-CF §3, the project owner's policy: never attach a non-positive net; the lines wait for the next run. */
const carryForward: NetNegativePolicy = {
  name: "carry_forward",
  decide: () => ({ attach: false }),
};

const companyAbsorbs: NetNegativePolicy = {
  name: "company_absorbs",
  decide: () => {
    throw new PolicyNotImplemented("company_absorbs");
  },
};

const recover: NetNegativePolicy = {
  name: "recover",
  decide: () => {
    throw new PolicyNotImplemented("recover");
  },
};

const POLICIES: Record<string, NetNegativePolicy> = {
  hold, carry_forward: carryForward, company_absorbs: companyAbsorbs, recover,
};

/**
 * Read fresh from `process.env` on every call (not through `lib/env`'s
 * module-load-time singleton) — a run is internally consistent because this is
 * only ever called once per run (§3), not because the value is cached, and a
 * test can flip it with a plain `process.env.PAYOUT_NET_NEGATIVE_POLICY =`
 * assignment before each call, no module reset needed. `lib/env.ts` still
 * validates the var at boot (fails fast on an unrecognised value); this falls
 * back to `hold` for anything it doesn't recognise, same as the boot default.
 */
export function currentNetNegativePolicy(): NetNegativePolicy {
  return POLICIES[process.env.PAYOUT_NET_NEGATIVE_POLICY ?? ""] ?? hold;
}
