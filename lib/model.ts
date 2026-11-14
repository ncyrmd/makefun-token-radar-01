// Token Radar's scoring model, radar-5: sealed snapshot in, ranked board out.
//
// The board ranks every protocol the snapshot records with no token that is
// not a derivative of a token that already trades — a wrapped, staked or
// bridged product, a versioned pool, or an exchange's own product is never a
// launch. The watchlist is the floor: all of its slugs are ranked, and the
// radar adds every other rankable protocol the snapshot carries, so the board
// is the whole pre-token universe the data can see rather than a hand-picked
// top twenty.
//
// The ranked number is an EXPECTED value, not a raw one: what the token would
// be worth if it launches, times how likely this protocol is to launch one.
//
//   expected = round( tvl_usd x categoryMultiple
//                    x (1 + clamp(change_7d - categoryMedianChange, -60, 120) / 100 x 0.5)
//                    x (1 + 0.02 x min(chains - 1, 10))
//                    x min(1, 0.3 + 0.7 x launchPrior x ageFactor) )
//
// Every factor is calibrated from the snapshot itself, never from a typed-in
// constant, and no protocol name is ever special-cased: one function scores
// every row.
//
// What changed in radar-5: the likelihood is now two-way. Radar-4 asked only
// "how often does this category launch?" and let age enter the raw value as a
// straight ramp (0.6 at listing, 1.0 after three years). The snapshot says
// age is a launch signal in its own right, and a much stronger one than the
// ramp assumed: protocols listed under six months ago record a token 26% of
// the time, while protocols listed over three years ago record one 79% of the
// time, and the gap survives inside the big categories (for protocols over
// $100M TVL the rate still climbs 44% -> 70% from the youngest bucket to the
// oldest). So age now multiplies the category prior directly, through a
// bucket factor measured from this snapshot and shrunk toward the global rate
// with ten pseudo-counts, the same shrinkage the category prior already uses.
// The combined rate is capped at 1 before dampening: a likelihood is a
// probability, and seven old Lending and Dexs rows reach the cap. Rows whose
// listing date the snapshot does not carry get a neutral factor of 1.0 — the
// unknown-age bucket's 77% rate looks like unrecorded old listings, so the
// model does not credit an age it cannot measure.
//
// Two signals were tested against the snapshot and dropped, and the model
// section of the dashboard says so, with the numbers:
//
// * Size tiers are flat. Token rates by TVL tier run 52% -> 52% -> 55% ->
//   59% -> 66% -> 56% from the smallest tier to the largest: size per se
//   does not predict a launch, so no size-tier prior was added.
// * Category share is weak and confounded. A protocol's share of its
//   category's TVL moves the token rate only a little (47% in the bottom
//   decile, 67% in the top), and the movement tracks TVL itself, so it adds
//   nothing the TVL term does not already carry.
// * Raw seven-day change is confounded. In this snapshot's down week the
//   protocols whose TVL fell hardest record tokens MORE often (59.8% for a
//   fall over 10%, 22.9% for a rise of 2-10%): the week punishes young
//   categories hardest, so a raw change term would reward the wrong rows.
//   Momentum stays category-relative, as radar-4 had it.
//
// The older factors are unchanged in shape. The multiple is the median
// market-cap-to-TVL ratio of the category's live-token protocols in this same
// snapshot (five or more live protocols required); a thin category falls back
// to the global median. Growth is clamped so one wild week cannot decide a
// rank. Breadth rewards distribution: a protocol live on more chains reaches
// more farmers. The farm plans still come from lib/plans.ts, unchanged.

import { formatStep, planFarm } from './plans.ts';

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants, as the dashboard states them. Change one
 * in the sandbox and the board re-ranks live; the board itself always ships
 * with the constants below. */
export interface Tuning {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  min_live_for_category: number;
  min_values_for_median: number;
  prior_shrink: number;
  age_shrink: number;
  age_factor_floor: number;
  age_factor_cap: number;
  likelihood_floor: number;
  likelihood_weight: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const TUNING: Tuning = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  breadth_per_chain: 0.02,
  breadth_max_chains: 10,
  min_live_for_category: 5,
  min_values_for_median: 5,
  prior_shrink: 10,
  age_shrink: 10,
  age_factor_floor: 0.5,
  age_factor_cap: 1.45,
  likelihood_floor: 0.3,
  likelihood_weight: 0.7,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many categories the priors table shows: the ones with the most pre-token rows. */
export const PRIOR_TABLE_ROWS = 12;

/** One row's model breakdown: every factor the score is built from, so the dashboard can show the derivation. */
export interface ModelBreakdown {
  category_multiple: number;
  category_calibrated: boolean;
  raw_change_pct: number;
  category_median_change_pct: number;
  relative_growth_pct: number;
  growth_multiplier: number;
  age_factor: number;
  age_bucket: string;
  breadth_multiplier: number;
  launch_prior: number;
  launch_likelihood: number;
  raw_implied_value_usd: number;
  age_days: number | null;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  scope: 'watchlist' | 'off-list';
  model: ModelBreakdown;
  farm_steps: string[];
}

/** A board row's compact form for data.js: the farm plan is generated in the page, so only the model's inputs travel. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  scope: 'watchlist' | 'off-list';
  category_multiple: number;
  raw_change_pct: number;
  category_median_change_pct: number;
  relative_growth_pct: number;
  growth_multiplier: number;
  age_factor: number;
  age_bucket: string;
  breadth_multiplier: number;
  launch_prior: number;
  launch_likelihood: number;
  raw_implied_value_usd: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. The Live token view lists the largest 24 by market cap. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs in one object: the board, the live set, the calibration and the model that scored them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tuning;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/**
 * One age bucket of the launch calibration: the token rate among protocols
 * first listed that long ago, shrunk toward the global rate, and the factor
 * that rate implies. The bucket edges are whole days since listing.
 */
export interface AgeBucket {
  label: string;
  min_days: number;
  max_days: number | null;
  protocols: number;
  with_token: number;
  rate: number;
  shrunk_rate: number;
  factor: number;
}

/** The edges of the five age buckets, in days since listing. */
export const AGE_BUCKET_EDGES = [180, 365, 730, 1095];

/** The label each age bucket carries in the dashboard's model section. */
export function ageBucketLabel(minDays: number, maxDays: number | null): string {
  if (maxDays === null) return 'over 3 years';
  if (minDays === 0) return 'under 6 months';
  if (minDays === 180) return '6-12 months';
  if (minDays === 365) return '1-2 years';
  return '2-3 years';
}

/** One category's calibrated factors: its multiple, its launch prior, its median weekly change. */
export interface CategoryFactor {
  category: string;
  multiple: number;
  multiple_calibrated: boolean;
  live_count: number;
  prior: number;
  protocols: number;
  with_token: number;
  pre_token: number;
  median_change: number;
  change_values: number;
}

/** The calibration: one factor row per category that appears, the age buckets, plus the global fallbacks. */
export interface Calibration {
  global_multiple: number;
  global_live_count: number;
  global_token_rate: number;
  global_median_change: number;
  categories: CategoryFactor[];
  age_buckets: AgeBucket[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finiteNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(listed)) return null;
  return Math.max(0, Math.floor((start - listed) / DAY_MS));
}

/** The median of a list of numbers; 0 when the list is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
}

/** Whether a protocol's record carries no token at all. */
export function hasNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED_NAME_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a product of a token that already trades, never a launch of their own. */
const DERIVATIVE_CATEGORIES_SET = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchanges whose name at the start of a protocol's name marks it as their product. */
const EXCHANGE_NAME_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES_SET.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  for (const exchange of EXCHANGE_NAME_PREFIXES) if (p.name.startsWith(exchange)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, not a derivative product, not a versioned pool. */
export function isScoreable(p: SnapshotProtocol): boolean {
  return hasNoToken(p) && !isDerivativeProduct(p) && !VERSIONED_NAME_RE.test(p.name);
}

/** Which age bucket a day count falls in: the first edge it sits under, or the open-ended last bucket. */
function bucketIndexForAge(ageDays: number): number {
  for (let i = 0; i < AGE_BUCKET_EDGES.length; i++) {
    if (ageDays < AGE_BUCKET_EDGES[i]!) return i;
  }
  return AGE_BUCKET_EDGES.length;
}

/**
 * The age calibration: for each bucket, the share of its protocols that
 * record a token, shrunk toward the global share with `age_shrink`
 * pseudo-counts, and the factor that shrunk rate implies against the global
 * rate, clamped so one thin bucket cannot swing a likelihood by more than
 * the cap allows. Protocols with no listing date are left out of the buckets
 * entirely: their rate is not a measurement of any age.
 */
export function calibrateAgeBuckets(snapshot: Snapshot, globalTokenRate: number, tuning: Tuning = TUNING): AgeBucket[] {
  const counts = AGE_BUCKET_EDGES.map(() => ({ protocols: 0, withToken: 0 }));
  counts.push({ protocols: 0, withToken: 0 });
  for (const p of snapshot.protocols) {
    const age = daysSince(snapshot.as_of, p.listed_at);
    if (age === null) continue;
    const slot = counts[bucketIndexForAge(age)]!;
    slot.protocols += 1;
    if (!hasNoToken(p)) slot.withToken += 1;
  }
  return counts.map((slot, i) => {
    const minDays = i === 0 ? 0 : AGE_BUCKET_EDGES[i - 1]!;
    const maxDays = i < AGE_BUCKET_EDGES.length ? AGE_BUCKET_EDGES[i]! : null;
    const rawRate = slot.protocols === 0 ? globalTokenRate : slot.withToken / slot.protocols;
    const shrunk = (slot.withToken + tuning.age_shrink * globalTokenRate) / (slot.protocols + tuning.age_shrink);
    const factor =
      globalTokenRate <= 0
        ? 1
        : Math.min(tuning.age_factor_cap, Math.max(tuning.age_factor_floor, shrunk / globalTokenRate));
    return {
      label: ageBucketLabel(minDays, maxDays),
      min_days: minDays,
      max_days: maxDays,
      protocols: slot.protocols,
      with_token: slot.withToken,
      rate: round4(rawRate),
      shrunk_rate: round4(shrunk),
      factor: round4(factor),
    };
  });
}

/**
 * The category calibration: for every category, its multiple (the median
 * market-cap-to-TVL ratio of its live-token protocols, five or more required,
 * else the global median), its launch prior (the share of its protocols that
 * record a token, shrunk toward the global share with ten pseudo-counts),
 * and its median weekly change (five or more readings required, else the
 * global median). Computed from this snapshot, never typed in.
 */
export function calibrateCategories(
  snapshot: Snapshot,
  live: SnapshotProtocol[],
  globalMultiple: number,
  globalTokenRate: number,
  globalMedianChange: number,
  tuning: Tuning = TUNING,
): CategoryFactor[] {
  const clampMultiple = (v: number): number => Math.min(tuning.multiple_cap, Math.max(tuning.multiple_floor, v));
  const byCategory = new Map<string, { ratios: number[]; protocols: number; withToken: number; preToken: number; changes: number[] }>();
  const bucket = (category: string): { ratios: number[]; protocols: number; withToken: number; preToken: number; changes: number[] } => {
    let found = byCategory.get(category);
    if (found === undefined) {
      found = { ratios: [], protocols: 0, withToken: 0, preToken: 0, changes: [] };
      byCategory.set(category, found);
    }
    return found;
  };
  for (const p of snapshot.protocols) {
    const slot = bucket(p.category ?? 'Other');
    slot.protocols += 1;
    if (hasNoToken(p)) slot.preToken += 1;
    else slot.withToken += 1;
    if (p.change_7d !== null) slot.changes.push(p.change_7d);
  }
  for (const p of live) {
    bucket(p.category ?? 'Other').ratios.push(p.mcap_usd! / p.tvl_usd);
  }
  return [...byCategory.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([category, slot]) => {
      const calibrated = slot.ratios.length >= tuning.min_live_for_category;
      const prior = (slot.withToken + tuning.prior_shrink * globalTokenRate) / (slot.protocols + tuning.prior_shrink);
      const medianChange = slot.changes.length >= tuning.min_values_for_median ? median(slot.changes) : globalMedianChange;
      return {
        category,
        multiple: clampMultiple(calibrated ? median(slot.ratios) : globalMultiple),
        multiple_calibrated: calibrated,
        live_count: slot.ratios.length,
        prior: round4(prior),
        protocols: slot.protocols,
        with_token: slot.withToken,
        pre_token: slot.preToken,
        median_change: round4(medianChange),
        change_values: slot.changes.length,
      };
    });
}

/** The full calibration: the globals, the category factors, and the age buckets, all from this snapshot. */
export function calibrateRadar(snapshot: Snapshot, tuning: Tuning = TUNING): Calibration {
  const live = snapshot.protocols.filter(
    (p) => !hasNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && (p.category === null || !DERIVATIVE_CATEGORIES_SET.has(p.category)),
  );
  const globalMultiple = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const globalTokenRate = snapshot.protocols.length === 0 ? 0 : snapshot.protocols.filter((p) => !hasNoToken(p)).length / snapshot.protocols.length;
  const withChange = snapshot.protocols.filter((p) => p.change_7d !== null).map((p) => p.change_7d!);
  const globalMedianChange = median(withChange);
  const clampMultiple = (v: number): number => Math.min(tuning.multiple_cap, Math.max(tuning.multiple_floor, v));
  return {
    global_multiple: clampMultiple(globalMultiple),
    global_live_count: live.length,
    global_token_rate: round4(globalTokenRate),
    global_median_change: round4(globalMedianChange),
    categories: calibrateCategories(snapshot, live, globalMultiple, globalTokenRate, globalMedianChange, tuning),
    age_buckets: calibrateAgeBuckets(snapshot, globalTokenRate, tuning),
  };
}

/** The factor row one category gets under a calibration, with the global fallbacks. */
export function factorForCategory(category: string | null, calibration: Calibration): CategoryFactor {
  const row = calibration.categories.find((c) => c.category === (category ?? 'Other'));
  if (row !== undefined) return row;
  return {
    category: category ?? 'Other',
    multiple: calibration.global_multiple,
    multiple_calibrated: false,
    live_count: 0,
    prior: calibration.global_token_rate,
    protocols: 0,
    with_token: 0,
    pre_token: 0,
    median_change: calibration.global_median_change,
    change_values: 0,
  };
}

/**
 * A protocol's age factor under a calibration: the factor of the bucket its
 * listing age falls in, or 1.0 when the snapshot carries no listing date.
 * An unmeasured age is never credited: the factor stays neutral.
 */
export function ageFactorFor(ageDays: number | null, calibration: Calibration): { factor: number; bucket: string } {
  if (ageDays === null) return { factor: 1, bucket: 'unknown' };
  const slot = calibration.age_buckets[bucketIndexForAge(ageDays)];
  if (slot === undefined) return { factor: 1, bucket: 'unknown' };
  return { factor: slot.factor, bucket: slot.label };
}

/** The multipliers and the expected value one protocol gets under `tuning` and `calibration`. */
export function scoreRow(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  tuning: Tuning,
): {
  expected: number;
  raw: number;
  multiple: number;
  calibrated: boolean;
  rawChangePct: number;
  categoryMedianChangePct: number;
  relativeGrowthPct: number;
  growthMult: number;
  ageFactor: number;
  ageBucket: string;
  breadthMult: number;
  prior: number;
  likelihood: number;
  age: number | null;
} {
  const factor = factorForCategory(protocol.category, calibration);
  const age = daysSince(asOf, protocol.listed_at);
  const rawChange = finiteNum(protocol.change_7d, 0);
  const relativeGrowth = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, rawChange - factor.median_change));
  const growthMult = 1 + (relativeGrowth / 100) * tuning.growth_weight;
  const { factor: ageFactor, bucket: ageBucket } = ageFactorFor(age, calibration);
  const breadthMult = 1 + tuning.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), tuning.breadth_max_chains);
  // Two-way likelihood: how often the category launches, times how often
  // protocols of this age launch, dampened because a base rate is a prior,
  // not a per-protocol verdict, and capped at 1 because a likelihood is a
  // probability. On this snapshot the cap binds for seven old Lending and
  // Dexs rows and no others.
  const combined = Math.min(1, factor.prior * ageFactor);
  const likelihood = tuning.likelihood_floor + tuning.likelihood_weight * combined;
  const raw = Math.max(1, Math.round(protocol.tvl_usd * factor.multiple * growthMult * breadthMult));
  const expected = Math.max(1, Math.round(raw * likelihood));
  return {
    expected,
    raw,
    multiple: factor.multiple,
    calibrated: factor.multiple_calibrated,
    rawChangePct: rawChange,
    categoryMedianChangePct: factor.median_change,
    relativeGrowthPct: round4(relativeGrowth),
    growthMult,
    ageFactor,
    ageBucket,
    breadthMult,
    prior: factor.prior,
    likelihood,
    age,
  };
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n. The
 * calibration is passed in so it is computed once per snapshot, not once per
 * ranking pass.
 */
export function rankRadar(snapshot: Snapshot, calibration: Calibration, tuning: Tuning = TUNING): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => isScoreable(p))
    .map((p) => ({ p, ...scoreRow(p, snapshot.as_of, calibration, tuning) }));
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.expected,
    scope: (watchlist.has(s.p.slug) ? 'watchlist' : 'off-list') as 'watchlist' | 'off-list',
    model: {
      raw_implied_value_usd: s.raw,
      launch_likelihood: round4(s.likelihood),
      launch_prior: s.prior,
      age_factor: round4(s.ageFactor),
      age_bucket: s.ageBucket,
      age_days: s.age,
      breadth_multiplier: round4(s.breadthMult),
      growth_multiplier: round4(s.growthMult),
      relative_growth_pct: s.relativeGrowthPct,
      category_median_change_pct: s.categoryMedianChangePct,
      raw_change_pct: s.rawChangePct,
      category_multiple: round4(s.multiple),
      category_calibrated: s.calibrated,
    },
    farm_steps: planFarm(s.p, s.age, s.relativeGrowthPct, s.expected, s.likelihood).map(formatStep),
  }));
}

/** The live-token protocols for the dashboard's Live token view: the largest by market cap, CEX products left out. */
export function liveSet(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row shrunk for data.js: the page rebuilds the farm plan from the row's own figures, so the plan text does not travel twice. */
export function compactRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    scope: row.scope,
    raw_implied_value_usd: row.model.raw_implied_value_usd,
    launch_likelihood: row.model.launch_likelihood,
    launch_prior: row.model.launch_prior,
    age_factor: row.model.age_factor,
    age_bucket: row.model.age_bucket,
    breadth_multiplier: row.model.breadth_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    relative_growth_pct: row.model.relative_growth_pct,
    category_median_change_pct: row.model.category_median_change_pct,
    raw_change_pct: row.model.raw_change_pct,
    category_multiple: row.model.category_multiple,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadarData(snapshot: Snapshot, tuning: Tuning = TUNING): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrateRadar(snapshot, tuning);
  const board = rankRadar(snapshot, calibration, tuning);
  const live = liveSet(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: tuning,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.scope === 'off-list').length,
    live_size: live.length,
    rows: board.map(compactRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function readSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json must hold one JSON object');
  const o = raw as Record<string, unknown>;
  const needString = (key: string): string => {
    if (typeof o[key] !== 'string') throw new SnapshotError(`snapshot.json has no ${key} string`);
    return o[key] as string;
  };
  const asOf = needString('as_of');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('snapshot.json carries an as_of that is not a date');
  const source = needString('source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json carries no usable floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json carries no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json carries no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object at all`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is missing a slug, a name or a TVL`);
    }
    const pickNumber = (key: string): number | null =>
      typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : null;
    const pickString = (key: string): string | null => (typeof p[key] === 'string' ? (p[key] as string) : null);
    return {
      slug: p.slug,
      name: p.name,
      category: pickString('category'),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: pickNumber('change_7d'),
      mcap_usd: pickNumber('mcap_usd'),
      listed_at: pickString('listed_at'),
      gecko_id: pickString('gecko_id'),
      symbol: pickString('symbol'),
    };
  });
  return {
    as_of: asOf,
    source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  return checkCoverage(board, snapshot) ?? checkOrder(board) ?? checkRanks(board) ?? checkSteps(board);
}

/** Rows are ordered by implied value, and the board actually ranks something. */
function checkOrder(board: BoardRow[]): string | null {
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** Ranks run 1..n with no gap and no repeat. */
function checkRanks(board: BoardRow[]): string | null {
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} came out as ${ranks[i]}`;
  return null;
}

/** The board must carry every slug the watchlist names. */
function checkCoverage(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board leaves out ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

/** Every row carries a plan of 3..12 steps of 20..600 characters and a positive integer value. */
function checkSteps(board: BoardRow[]): string | null {
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} carries ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} carries a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} carries implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. The page reads it as window.RADAR. */
export function dataModule(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
