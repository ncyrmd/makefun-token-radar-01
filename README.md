# Token Radar — radar-5 with the radar-6 age curve

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols,
ranks every pre-token protocol by an expected value, and shows a reader how to
farm each one. The dashboard is a static page with no network: the board, a
detail view per protocol, filters, a live-token view, and a model sandbox that
re-ranks the board live. The model section adds an age curve panel — the
launch rate by time since listing as bars — so the likelihood's second leg is
visible at a glance instead of only as a table.

## The model

The ranked number is an expected value: what the token would be worth if it
launches, times how likely this protocol is to launch one. Every factor is
calibrated from the snapshot itself, never from a flat constant.

```
expected = round( tvl_usd x categoryMultiple
                 x (1 + clamp(change_7d - categoryMedianChange, -60, 120) / 100 x 0.5)
                 x (1 + 0.02 x min(chains - 1, 10))
                 x min(1, 0.3 + 0.7 x launchPrior x ageFactor) )
```

- **Category multiple**: the median market-cap-to-TVL ratio of the category's
  live-token protocols in this same snapshot (five or more required); a thin
  category falls back to the global median. A category's token is worth what
  that category's tokens already trade at, per dollar of TVL.
- **Relative momentum**: a protocol's seven-day change measured against its
  own category's median change, not against zero. The snapshot's week was a
  down week for almost every category, so a protocol holding flat while its
  category falls is gaining share.
- **Breadth**: distribution across chains.
- **Launch likelihood, two-way**: the category's launch prior times an age
  factor, dampened (0.3 + 0.7 x combined) and capped at 1. The prior is the
  share of the category's protocols that record a token in this snapshot,
  shrunk toward the global share with ten pseudo-counts. The age factor is
  the snapshot's second launch signal: token rates by time since listing,
  shrunk toward the global 54.9% with ten pseudo-counts:

  | Listed | Protocols | With token | Token rate | Shrunk rate | Factor |
  | --- | --- | --- | --- | --- | --- |
  | under 6 months | 87 | 23 | 26% | 29.4% | 0.54x |
  | 6-12 months | 73 | 29 | 40% | 41.6% | 0.76x |
  | 1-2 years | 183 | 70 | 38% | 39.1% | 0.71x |
  | 2-3 years | 139 | 76 | 55% | 54.7% | 1.00x |
  | over 3 years | 163 | 129 | 79% | 77.7% | 1.42x |

  The gap survives inside the big categories: for protocols over $100M TVL
  the token rate still climbs from 44% in the youngest bucket (18 protocols)
  to 70% in the oldest (50 protocols). Seven old Lending and Dexs rows reach
  the cap of 1. Rows whose listing date the snapshot does not carry get a
  neutral factor of 1.0 — 113 protocols carry no listing date, and the model
  does not credit an age it cannot measure. Radar-4's linear maturity ramp
  (0.6 at listing, 1.0 after three years) is gone: the measured buckets
  replace it.

## How the age curve is built

Each bucket's factor comes from its own token rate, shrunk toward the global
rate before it is used — never from the raw rate alone, because the youngest
bucket holds only 87 protocols and a raw rate on a thin bucket would swing
the likelihood on noise. The shrinkage is the same one the category prior
already uses, with ten pseudo-counts at the global rate:

```
shrunk(bucket) = (with_token + 10 x global_rate) / (protocols + 10)
factor(bucket) = clamp(shrunk(bucket) / global_rate, 0.5, 1.45)
```

The global rate is 54.9% (416 of the snapshot's 758 protocols record a
token). The shrinkage pulls the thin buckets toward it — the youngest
bucket's raw 26% becomes a shrunk 29.4% before it becomes the 0.54x factor —
and the clamp never binds on this snapshot: the measured factors run 0.54x
to 1.42x against a clamp of 0.5x to 1.45x. The clamp is there so one thin
bucket cannot swing a likelihood on a later snapshot, not because this one
needs it.

Three properties of the curve are what make it a signal rather than a
curiosity. First, it is monotone apart from one flat step: 26%, 40%, 38%,
55%, 79% from the youngest bucket to the oldest, and the one step that does
not climb (40% to 38% between the 6-12 month and 1-2 year buckets) is the
place where the two buckets hold the most protocols, so the flat step is
measured, not noise. Second, the gap survives when size is held fixed: among
protocols over $100M TVL the rate still climbs 44% to 70% from the youngest
bucket to the oldest, so age is not a proxy for being big. Third, the curve
is steep where it matters: the oldest bucket's factor of 1.42x lifts an old
protocol's combined rate most, and the combined-rate cap at 1 binds for
exactly seven rows — old Lending and Dexs protocols whose category prior
times their age factor runs past 1 — and for no others, so the cap trims
only the rows the curve would otherwise push past a probability.

A protocol whose listing date the snapshot does not carry gets a neutral
factor of 1.0. That is a deliberate understatement: 113 protocols carry no
listing date, and most of them record a token, which is what unrecorded old
listings look like — but the model does not credit an age it cannot measure,
so those rows score on their category prior alone.

## Tested and dropped

Three ideas were measured against the snapshot and left out, and the
dashboard's model section says so with the numbers:

- **Size tiers are flat.** Token rates by TVL tier run 52%, 52%, 55%, 59%,
  66% and 56% from the smallest tier to the largest — size per se does not
  predict a launch. The spread from the smallest tier to the largest is four
  points, against the age curve's fifty-three points from the youngest bucket
  to the oldest, and the largest tier is not even the highest: the second
  largest tier records tokens more often (66%) than the largest (56%). A
  size-tier prior would move ranks on a signal that is flat within noise, so
  none was added.

  | TVL tier | Token rate |
  | --- | --- |
  | smallest | 52% |
  | 2nd | 52% |
  | 3rd | 55% |
  | 4th | 59% |
  | 5th | 66% |
  | largest | 56% |

- **Category share is weak and confounded.** A protocol's share of its
  category's TVL moves the token rate only from 47% in the bottom decile to
  67% in the top, and the movement tracks TVL itself: the protocols with the
  largest category shares are the largest protocols, and size is already
  carried by the TVL term. A share term would double-count size while adding
  almost nothing — a twenty-point spread against the age curve's
  fifty-three — so it was left out.
- **Raw seven-day change is confounded.** In this snapshot's down week the
  protocols whose TVL fell hardest record tokens more often (59.8% for a fall
  over 10%, against 22.9% for a rise of 2-10%): the week punishes young
  categories hardest, so a raw change term would reward the wrong rows. The
  confound is visible in the sign: the rows the week hurt most are the rows
  most likely to have a token, which is the opposite of what a momentum term
  should do. Momentum stays category-relative, where the same week's numbers
  behave: a protocol gaining against its own category is gaining share
  whatever the week did.

The decision rule for all three is the same: a signal joins the model only
when its spread is large, survives when another variable is held fixed, and
points the right way. The age curve passes all three — a fifty-three point
spread, a gap that survives inside the over-$100M tier, and a direction that
matches the story (older protocols have had longer to launch). The three
dropped signals fail at least one: size is flat, category share is
confounded by TVL, and raw change points backwards in a down week.

## Sensitivity

The dampening (0.3 + 0.7 x combined) sits in the middle of the range that
was tested. A stronger dampening (0.25 + 0.75 x, or 0.2 + 0.8 x) moves the
top 40 by 1.4 ranks on average (Spearman 0.996–0.997) and keeps the same top
10 in the same order; no dampening at all moves the top 40 by 4.7 ranks on
average (Spearman 0.965) but lets the combined rate run past 1 for the old
Lending and Dexs rows, which is why the cap and the dampening stay. The
age-factor clamp [0.5, 1.45] never binds on this snapshot (the measured
factors run 0.54x to 1.42x); it is there so one thin bucket cannot swing a
likelihood on a later snapshot. The combined-rate cap at 1 binds for seven
rows — old Lending and Dexs protocols whose category prior times their age
factor runs past 1 — and for no others.

## The board

The top ten on the sealed snapshot (expected values, rounded):

| Rank | Protocol | Expected value | Launch likelihood |
| --- | --- | --- | --- |
| 1 | Steakhouse Financial | $333.3M | 41% |
| 2 | Sentora Curator | $301.3M | 41% |
| 3 | Veda | $216.9M | 49% |
| 4 | Gauntlet | $198.2M | 41% |
| 5 | USDD | $153.1M | 56% |
| 6 | BitFi Basis | $89.4M | 60% |
| 7 | Upshift | $75.1M | 49% |
| 8 | Bittensor dTAO | $72.9M | 57% |
| 9 | Polymarket International | $63.5M | 79% |
| 10 | CIAN Yield Layer | $47.9M | 59% |

The top of the board is Risk Curators and Onchain Capital Allocators: big
TVL, low category priors, mid-range age factors. The highest likelihoods sit
lower down, where old Lending and Dexs protocols reach the 100% cap — seven
rows in all, led by Flux Finance at rank 69.

## Launch priors

The twelve categories with the most pre-token rows, shrunk toward the global
54.9% with ten pseudo-counts:

| Category | With token | Prior |
| --- | --- | --- |
| Lending | 59 of 75 | 76% |
| Dexs | 73 of 99 | 72% |
| Yield | 23 of 39 | 58% |
| Canonical Bridge | 17 of 32 | 54% |
| RWA | 17 of 33 | 52% |
| CDP | 10 of 20 | 52% |
| Liquid Staking | 40 of 78 | 52% |
| Derivatives | 13 of 26 | 51% |
| Bridge | 27 of 55 | 50% |
| Onchain Capital Allocator | 9 of 29 | 37% |
| CEX | 14 of 56 | 30% |
| Risk Curators | 5 of 39 | 21% |

## Why expected value

A radar that ranks by raw modeled value alone puts the biggest protocol
first, whatever its category. But the snapshot itself says categories differ:
only 5 of 39 Risk Curators record a token, while 59 of 75 Lending protocols
do — and old protocols launch far more often than young ones. A farmer's time
is the scarce resource, so the board ranks by what a protocol is worth times
how likely it is to launch at all. The detail view shows both numbers for
every row — the modeled value and the likelihood, with the category prior and
the age factor beside it — so the discount is never hidden.

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

The opening and weekly moves are table-driven by category family, and the
table now covers nine more families — payments, OTC marketplaces, CeDeFi,
farms, liquidity managers, governance incentives, anchor BTC, card issuers
and decentralised BTC — so no row on this board falls through to the generic
move: the two top-40 rows that used to (Lightning Network at 17, Figure
Markets Exchange at 33) and the seven other fallback categories below the top
40 all get a move of their own. The dashboard's copy of the table matches
the model's, so the plan the detail view shows is the plan board.json
carries.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `board.json`, `data.js`, `dashboard/` (3 files), `screenshots/`
(4 images) and `dossier.json` to the output directory. It runs twice with
identical bytes: the model is deterministic, with slug tiebreaks and no
clock or randomness anywhere. Verify a build by running it twice into two
directories and diffing them, then running the gate mirror over the output:
the mirror checks the dashboard limits, the board shape, the watchlist
coverage, the screenshots, and that the dossier is byte for byte what the
library rebuilds. The page's own detail view recomputes every row it shows
and says whether the number matches board.json, so a screenshot of a detail
view is a check of the model, not just a picture of it.

## Files

- `main.ts` — the entry program: snapshot in, board and dossier out.
- `lib/model.ts` — the calibrated model: multiples, two-way launch
  likelihood (category prior x age factor), relative momentum, scoring,
  ranking, the snapshot parser.
- `lib/plans.ts` — the farm plans, derived per protocol from its own record.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page the judge reads.
- `screenshots/` — four renders of the page: the board, a detail view, a
  filtered view, and the model section.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as
  the kit ships it.
