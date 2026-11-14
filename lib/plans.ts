// Token Radar's farm plans, radar-5 with the radar-6 families: one concrete
// plan per protocol, derived from the protocol's own record.
//
// Every plan comes from the protocol's category, its chains, its TVL tier,
// its age, and its relative momentum — never from a hand-written list of
// names. Eight steps for a single-chain protocol, nine when it runs on more
// than one chain: a fresh wallet, a timing call, the opening move, a weekly
// move, a multi-chain move when it applies, a hold, a points check, a farm
// log, and an exit in stages.
//
// The moves are table-driven: each category family names the keywords that
// pick it and the move that follows, so the same table drives the opening
// move and the weekly move and no category is special-cased twice. The
// timing step reads the protocol's growth relative to its category: a
// protocol losing share gets a half-stake start and a two-week test before
// the rest goes in; one gaining share gets a "this week" call, with the
// model's expected value beside it; one tracking its category gets the
// standard stake with no timing edge either way. The launch likelihood sits
// in the gaining and tracking calls, with the years the protocol has waited
// with no token — the age factor is part of the likelihood now, so the plan
// says so where it matters.
//
// The weekly move is the category's own recurring action — supply and borrow
// for a lender, a swap through the pool for a DEX, a small hedge for a
// perpetuals venue — instead of one generic "do something each week" line
// for every protocol.
//
// Radar-6 adds nine more families — payments, OTC marketplaces, CeDeFi,
// farms, liquidity managers, governance incentives, anchor BTC, card
// issuers, and decentralised BTC — so that no row on this board falls
// through to the generic move any more: the two top-40 rows that used to
// (Lightning Network at 17, Figure Markets Exchange at 33) and the seven
// other fallback categories below the top 40 all get a move of their own.
// The new families sit after the basis family and before the catch-all
// 'chain' family, and in an order that keeps the older families winning
// where they already do: 'anchor' ahead of 'btc' so Anchor BTC keeps its
// own move, and 'farm' behind the dex family so Leveraged Farming still
// opens as a DEX move.

import type { SnapshotProtocol } from './model.ts';

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
export function formatStep(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction on a chain usually costs, from the chain's name alone. */
function feeFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $3 to $8 of gas';
  if (c === 'solana') return 'under $0.10 of fees';
  const cheap = ['arbitrum', 'optimism', 'base', 'blast', 'zksync', 'linea', 'scroll', 'mode', 'mantle', 'polygon', 'bsc', 'avalanche', 'fantom', 'gnosis', 'celo', 'starknet', 'manta', 'taiko', 'zora'];
  if (cheap.some((needle) => c.includes(needle))) return 'about $0.10 to $1 of gas';
  return 'about $2 of gas';
}

/** How long the protocol has waited with no token, in words a reader can follow. */
function waitedFor(age: number | null): string {
  if (age === null) return 'an unlisted time';
  if (age >= 365) return `${(age / 365).toFixed(1)} years`;
  return `${age} days`;
}

/**
 * The category families and their opening moves, in the order they are
 * tried: the first family whose keyword appears in the category wins. The
 * last family matches any category with 'chain' in it, and the fallback
 * below the table covers the rest.
 */
type Opener = (name: string, capital: number, chain: string) => string;
const OPENERS: { keys: string[]; line: Opener }[] = [
  { keys: ['lend', 'cdp', 'collateral'], line: (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} and leave it running.` },
  { keys: ['dex', 'yield', 'leveraged farm'], line: (n, c, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and leave it working.` },
  { keys: ['bridge'], line: (n, c, ch) => `Bridge $${c} of USDC to ${ch} through ${n} and use the bridged funds in its app.` },
  { keys: ['staking', 'restak'], line: (n, c, ch) => `Stake $${c} of the chain's staking asset through ${n} and keep the receipt.` },
  { keys: ['perpetual', 'derivative'], line: (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} and open one small hedge.` },
  { keys: ['prediction'], line: (n, c, ch) => `Fund $${c} and place one market position on ${n}.` },
  { keys: ['curator', 'allocator'], line: (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the shares.` },
  { keys: ['stable'], line: (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch}.` },
  { keys: ['rwa'], line: (n, c, ch) => `Mint $${c} of the protocol's yield asset on ${ch} and keep holding it.` },
  { keys: ['insurance'], line: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and hold the policy.` },
  { keys: ['basis'], line: (n, c, ch) => `Deposit $${c} of USDC into ${n}'s basis vault on ${ch} and leave it running.` },
  { keys: ['payment'], line: (n, c, ch) => `Open a payment channel with $${c} through ${n} on ${ch} and route a first payment through it.` },
  { keys: ['otc'], line: (n, c, ch) => `List $${c} of USDC for an OTC trade on ${n} on ${ch} and leave the order working.` },
  { keys: ['cedefi'], line: (n, c, ch) => `Deposit $${c} of USDC into ${n}'s managed vault on ${ch} and leave it earning.` },
  { keys: ['farm'], line: (n, c, ch) => `Deposit $${c} of USDC into ${n}'s farm on ${ch} and leave it working.` },
  { keys: ['liquidity manager'], line: (n, c, ch) => `Deposit $${c} of USDC into the managed liquidity position of ${n} on ${ch} and leave it working.` },
  { keys: ['governance'], line: (n, c, ch) => `Deposit $${c} of USDC into ${n}'s incentive pool on ${ch} and keep the position staked.` },
  { keys: ['anchor'], line: (n, c, ch) => `Mint $${c} of ${n}'s BTC-backed asset on ${ch} and hold it.` },
  { keys: ['card'], line: (n, c, ch) => `Load $${c} onto a ${n} card on ${ch} and spend a small amount to activate it.` },
  { keys: ['btc'], line: (n, c, ch) => `Deposit $${c} of BTC into ${n} on ${ch} and keep the wrapped position.` },
  { keys: ['chain'], line: (n, c, ch) => `Use $${c} of USDC in ${n}'s app on ${ch} and leave it running.` },
];

/** The category's opening move, in the words a farmer can follow. */
function openingMove(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const entry of OPENERS) {
    if (entry.keys.some((key) => c.includes(key))) return entry.line(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and leave it running.`;
}

/**
 * The category families and their recurring weekly moves, in the same order
 * as the openers: the first family whose keyword appears in the category
 * wins.
 */
const WEEKLIES: { keys: string[]; line: string }[] = [
  { keys: ['lend', 'cdp', 'collateral'], line: 'Supply and borrow a small amount each week so both sides count.' },
  { keys: ['dex', 'yield', 'leveraged farm'], line: 'Swap a small amount through the main pool each week so volume counts as well as TVL.' },
  { keys: ['bridge'], line: 'Bridge a small amount each week so the route stays live.' },
  { keys: ['staking', 'restak'], line: 'Claim and restake the week\'s rewards so the position keeps compounding.' },
  { keys: ['perpetual', 'derivative'], line: 'Open and close one small hedge each week so the margin account stays warm.' },
  { keys: ['prediction'], line: 'Place one small market position each week so the activity stays steady instead of one burst.' },
  { keys: ['curator', 'allocator'], line: 'Rebalance the vault deposit each week so the position keeps moving.' },
  { keys: ['stable'], line: 'Mint or redeem a small amount of the stable asset each week so the position keeps moving.' },
  { keys: ['rwa'], line: 'Mint a small amount of the yield asset each week and hold it.' },
  { keys: ['insurance'], line: 'Check the cover\'s terms each week and renew it before it lapses.' },
  { keys: ['basis'], line: 'Check the basis vault\'s funding each week and top up while the rate favours you.' },
  { keys: ['payment'], line: 'Route a small payment each week so the channel stays active.' },
  { keys: ['otc'], line: 'Refresh the OTC listing each week so the order stays visible.' },
  { keys: ['cedefi'], line: 'Check the managed vault\'s yield each week and top up while the rate favours you.' },
  { keys: ['farm'], line: 'Harvest the farm\'s rewards each week and re-deposit them so the position compounds.' },
  { keys: ['liquidity manager'], line: 'Rebalance the managed position each week so the range stays in the market.' },
  { keys: ['governance'], line: 'Vote on one proposal each week so the governance activity stays steady.' },
  { keys: ['anchor'], line: 'Check the peg each week and top up the collateral while it holds.' },
  { keys: ['card'], line: 'Spend a small amount on the card each week so the account stays active.' },
  { keys: ['btc'], line: 'Check the wrapped position each week and move it only when the peg slips.' },
  { keys: ['chain'], line: 'Use the app once a week — a swap, a vote or a deposit — so the wallet stays warm.' },
];

/** The category's recurring weekly move: the action that keeps a position qualifying. */
function weeklyMove(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  for (const entry of WEEKLIES) {
    if (entry.keys.some((key) => c.includes(key))) return entry.line;
  }
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * The timing call: what the protocol's growth relative to its category says
 * about when to start, and how much to put in first. A protocol gaining
 * share gets a "this week" call with the model's expected value and its
 * launch likelihood beside it — the likelihood carries the age factor now,
 * so the call names the years the protocol has waited with no token.
 */
function timingStep(
  p: SnapshotProtocol,
  capital: number,
  relativeGrowthPct: number,
  expected: number,
  likelihood: number,
  age: number | null,
): FarmStep {
  const rel = relativeGrowthPct;
  const money = (n: number): string => `$${n.toLocaleString('en-US')}`;
  const likely = `${Math.round(likelihood * 100)}% launch likelihood after ${waitedFor(age)} with no token`;
  if (rel <= -5) {
    const half = Math.max(25, Math.round(capital / 2));
    return {
      text: `TVL is falling ${Math.abs(rel).toFixed(1)}% against its category — start with half the capital (${money(half)}) and add the rest only after the position holds for two weeks.`,
      cost: `${money(half)} now, ${money(capital - half)} later`,
      time: 'two weeks to size up',
    };
  }
  if (rel >= 5) {
    return {
      text: `TVL is growing ${rel.toFixed(1)}% faster than its category — set the position up this week, while the protocol is gaining share; the model puts its expected value at ${money(expected)} on a ${likely}.`,
      cost: 'no extra cost, only timing',
      time: 'this week',
    };
  }
  return {
    text: `TVL is tracking its category (${rel >= 0 ? '+' : ''}${rel.toFixed(1)}% relative) — no timing edge either way, so start with the standard stake; the model puts it at a ${likely}.`,
    cost: `the standard ${money(capital)} stake`,
    time: '15 minutes to set up',
  };
}

/**
 * A protocol's farm plan: eight or nine steps, each an action with a cost and
 * a time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age, relative growth, launch likelihood), never from a
 * hand-written list of names.
 */
export function planFarm(
  p: SnapshotProtocol,
  age: number | null,
  relativeGrowthPct: number,
  expected: number,
  likelihood: number,
): FarmStep[] {
  const chain = firstChain(p);
  const capital = stakeFor(p);
  const hold = holdFor(age);
  const gas = feeFor(chain);
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    timingStep(p, capital, relativeGrowthPct, expected, likelihood, age),
    {
      text: openingMove(p, capital, chain),
      cost: `$${capital} of capital and ${gas} for the first transaction`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyMove(p),
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
  ];
  if (p.chains.length > 1) {
    steps.push({
      text: `The protocol also runs on ${p.chains.length - 1} other chain${p.chains.length - 1 === 1 ? '' : 's'} — copy the position to a second chain only after the first one qualifies, so the activity lands on two chains.`,
      cost: `${gas} per chain mirrored`,
      time: '15 minutes a chain',
    });
  }
  steps.push(
    {
      text: `Keep the position open for at least ${hold} days so more than one snapshot counts the activity.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Exit in stages: take out a third, wait a day, then take out the rest, keeping enough ${chain === 'its main chain' ? 'native token' : chain} for the exit gas.`,
      cost: gas,
      time: 'two days to exit fully',
    },
  );
  return steps;
}
