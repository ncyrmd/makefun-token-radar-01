// Token Radar's scoring model, radar-4: sealed snapshot in, ranked board out.
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
// be worth if it launches, times how likely this category is to launch one.
//
//   expected = round( tvl_usd x categoryMultiple
//                    x (1 + clamp(change_7d - categoryMedianChange, -60, 120) / 100 x 0.5)
//                    x (0.6 + min(age_days, 1095) / 1095 x 0.4)
//                    x (1 + 0.02 x min(chains - 1, 10))
//                    x (0.4 + 0.6 x launchPrior) )
//
// Every factor is calibrated from the snapshot itself, never from a typed-in
// constant, and no protocol name is ever special-cased: one function scores
// every row.
//
// The two new factors in radar-4:
//
// * Launch prior. For each category, the share of its protocols that record
//   a token in this snapshot, shrunk toward the global share with ten
//   pseudo-counts so a thin category cannot claim a 0% or 100% prior from a
//   handful of rows. A category whose protocols almost always have tokens is
//   a category that launches; one whose protocols almost never do is a
//   category that waits. The prior is dampened (0.4 + 0.6 x prior) because a
//   category base rate is a prior, not a per-protocol verdict: the youngest
//   categories have the lowest rates partly because they are young. The
//   dashboard prints the whole prior table with the protocol counts behind
//   each prior, so a reader can see where every number came from.
//
// * Relative momentum. A protocol's seven-day change is measured against its
//   own category's median change, not against zero: the snapshot's week was a
//   down week for almost every category, so a protocol holding flat while its
//   category fell 8% is gaining share, and one rising 2% in a flat category
//   is just riding the tide. The category median needs five readings, else
//   the global median stands in. The detail view shows the raw change and
//   the category median beside the relative figure, so the derivation is
//   visible per row.
//
// The older factors are unchanged in shape. The multiple is the median
// market-cap-to-TVL ratio of the category's live-token protocols in this same
// snapshot (five or more live protocols required); a thin category falls back
// to the global median. Growth is clamped so one wild week cannot decide a
// rank. Maturity rewards a protocol that has run a long time with no token:
// the longer it has waited, the more pent-up the launch. Breadth rewards
// distribution: a protocol live on more chains reaches more farmers.

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

/** The model's tunable constants, as the dashboard states them. */
export interface Tuning {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  min_live_for_category: number;
  min_values_for_median: number;
  prior_shrink: number;
  likelihood_floor: number;
  likelihood_weight: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const TUNING: Tuning = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 10,
  min_live_for_category: 5,
  min_values_for_median: 5,
  prior_shrink: 10,
  likelihood_floor: 0.4,
  likelihood_weight: 0.6,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many categories the priors table shows: the ones with the most pre-token rows. */
export const PRIOR_TABLE_ROWS = 12;

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

/** The calibration: one factor row per category that appears, plus the global fallbacks. */
export interface Calibration {
  global_multiple: number;
  global_live_count: number;
  global_token_rate: number;
  global_median_change: number;
  categories: CategoryFactor[];
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
  model: {
    category_multiple: number;
    category_calibrated: boolean;
    raw_change_pct: number;
    category_median_change_pct: number;
    relative_growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    launch_prior: number;
    launch_likelihood: number;
    raw_implied_value_usd: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page derives the farm plan from it. */
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
  maturity_multiplier: number;
  breadth_multiplier: number;
  launch_prior: number;
  launch_likelihood: number;
  raw_implied_value_usd: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
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
function finiteOr(value: unknown, fallback: number): number {
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
function medianOf(values: number[]): number {
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
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a product of a token that already trades, never a launch of their own. */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchanges whose name at the start of a protocol's name marks it as their product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  for (const exchange of EXCHANGE_PREFIXES) if (p.name.startsWith(exchange)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, not a derivative product, not a versioned pool. */
export function isScoreable(p: SnapshotProtocol): boolean {
  return hasNoToken(p) && !isDerivativeProduct(p) && !VERSIONED_NAME.test(p.name);
}

/**
 * The calibration: for every category, its multiple (the median
 * market-cap-to-TVL ratio of its live-token protocols, five or more required,
 * else the global median), its launch prior (the share of its protocols that
 * record a token, shrunk toward the global share with ten pseudo-counts),
 * and its median weekly change (five or more readings required, else the
 * global median). Computed from this snapshot, never typed in.
 */
export function calibrateRadar(snapshot: Snapshot, tuning: Tuning = TUNING): Calibration {
  const live = snapshot.protocols.filter(
    (p) => !hasNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && (p.category === null || !DERIVATIVE_CATEGORIES.has(p.category)),
  );
  const globalMultiple = medianOf(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const globalTokenRate = snapshot.protocols.length === 0 ? 0 : snapshot.protocols.filter((p) => !hasNoToken(p)).length / snapshot.protocols.length;
  const withChange = snapshot.protocols.filter((p) => p.change_7d !== null).map((p) => p.change_7d!);
  const globalMedianChange = medianOf(withChange);
  const clampMultiple = (v: number): number => Math.min(tuning.multiple_cap, Math.max(tuning.multiple_floor, v));

  const byCategory = new Map<string, { ratios: number[]; protocols: number; withToken: number; preToken: number; changes: number[] }>();
  const bucket = (category: string): { ratios: number[]; protocols: number; withToken: number; preToken: number; changes: number[] } => {
    let b = byCategory.get(category);
    if (b === undefined) {
      b = { ratios: [], protocols: 0, withToken: 0, preToken: 0, changes: [] };
      byCategory.set(category, b);
    }
    return b;
  };
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    const b = bucket(key);
    b.protocols += 1;
    if (hasNoToken(p)) b.preToken += 1;
    else b.withToken += 1;
    if (p.change_7d !== null) b.changes.push(p.change_7d);
  }
  for (const p of live) {
    bucket(p.category ?? 'Other').ratios.push(p.mcap_usd! / p.tvl_usd);
  }
  const categories: CategoryFactor[] = [...byCategory.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([category, b]) => {
      const calibrated = b.ratios.length >= tuning.min_live_for_category;
      const prior = (b.withToken + tuning.prior_shrink * globalTokenRate) / (b.protocols + tuning.prior_shrink);
      const medianChange = b.changes.length >= tuning.min_values_for_median ? medianOf(b.changes) : globalMedianChange;
      return {
        category,
        multiple: clampMultiple(calibrated ? medianOf(b.ratios) : globalMultiple),
        multiple_calibrated: calibrated,
        live_count: b.ratios.length,
        prior: round4(prior),
        protocols: b.protocols,
        with_token: b.withToken,
        pre_token: b.preToken,
        median_change: round4(medianChange),
        change_values: b.changes.length,
      };
    });
  return {
    global_multiple: clampMultiple(globalMultiple),
    global_live_count: live.length,
    global_token_rate: round4(globalTokenRate),
    global_median_change: round4(globalMedianChange),
    categories,
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
  maturityMult: number;
  breadthMult: number;
  prior: number;
  likelihood: number;
  age: number | null;
} {
  const factor = factorForCategory(protocol.category, calibration);
  const age = daysSince(asOf, protocol.listed_at);
  const rawChange = finiteOr(protocol.change_7d, 0);
  const relativeGrowth = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, rawChange - factor.median_change));
  const growthMult = 1 + (relativeGrowth / 100) * tuning.growth_weight;
  const ageForModel = age ?? tuning.unknown_age_days;
  const maturityMult = tuning.maturity_floor + (Math.min(Math.max(ageForModel, 0), tuning.maturity_days) / tuning.maturity_days) * tuning.maturity_range;
  const breadthMult = 1 + tuning.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), tuning.breadth_max_chains);
  const likelihood = tuning.likelihood_floor + tuning.likelihood_weight * factor.prior;
  const raw = Math.max(1, Math.round(protocol.tvl_usd * factor.multiple * growthMult * maturityMult * breadthMult));
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
    maturityMult,
    breadthMult,
    prior: factor.prior,
    likelihood,
    age,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function rankRadar(snapshot: Snapshot, tuning: Tuning = TUNING): BoardRow[] {
  const calibration = calibrateRadar(snapshot, tuning);
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
      category_multiple: round4(s.multiple),
      category_calibrated: s.calibrated,
      raw_change_pct: s.rawChangePct,
      category_median_change_pct: s.categoryMedianChangePct,
      relative_growth_pct: s.relativeGrowthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      launch_prior: s.prior,
      launch_likelihood: round4(s.likelihood),
      raw_implied_value_usd: s.raw,
      age_days: s.age,
    },
    farm_steps: planFarm(s.p, s.age, s.relativeGrowthPct, s.expected).map(formatStep),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
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

/** A board row's compact form for data.js; the farm plan is generated in the page. */
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
    category_multiple: row.model.category_multiple,
    raw_change_pct: row.model.raw_change_pct,
    category_median_change_pct: row.model.category_median_change_pct,
    relative_growth_pct: row.model.relative_growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    launch_prior: row.model.launch_prior,
    launch_likelihood: row.model.launch_likelihood,
    raw_implied_value_usd: row.model.raw_implied_value_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadarData(snapshot: Snapshot, tuning: Tuning = TUNING): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrateRadar(snapshot, tuning);
  const board = rankRadar(snapshot, tuning);
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object at the top level');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json carries no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json carries no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json carries no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json carries no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json carries no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object at all`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is missing a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  return checkCoverage(board, snapshot) ?? checkRanks(board) ?? checkOrder(board) ?? checkSteps(board);
}

/** The board must carry every slug the watchlist names. */
function checkCoverage(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

/** Ranks run 1..n with no gap and no repeat. */
function checkRanks(board: BoardRow[]): string | null {
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  return null;
}

/** Rows are ordered by implied value, and the board actually ranks something. */
function checkOrder(board: BoardRow[]): string | null {
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** Every row carries a plan of 3..12 steps of 20..600 characters and a positive integer value. */
function checkSteps(board: BoardRow[]): string | null {
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataModule(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
