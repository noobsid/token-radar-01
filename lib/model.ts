// Token Radar model v2: peer-priced implied value, computed only from the snapshot.
//
// Why not rank by raw TVL, and why not one flat multiple for everything?
// The snapshot itself contains the market's answer for protocols that DO
// trade: for every tokenised protocol, mcap_usd / tvl_usd is the multiple
// the market actually pays for one dollar of TVL in that category. A
// lending market and a DEX do not trade at the same multiple, so a flat
// 0.25x misprices both. This model therefore:
//
//   1. groups tokenised protocols by category and takes the MEDIAN
//      mcap/TVL multiple per category (median, not mean: a handful of
//      10x-400x outliers would otherwise drag a whole category);
//   2. shrinks each category median toward the global median IN LOG
//      SPACE with weight n/(n+4), so a category priced by 1-2 peers is
//      trusted far less than one priced by 15 (a single 2.97x peer
//      shrinks to 0.36x, not 0.77x), and clamps the result to
//      [0.02, 1.50] so no single peer can explode a valuation;
//   3. implied = TVL x peer_multiple x growth x maturity x spread,
//      where growth rewards a rising 7d TVL trend, maturity rewards
//      protocols that have operated longer with no token on record,
//      and spread adds at most +10% for distribution across chains.
//
// Every figure is derived from the snapshot's own ten fields. No protocol
// name is special-cased, and the dashboard recomputes each row from the
// same inputs so a reader can audit the number in front of them.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  shrink_k: number;
  peer_min: number;
  peer_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_bonus_per: number;
  chain_bonus_cap: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 4,
  peer_min: 0.02,
  peer_max: 1.5,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_bonus_per: 0.01,
  chain_bonus_cap: 0.1,
};

export const MODEL_VERSION = 'peer-priced-2';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
    peer_multiple: number;
    peer_median: number | null;
    peer_count: number;
    global_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
    confidence: string;
  };
  farm_steps: string[];
}

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
  peer_multiple: number;
  peer_count: number;
  confidence: string;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface CategoryStat {
  category: string;
  peer_count: number;
  peer_median: number;
  peer_multiple: number;
  board_rows: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Peer pricing: what the market pays per TVL dollar, per category. */
export interface PeerTable {
  global_multiple: number;
  byCategory: Map<string, { count: number; median: number; multiple: number }>;
}

export function peerTable(snapshot: Snapshot, model: ModelConstants = MODEL): PeerTable {
  const ratios: number[] = [];
  const perCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0) continue;
    ratios.push(r);
    const key = p.category ?? 'Uncategorised';
    const list = perCat.get(key) ?? [];
    list.push(r);
    perCat.set(key, list);
  }
  const globalRaw = ratios.length > 0 ? median(ratios) : 0.2;
  const clamp = (n: number): number => Math.min(model.peer_max, Math.max(model.peer_min, n));
  const global = clamp(globalRaw);
  const byCategory = new Map<string, { count: number; median: number; multiple: number }>();
  for (const [cat, list] of perCat) {
    const med = median(list);
    // Log-space shrinkage: multiples are ratios, so averaging them
    // arithmetically lets one large peer dominate a thin category.
    const shrunkLog = (list.length * Math.log(med) + model.shrink_k * Math.log(globalRaw)) / (list.length + model.shrink_k);
    byCategory.set(cat, { count: list.length, median: med, multiple: clamp(Math.exp(shrunkLog)) });
  }
  return { global_multiple: global, byCategory };
}

export function confidenceFor(peerCount: number): string {
  if (peerCount >= 8) return 'high';
  if (peerCount >= 4) return 'medium';
  if (peerCount >= 1) return 'low';
  return 'fallback';
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerTable,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null; peerMultiple: number; peerMedian: number | null; peerCount: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, protocol.chains.length - 1);
  const chainMult = 1 + Math.min(model.chain_bonus_cap, extraChains * model.chain_bonus_per);
  const peer = peers.byCategory.get(protocol.category ?? 'Uncategorised');
  const peerMultiple = peer ? peer.multiple : peers.global_multiple;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peerMultiple * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age, peerMultiple, peerMedian: peer ? peer.median : null, peerCount: peer ? peer.count : 0 };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerTable(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, peers, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peerMultiple),
      peer_median: s.peerMedian === null ? null : round4(s.peerMedian),
      peer_count: s.peerCount,
      global_multiple: round4(peers.global_multiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
      confidence: confidenceFor(s.peerCount),
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator')) return `Deposit $${capital} of USDC into a ${name} curated vault on ${chain}, choosing the vault whose strategy and curator record are shown on its own page`;
  if (c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} allocation vault on ${chain} and keep the vault shares in the farming wallet`;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it once so both sides of the market record the wallet`;
  if (c.includes('cdp') || c.includes('collateral')) return `Deposit $${capital} of collateral into ${name} on ${chain} and mint a small position against it, keeping the health factor comfortably above liquidation`;
  if (c.includes('dex')) return `Swap $${capital} of USDC through ${name} on ${chain} and then provide the proceeds to its main liquidity pool`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in one app on the destination chain`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt token in the wallet`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, then close it after a day so volume and open interest both record`;
  if (c.includes('rwa')) return `Mint or buy $${capital} of the ${name} real-world-asset yield token on ${chain} through its own issuance page and hold it`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into the main ${name} yield vault on ${chain} and leave the shares untouched while they accrue`;
  if (c.includes('basis')) return `Open the $${capital} basis position ${name} offers on ${chain} exactly as its own interface presents it, with the hedge leg included`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy NFT as proof`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it instead of swapping out immediately`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in its most liquid market`;
  if (c.includes('chain')) return `Bridge $${capital} to ${chain}, hold a balance there and make one native transaction a week so the wallet is a real ${name} network user`;
  if (c.includes('payment')) return `Route one real payment of about $${capital} through ${name} on ${chain} to a second wallet you control`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its own interface and keep the position open`;
}

function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return `Repeat one small supply or borrow action on ${p.name} each week and check the health factor after every move`;
  if (c.includes('dex')) return `Make one swap a week through ${p.name} on ${chain}, varying the pair so the activity looks like use, not wash volume`;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('yield')) return `Top up the ${p.name} vault by a few dollars each week and claim any points or rewards the vault page shows`;
  if (c.includes('rwa') || c.includes('stable')) return `Hold the position and add a small amount each week on ${chain}; consistency matters more than size for issuer-side snapshots`;
  return `Make one qualifying action on ${p.name} each week, such as a deposit, a swap, a stake or a vote, and never two identical actions back to back`;
}

function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Watch liquidation risk weekly: keep the health factor high and never farm ${p.name} with funds you cannot afford to have locked in a volatile week`;
  if (c.includes('bridge')) return `Split any larger amount across two bridge transactions on different days; bridge contracts are the riskiest step in this plan`;
  if (c.includes('restak') || c.includes('staking')) return `Remember the stake can be slashable and slow to exit; check the unbonding period on ${p.name} before adding more`;
  if (c.includes('rwa')) return `Read the issuer and redemption terms on ${p.name}'s own page before adding more: real-world-asset tokens can have gated or delayed exits`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis')) return `Keep leverage at the minimum the interface allows; funding costs on ${p.name} can quietly eat the value of any future reward`;
  return `Cap the position at the amount in step two until ${p.name} publishes a points or rewards programme; smart-contract risk is the price of farming early`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const multi = p.chains.length > 1 ? ` It runs on ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')}${p.chains.length > 3 ? ' and more' : ''}); start on ${chain} where gas is familiar.` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with ${p.name}, and keep its seed phrase offline.${multi}`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot period, not a single visit`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: riskFor(p),
      cost: 'no fee to review, and it can save the whole position',
      time: '10 minutes a week',
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points, rewards or governance page and claim only from the link it publishes there`,
      cost: 'no fee to check, and never pay anyone to claim for you',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates, the chain and every transaction hash in a farm log so you can prove, repeat or unwind the ${p.name} position later`,
      cost: 'nothing but the log itself',
      time: '5 minutes',
    },
  ];
}

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

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const peers = peerTable(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const catRows = new Map<string, number>();
  for (const r of board) catRows.set(r.category ?? 'Uncategorised', (catRows.get(r.category ?? 'Uncategorised') ?? 0) + 1);
  const categories: CategoryStat[] = [...peers.byCategory.entries()]
    .map(([category, v]) => ({ category, peer_count: v.count, peer_median: round4(v.median), peer_multiple: round4(v.multiple), board_rows: catRows.get(category) ?? 0 }))
    .sort((a, b) => b.peer_multiple - a.peer_multiple);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global_multiple),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    categories,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.model.peer_multiple,
      peer_count: r.model.peer_count,
      confidence: r.model.confidence,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      chain_multiplier: r.model.chain_multiplier,
      watchlist: watch.has(r.slug),
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share the same implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
