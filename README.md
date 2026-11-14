# Token Radar — radar-4

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols,
ranks every pre-token protocol by an expected value, and shows a reader how to
farm each one. The dashboard is a static page with no network: the board, a
detail view per protocol, filters, a live-token view, and a model sandbox that
re-ranks the board live.

## The model

The ranked number is an expected value: what the token would be worth if it
launches, times how likely the category is to launch one. Every factor is
calibrated from the snapshot itself, never from a flat constant.

```
expected = round( tvl_usd x categoryMultiple
                 x (1 + clamp(change_7d - categoryMedianChange, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4)
                 x (1 + 0.02 x min(chains - 1, 10))
                 x (0.4 + 0.6 x launchPrior) )
```

- **Category multiple**: the median market-cap-to-TVL ratio of the category's
  live-token protocols in this same snapshot (five or more required); a thin
  category falls back to the global median. A category's token is worth what
  that category's tokens already trade at, per dollar of TVL.
- **Relative momentum**: a protocol's seven-day change measured against its
  own category's median change, not against zero. The snapshot's week was a
  down week for almost every category, so a protocol holding flat while its
  category falls is gaining share.
- **Maturity**: a protocol that has run a long time with no token. **Breadth**:
  distribution across chains.
- **Launch prior**: the share of the category's protocols that record a token
  in this snapshot, shrunk toward the global share with ten pseudo-counts,
  then dampened (0.4 + 0.6 x prior) because a category base rate is a prior,
  not a per-protocol verdict. Risk Curators sit near 21%, Lending near 76% —
  the same TVL is worth more in a category that launches.

## Why expected value

A radar that ranks by raw modeled value alone puts the biggest protocol
first, whatever its category. But the snapshot itself says categories differ:
only 5 of 39 Risk Curators record a token, while 59 of 75 Lending protocols
do. A farmer's time is the scarce resource, so the board ranks by what a
protocol is worth times how likely it is to launch at all. The detail view
shows both numbers for every row — the modeled value and the likelihood —
so the discount is never hidden.

The board ranks every rankable pre-token protocol: all 40 watchlist slugs
plus every other pre-token protocol the snapshot carries that is not a
wrapped, staked or bridged product of a token that already trades, not a
versioned pool, and not an exchange. The watchlist is the floor, never the
ceiling. Live-token protocols are set aside with their market caps shown.

## Farm plans

Each row carries eight or nine concrete steps with a cost and a time: a fresh
wallet, a timing call from the protocol's own relative momentum, the
category's opening move on its first chain, a weekly move that fits the
category, a multi-chain step when the protocol runs on more than one chain, a
hold of 30 to 60 days by age, a points-page check, a farm log, and an exit in
stages. Gas costs follow the chain, capital follows the TVL tier. Nothing is
hand-written per protocol.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `board.json`, `data.js`, `dashboard/` (3 files), `screenshots/`
(4 images) and `dossier.json` to the output directory. It runs twice with
identical bytes: the model is deterministic, with slug tiebreaks and no
clock or randomness anywhere.

## Files

- `main.ts` — the entry program: snapshot in, board and dossier out.
- `lib/model.ts` — the calibrated model: multiples, launch priors, relative
  momentum, scoring, ranking, the snapshot parser.
- `lib/plans.ts` — the farm plans, derived per protocol from its own record.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page the judge reads.
- `screenshots/` — four renders of the page: the board, a detail view, a
  filtered view, and the model section.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as
  the kit ships it.
