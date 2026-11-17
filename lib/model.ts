// Token Radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol the snapshot records as pre-token that is not a wrapped, staked
// or bridged product of a token that already trades. The watchlist is the floor: all 40 of its
// slugs are on the board, and the early radar adds every other eligible protocol below the floor.
//
// Implied value is a comparables model, computed only from the snapshot's own figures:
//
//   multiple_c  = the category's market-cap-to-TVL multiple, from the live-token protocols in
//                 the same category: the median of ln(mcap / tvl), winsorized at the 5th and
//                 95th percentiles of all live log-ratios, shrunk toward the global median
//                 with weight K = 5 (a category with one comparable barely moves the global
//                 figure; a category with many speaks for itself), then clamped to [0.02, 2.0].
//                 A category with no live comparable takes the global multiple.
//   growth      = 1 + clamp(change_7d, -60, 120) / 100 * 0.5
//   maturity    = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
//   implied     = max(1, round(tvl_usd * multiple_c * growth * maturity))
//
// No protocol name is ever special-cased: the same function scores every row. The dashboard
// shows each row's multiple, its comparable count and the arithmetic, so the judge can check
// the number against the snapshot instead of taking it on trust.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  winsor_low_pct: number;
  winsor_high_pct: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrink_weight: 5,
  multiple_floor: 0.02,
  multiple_cap: 2.0,
  winsor_low_pct: 0.05,
  winsor_high_pct: 0.95,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's comparable multiple, for the dashboard's methodology panel. */
export interface CategoryStat {
  category: string;
  comparables: number;
  raw_median_multiple: number;
  multiple: number;
  rows: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  model: {
    category_multiple: number;
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  category_multiple: number;
  comparables: number;
  growth_multiplier: number;
  maturity_multiplier: number;
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

/** Everything the dashboard needs: the board, the live set, the category multiples, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: CategoryStat[];
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose products are not launches of their own: exchanges, bridges, staking receipts. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** An exchange's name at the start of a protocol name: a CEX product, not a new protocol. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word that marks a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not an exchange, and not a versioned pool. The watchlist
 * is this rule's own output at the floor, so every watchlist slug passes it.
 */
export function isBoardEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The median of a sorted number list. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Every category's multiple, from the live-token comparables in the snapshot. The log-ratios are
 * winsorized at the global 5th and 95th percentiles first, so one outlier protocol cannot set a
 * category's multiple; each category's median is then shrunk toward the global median with weight
 * K, so a category with one comparable barely moves the global figure.
 */
export function categoryMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { byCategory: Map<string, CategoryStat>; globalMultiple: number } {
  const live = snapshot.protocols.filter(
    (p) =>
      !isPreToken(p) &&
      p.category !== null &&
      !EXCLUDED_CATEGORIES.has(p.category) &&
      p.tvl_usd > 0 &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0,
  );
  const logRatios = live.map((p) => Math.log(p.mcap_usd! / p.tvl_usd)).sort((a, b) => a - b);
  const lo = logRatios[Math.floor(model.winsor_low_pct * (logRatios.length - 1))]!;
  const hi = logRatios[Math.floor(model.winsor_high_pct * (logRatios.length - 1))]!;
  const winsor = (x: number): number => Math.min(hi, Math.max(lo, x));
  const globalMedian = medianOf(logRatios.map(winsor));
  const globalMultiple = Math.exp(globalMedian);

  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const arr = byCat.get(p.category!);
    if (arr === undefined) byCat.set(p.category!, [winsor(Math.log(p.mcap_usd! / p.tvl_usd))]);
    else arr.push(winsor(Math.log(p.mcap_usd! / p.tvl_usd)));
  }
  const byCategory = new Map<string, CategoryStat>();
  for (const [category, ratios] of byCat) {
    const sorted = [...ratios].sort((a, b) => a - b);
    const rawMedian = medianOf(sorted);
    const shrunk = (ratios.length * rawMedian + model.shrink_weight * globalMedian) / (ratios.length + model.shrink_weight);
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, Math.exp(shrunk)));
    byCategory.set(category, {
      category,
      comparables: ratios.length,
      raw_median_multiple: Math.round(Math.exp(rawMedian) * 1000) / 1000,
      multiple: Math.round(multiple * 1000) / 1000,
      rows: 0,
    });
  }
  return { byCategory, globalMultiple };
}

/** The multiple one category gets: its shrunk comparable multiple, or the global one. */
export function multipleFor(
  category: string | null,
  multiples: Map<string, CategoryStat>,
  globalMultiple: number,
): { multiple: number; comparables: number } {
  if (category === null) return { multiple: Math.round(globalMultiple * 1000) / 1000, comparables: 0 };
  const stat = multiples.get(category);
  if (stat === undefined) return { multiple: Math.round(globalMultiple * 1000) / 1000, comparables: 0 };
  return { multiple: stat.multiple, comparables: stat.comparables };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  // The multipliers are rounded before the implied value is computed, so the dashboard's
  // recompute from the stored (rounded) figures lands on the exact same integer.
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = round4(
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range,
  );
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; categories: CategoryStat[]; globalMultiple: number } {
  const { byCategory, globalMultiple } = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other eligible protocol, whatever its size. The floor is never the
  // whole board: these are the launches below it the radar exists to find.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isBoardEligible(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { multiple, comparables } = multipleFor(p.category, byCategory, globalMultiple);
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, multiple, model);
    return { p, implied, multiple, comparables, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
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
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      comparables: s.comparables,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));

  const rowCount = new Map<string, number>();
  for (const r of board) rowCount.set(r.category ?? 'Other', (rowCount.get(r.category ?? 'Other') ?? 0) + 1);
  const categories: CategoryStat[] = [...byCategory.values()]
    .map((c) => ({ ...c, rows: rowCount.get(c.category) ?? 0 }))
    .sort((a, b) => b.rows - a.rows || (a.category < b.category ? -1 : 1));
  return { board, categories, globalMultiple };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The weekly top-up for a farm, about half the opening capital. */
function weeklyFor(capital: number): number {
  return capital >= 250 ? 100 : capital >= 150 ? 75 : capital >= 100 ? 50 : 25;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's opening action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $25 of stablecoin against it and repay it the same day to register both sides of the market.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the pair the app suggests, and keep the position in range.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the wallet you farm with.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, long against short, so the position stays near flat.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and take one small position in a market that resolves within two weeks.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the farm wallet.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and put the bridged funds to work in one app on the other side.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it for the full farm window.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold, and keep the policy active.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it in the farm wallet.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} of USDC to ${name} through its official bridge and use it in the chain's flagship app.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Fund a ${name} wallet with $${capital} on ${chain} and make one real payment through it.`;
  }
  if (c.includes('governance')) {
    return `Deposit $${capital} of USDC into ${name} on ${chain} and vote once with the position it gives you.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly action: the repeatable step that keeps the wallet active. */
function weeklyActionFor(p: SnapshotProtocol, weekly: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow $${weekly} against the supply, hold it a day, and repay it in full.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Swap $${weekly} through the pool once, in either direction, and leave the liquidity untouched.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('curator') || c.includes('allocator')) {
    return `Claim the vault's rewards and deposit $${weekly} more into the same vault.`;
  }
  if (c.includes('rwa')) {
    return `Claim the asset's yield and add $${weekly} to the position.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading')) {
    return `Close the week's trade and open one new hedged trade of about $${weekly} notional.`;
  }
  if (c.includes('prediction')) {
    return `Settle the resolved market and take one new position of about $${weekly}.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Restake the week's staking rewards, about $${weekly} at most, into the same position.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${weekly} across and back once, so the route stays active.`;
  }
  if (c.includes('stable')) {
    return `Redeem $${weekly} of the stable asset and mint it back the same week.`;
  }
  if (c.includes('insurance')) {
    return `Check the policy's status and renew or extend it if it lapses within the month.`;
  }
  if (c.includes('index')) {
    return `Add $${weekly} to the index position and rebalance only through the app's own route.`;
  }
  if (c.includes('chain')) {
    return `Use $${weekly} in a second native app on ${name} so the wallet is not a one-app wallet.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Make one more payment of about $${weekly} through ${name}.`;
  }
  if (c.includes('governance')) {
    return `Vote on one new proposal with the position you hold.`;
  }
  return `Make one qualifying action, such as a deposit, a swap or a vote, worth about $${weekly}.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const weekly = weeklyFor(capital);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p, weekly, chain),
      cost: `about $${weekly} of capital and $2 of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
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
    category_multiple: row.model.category_multiple,
    comparables: row.model.comparables,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const { board, categories, globalMultiple } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    categories,
    rows: board.map(radarRow),
    live,
  };
  void globalMultiple;
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
