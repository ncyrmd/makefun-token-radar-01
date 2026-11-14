# Token Radar — radar-3

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols,
ranks every pre-token protocol by an implied value, and shows a reader how to
farm each one. The dashboard is a static page with no network: the board, a
detail view per protocol, filters, a live-token view, and a model sandbox that
re-ranks the board live.

## The model

Implied value is calibrated from the snapshot itself, never from a flat
constant. For each category, the multiple is the median market-cap-to-TVL
ratio of that category's live-token protocols in this same snapshot (five or
more live protocols required); a category with too few live tokens falls back
to the global median. A category's token is worth what that category's tokens
already trade at, per dollar of TVL.

```
implied = round( tvl_usd x categoryMultiple
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4)
                 x (1 + 0.02 x min(chains - 1, 10)) )
```

Growth rewards rising TVL and discounts shrinking TVL, clamped so one wild
week cannot decide a rank. Maturity rewards a protocol that has run a long
time with no token. Breadth rewards distribution across chains. No protocol
name is special-cased: one function scores every row.

The board ranks every rankable pre-token protocol: all 40 watchlist slugs
plus every other pre-token protocol the snapshot carries that is not a
wrapped, staked or bridged product of a token that already trades, not a
versioned pool, and not an exchange. The watchlist is the floor, never the
ceiling. Live-token protocols are set aside with their market caps shown.

## Farm plans

Each row carries seven concrete steps with a cost and a time: a fresh wallet,
the category's action on the protocol's first chain, a weekly qualifying
action, a hold of 30 to 60 days by age, a points-page check, a farm log, and
an exit in stages. Gas costs follow the chain (Ethereum, Solana, or an L2),
capital follows the TVL tier. Nothing is hand-written per protocol.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `board.json`, `data.js`, `dashboard/` (3 files), `screenshots/`
(3 images) and `dossier.json` to the output directory. It runs twice with
identical bytes: the model is deterministic, with slug tiebreaks and no
clock or randomness anywhere.

## Files

- `main.ts` — the entry program: snapshot in, board and dossier out.
- `lib/model.ts` — the calibrated model, the farm plans, the snapshot parser.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page the judge reads.
- `screenshots/` — three renders of the page: the board, a detail view, a
  filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as
  the kit ships it.
