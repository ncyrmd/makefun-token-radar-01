// Token Radar's farm plans, radar-4: a concrete plan per protocol.
//
// Every plan is derived from the protocol's own record — its category, its
// chains, its TVL tier, its age, and its relative momentum — never from a
// hand-written list of names. Eight steps for a single-chain protocol, nine
// when it runs on more than one chain: a fresh wallet, a timing call, the
// opening move, a weekly move, a multi-chain move when it applies, a hold, a
// points check, a farm log, and an exit in stages.
//
// The timing step is new in radar-4. It reads the protocol's growth relative
// to its category: a protocol losing share gets a half-stake start and a
// two-week test before the rest goes in; one gaining share gets a "this week"
// call, with the model's expected value beside it; one tracking its category
// gets the standard stake with no timing edge either way.
//
// The weekly move is new in radar-4 too. It is the category's own recurring
// action — supply and borrow for a lender, a swap through the pool for a DEX,
// a small hedge for a perpetuals venue — instead of one generic "do something
// each week" line for every protocol.

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
function leadChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeSize(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction on a chain usually costs, from the chain's name alone. */
function txCost(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $3 to $8 of gas';
  if (c === 'solana') return 'under $0.10 of fees';
  const cheap = ['arbitrum', 'optimism', 'base', 'blast', 'zksync', 'linea', 'scroll', 'mode', 'mantle', 'polygon', 'bsc', 'avalanche', 'fantom', 'gnosis', 'celo', 'starknet', 'manta', 'taiko', 'zora'];
  if (cheap.some((needle) => c.includes(needle))) return 'about $0.10 to $1 of gas';
  return 'about $2 of gas';
}

/** The category's opening move, in the words a farmer can follow. */
function openingMove(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and leave it running.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and leave it working.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and keep holding it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and hold the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and leave it running.`;
  if (c.includes('chain')) return `Use $${capital} of USDC in ${name}'s app on ${chain} and leave it running.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave it running.`;
}

/** The category's recurring weekly move: the action that keeps a position qualifying. */
function weeklyMove(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply and borrow a small amount each week so both sides count.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Swap a small amount through the main pool each week so volume counts as well as TVL.';
  if (c.includes('bridge')) return 'Bridge a small amount each week so the route stays live.';
  if (c.includes('staking') || c.includes('restak')) return 'Claim and restake the week\'s rewards so the position keeps compounding.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Open and close one small hedge each week so the margin account stays warm.';
  if (c.includes('prediction')) return 'Place one small market position each week so the activity stays steady instead of one burst.';
  if (c.includes('curator') || c.includes('allocator')) return 'Rebalance the vault deposit each week so the position keeps moving.';
  if (c.includes('stable')) return 'Mint or redeem a small amount of the stable asset each week so the position keeps moving.';
  if (c.includes('rwa')) return 'Mint a small amount of the yield asset each week and hold it.';
  if (c.includes('insurance')) return 'Check the cover\'s terms each week and renew it before it lapses.';
  if (c.includes('basis')) return 'Check the basis vault\'s funding each week and top up while the rate favours you.';
  if (c.includes('chain')) return 'Use the app once a week — a swap, a vote or a deposit — so the wallet stays warm.';
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * The timing call: what the protocol's growth relative to its category says
 * about when to start, and how much to put in first.
 */
function timingStep(p: SnapshotProtocol, capital: number, relativeGrowthPct: number, expected: number): FarmStep {
  const rel = relativeGrowthPct;
  const money = (n: number): string => `$${n.toLocaleString('en-US')}`;
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
      text: `TVL is growing ${rel.toFixed(1)}% faster than its category — set the position up this week, while the protocol is gaining share; the model puts its expected value at ${money(expected)}.`,
      cost: 'no extra cost, only timing',
      time: 'this week',
    };
  }
  return {
    text: `TVL is tracking its category (${rel >= 0 ? '+' : ''}${rel.toFixed(1)}% relative) — no timing edge either way, so start with the standard stake.`,
    cost: `the standard ${money(capital)} stake`,
    time: '15 minutes to set up',
  };
}

/**
 * A protocol's farm plan: eight or nine steps, each an action with a cost and
 * a time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age, relative growth), never from a hand-written list of names.
 */
export function planFarm(p: SnapshotProtocol, age: number | null, relativeGrowthPct: number, expected: number): FarmStep[] {
  const chain = leadChain(p);
  const capital = stakeSize(p);
  const hold = holdWindow(age);
  const gas = txCost(chain);
  const steps: FarmStep[] = [
    {
      text: `Start from a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    timingStep(p, capital, relativeGrowthPct, expected),
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
      text: `The protocol also runs on ${p.chains.length - 1} other chain${p.chains.length - 1 === 1 ? '' : 's'} — mirror the position on a second chain only after the first qualifies, so activity is recorded on two chains.`,
      cost: `${gas} per chain mirrored`,
      time: '15 minutes a chain',
    });
  }
  steps.push(
    {
      text: `Leave the position open for at least ${hold} days so more than one snapshot counts the activity.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, look at the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction into a farm log so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Unwind in stages: take out a third, wait a day, then take out the rest, keeping enough ${chain === 'its main chain' ? 'native token' : chain} for the exit gas.`,
      cost: gas,
      time: 'two days to exit fully',
    },
  );
  return steps;
}
