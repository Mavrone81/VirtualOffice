// A-2 — profile card position band. Samuel's decided answer (docs/design/
// a2-profile-band.md, uiux/design-specs): bands are PERCENTILES on
// commission received, not absolute rank cutoffs.
//
// Config, not hard-coded: the thresholds live here as data, so a future
// cutoff change is a RANK_BANDS edit, not a JSX change. Labels themselves
// live in messages/{en,zh-CN}.json under portal.dashboard.band.<id> (DevLead
// review — this app's locales are "en"/"zh-CN", not "en"/"zh", so a plain
// labelEn/labelZh pair here can't dispatch correctly and next-intl already
// owns locale dispatch). The UI renders `t(\`band.${band.id}\`)` — never a
// raw percentile or threshold number.
export type RankBand = { id: string; maxPercentile: number | null };

export const RANK_BANDS: RankBand[] = [
  { id: "top1", maxPercentile: 0.01 },
  { id: "top5", maxPercentile: 0.05 },
  { id: "top10", maxPercentile: 0.10 },
  { id: "top25", maxPercentile: 0.25 },
  { id: "top50", maxPercentile: 0.50 },
  { id: "rest", maxPercentile: null },
];

/** The catch-all band (maxPercentile: null) — used for the zero-received override. */
function restBand(bands: RankBand[]): RankBand {
  return bands.find((b) => b.maxPercentile === null) ?? bands[bands.length - 1];
}

/** First band (walking in the given order) whose maxPercentile admits this percentile. */
function bandForPercentile(percentile: number, bands: RankBand[]): RankBand {
  for (const b of bands) {
    if (b.maxPercentile === null || percentile <= b.maxPercentile) return b;
  }
  return restBand(bands);
}

export type RankInput = { associateId: string; received: number };
export type RankResult = { associateId: string; rank: number; percentile: number; band: RankBand };

/**
 * Rank a population of active associates by commission received this
 * calendar year, and assign each a percentile band.
 *
 * - Basis: `received` per associate (caller supplies this — the ranking
 *   function doesn't know about ledgers/payouts/years, only numbers).
 * - Standard competition ranking ("1224"): tied associates share a rank, so
 *   they always land in the same band together — the percentile comparison
 *   is on the shared rank, not a per-associate tiebreak.
 * - percentile = rank / total (rank 1 = best; smaller percentile = better).
 * - Zero (or negative — shouldn't happen, but never let bad data "beat" the
 *   math) received associates always land in the catch-all band, checked
 *   BEFORE the percentile comparison — not a side effect of it. This can
 *   mean someone "beats" a nominal top band by rank alone but still lands in
 *   the catch-all, by design.
 * - Small populations aren't special-cased: the tighter bands can end up
 *   empty, or the same single associate can satisfy several bands' cutoffs —
 *   the walk-the-list logic just picks the first (tightest) one that fits.
 */
export function rankByCommissionReceived(inputs: RankInput[], bands: RankBand[] = RANK_BANDS): RankResult[] {
  const total = inputs.length;
  if (total === 0) return [];

  const sorted = [...inputs].sort((a, b) => b.received - a.received);
  const results: RankResult[] = [];
  let rank = 0;
  let prevReceived: number | null = null;

  sorted.forEach((item, i) => {
    if (prevReceived === null || item.received !== prevReceived) {
      rank = i + 1; // "1224": rank = 1-based position of this tie group's first member
      prevReceived = item.received;
    }
    const percentile = rank / total;
    const band = item.received <= 0 ? restBand(bands) : bandForPercentile(percentile, bands);
    results.push({ associateId: item.associateId, rank, percentile, band });
  });

  return results;
}
