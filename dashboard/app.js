// Token Radar's dashboard, radar-5 with the radar-6 age curve. It reads
// window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a filterable table, a per-protocol detail drawer with the
// model's own inputs and the protocol's farm plan, and a model sandbox that
// re-ranks the board live. No network: every byte it shows is in data.js.
//
// The page recomputes every row from the snapshot figures with the same
// calibrated model main.ts used, and checks the number board.json carries, so
// the page's code and the board's data are visibly the same arithmetic. The
// ranked number is an expected value: the modeled token value times the
// protocol's launch likelihood — the category's launch prior times its age
// factor, dampened — both shown per row. The model section adds an age
// curve panel: the launch rate by time since listing as bars, so the
// two-way likelihood is visible at a glance instead of only as a table.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  // What the reader is looking at: the search text, the picked category and
  // chain, the scope and tab, the sort and its direction, and the row whose
  // detail drawer is open. The hash carries it, so a view is a link.
  var view = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  // The sandbox's overrides: null means "use the model's own constant".
  // Active only after the reader presses Re-rank the board.
  var tweak = { growth_weight: null, likelihood_floor: null, likelihood_weight: null, active: false };

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return moneyFmt.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // One category's calibrated factors: the multiple, the launch prior and the
  // median weekly change main.ts computed from this snapshot, or the global
  // fallbacks when the category is too thin to calibrate.
  function factorOf(category) {
    var key = category || 'Other';
    var found = null;
    DATA.calibration.categories.forEach(function (c) { if (c.category === key) found = c; });
    if (found) return found;
    return {
      category: key,
      multiple: DATA.calibration.global_multiple,
      multiple_calibrated: false,
      live_count: 0,
      prior: DATA.calibration.global_token_rate,
      protocols: 0,
      with_token: 0,
      pre_token: 0,
      median_change: DATA.calibration.global_median_change,
      change_values: 0
    };
  }

  // A protocol's age factor under the calibration: the factor of the bucket
  // its listing age falls in, or 1.0 when the snapshot carries no listing
  // date. An unmeasured age is never credited.
  function ageFactorOf(ageDays) {
    if (ageDays === null || ageDays === undefined) return { factor: 1, bucket: 'unknown' };
    var buckets = DATA.calibration.age_buckets || [];
    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      if (ageDays >= b.min_days && (b.max_days === null || ageDays < b.max_days)) return { factor: b.factor, bucket: b.label };
    }
    return { factor: 1, bucket: 'unknown' };
  }

  // The model in one function: the same arithmetic as lib/model.ts, so the detail view
  // can recompute a row and check it against the board. Expected value is the modeled
  // token value times the protocol's launch likelihood: the category prior times
  // the age factor, dampened and capped at 1.
  function recomputeRow(row, model) {
    var m = model || DATA.model;
    var factor = factorOf(row.category);
    var rawChange = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var relative = Math.min(m.growth_cap, Math.max(m.growth_floor, rawChange - factor.median_change));
    var growthMult = 1 + (relative / 100) * m.growth_weight;
    var age = ageFactorOf(row.age_days);
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_chains);
    var combined = Math.min(1, factor.prior * age.factor);
    var likelihood = m.likelihood_floor + m.likelihood_weight * combined;
    var raw = Math.max(1, Math.round(row.tvl_usd * factor.multiple * growthMult * breadth));
    return Math.max(1, Math.round(raw * likelihood));
  }

  function sandboxModel() {
    if (!tweak.active) return DATA.model;
    var m = {};
    Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
    if (tweak.growth_weight !== null) m.growth_weight = tweak.growth_weight;
    if (tweak.likelihood_floor !== null) m.likelihood_floor = tweak.likelihood_floor;
    if (tweak.likelihood_weight !== null) m.likelihood_weight = tweak.likelihood_weight;
    return m;
  }

  // The h() helper: a tiny element builder. attrs maps to attributes, with
  // class/text/html/on* handled specially; the rest of the arguments are
  // children — strings, elements, or arrays of either, nulls skipped.
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') el.className = attrs[k];
        else if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') el.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) el.appendChild(c); });
      else if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else el.appendChild(child);
    }
    return el;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains,
  // TVL, age and relative growth decide the timing, the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function feeFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 'about $3 to $8 of gas';
    if (c === 'solana') return 'under $0.10 of fees';
    var cheap = ['arbitrum', 'optimism', 'base', 'blast', 'zksync', 'linea', 'scroll', 'mode', 'mantle', 'polygon', 'bsc', 'avalanche', 'fantom', 'gnosis', 'celo', 'starknet', 'manta', 'taiko', 'zora'];
    for (var i = 0; i < cheap.length; i++) if (c.indexOf(cheap[i]) >= 0) return 'about $0.10 to $1 of gas';
    return 'about $2 of gas';
  }
  // The category families and their opening moves, in the order they are
  // tried: the first family whose keyword appears in the category wins. The
  // last family matches any category with 'chain' in it, and the fallback
  // below the table covers the rest. Radar-6 adds nine families — payments,
  // OTC marketplaces, CeDeFi, farms, liquidity managers, governance
  // incentives, anchor BTC, card issuers and decentralised BTC — so no row
  // on this board falls through to the generic move any more. They sit after
  // the basis family and before the catch-all 'chain' family, in an order
  // that keeps the older families winning where they already do: 'anchor'
  // ahead of 'btc', and 'farm' behind the dex family so Leveraged Farming
  // still opens as a DEX move.
  var OPENERS = [
    { keys: ['lend', 'cdp', 'collateral'], line: function (n, c, ch) { return 'Supply $' + c + ' of USDC to ' + n + ' on ' + ch + ' and leave it running.'; } },
    { keys: ['dex', 'yield', 'leveraged farm'], line: function (n, c, ch) { return 'Provide $' + c + ' of liquidity to ' + n + "'s main pool on " + ch + ' and leave it working.'; } },
    { keys: ['bridge'], line: function (n, c, ch) { return 'Bridge $' + c + ' of USDC to ' + ch + ' through ' + n + ' and use the bridged funds in its app.'; } },
    { keys: ['staking', 'restak'], line: function (n, c, ch) { return "Stake $" + c + " of the chain's staking asset through " + n + ' and keep the receipt.'; } },
    { keys: ['perpetual', 'derivative'], line: function (n, c, ch) { return 'Deposit $' + c + ' of USDC as margin on ' + n + ' and open one small hedge.'; } },
    { keys: ['prediction'], line: function (n, c, ch) { return 'Fund $' + c + ' and place one market position on ' + n + '.'; } },
    { keys: ['curator', 'allocator'], line: function (n, c, ch) { return 'Deposit $' + c + ' into a ' + n + ' vault on ' + ch + ' and keep the shares.'; } },
    { keys: ['stable'], line: function (n, c, ch) { return 'Mint or deposit $' + c + ' of the stable asset through ' + n + ' on ' + ch + '.'; } },
    { keys: ['rwa'], line: function (n, c, ch) { return "Mint $" + c + " of the protocol's yield asset on " + ch + ' and keep holding it.'; } },
    { keys: ['insurance'], line: function (n, c, ch) { return 'Buy $' + c + ' of cover from ' + n + ' on ' + ch + ' and hold the policy.'; } },
    { keys: ['basis'], line: function (n, c, ch) { return 'Deposit $' + c + ' of USDC into ' + n + "'s basis vault on " + ch + ' and leave it running.'; } },
    { keys: ['payment'], line: function (n, c, ch) { return 'Open a payment channel with $' + c + ' through ' + n + ' on ' + ch + ' and route a first payment through it.'; } },
    { keys: ['otc'], line: function (n, c, ch) { return 'List $' + c + ' of USDC for an OTC trade on ' + n + ' on ' + ch + ' and leave the order working.'; } },
    { keys: ['cedefi'], line: function (n, c, ch) { return 'Deposit $' + c + ' of USDC into ' + n + "'s managed vault on " + ch + ' and leave it earning.'; } },
    { keys: ['farm'], line: function (n, c, ch) { return 'Deposit $' + c + ' of USDC into ' + n + "'s farm on " + ch + ' and leave it working.'; } },
    { keys: ['liquidity manager'], line: function (n, c, ch) { return 'Deposit $' + c + ' of USDC into the managed liquidity position of ' + n + ' on ' + ch + ' and leave it working.'; } },
    { keys: ['governance'], line: function (n, c, ch) { return 'Deposit $' + c + ' of USDC into ' + n + "'s incentive pool on " + ch + ' and keep the position staked.'; } },
    { keys: ['anchor'], line: function (n, c, ch) { return 'Mint $' + c + ' of ' + n + "'s BTC-backed asset on " + ch + ' and hold it.'; } },
    { keys: ['card'], line: function (n, c, ch) { return 'Load $' + c + ' onto a ' + n + ' card on ' + ch + ' and spend a small amount to activate it.'; } },
    { keys: ['btc'], line: function (n, c, ch) { return 'Deposit $' + c + ' of BTC into ' + n + ' on ' + ch + ' and keep the wrapped position.'; } },
    { keys: ['chain'], line: function (n, c, ch) { return 'Use $' + c + ' of USDC in ' + n + "'s app on " + ch + ' and leave it running.'; } }
  ];
  function openingMove(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < OPENERS.length; i++) {
      var entry = OPENERS[i];
      for (var j = 0; j < entry.keys.length; j++) {
        if (c.indexOf(entry.keys[j]) >= 0) return entry.line(p.name, capital, chain);
      }
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and leave the position open.';
  }
  // The category families and their recurring weekly moves, in the same order
  // as the openers: the first family whose keyword appears wins.
  var WEEKLIES = [
    { keys: ['lend', 'cdp', 'collateral'], line: 'Supply and borrow a small amount each week so both sides count.' },
    { keys: ['dex', 'yield', 'leveraged farm'], line: 'Swap a small amount through the main pool each week so volume counts as well as TVL.' },
    { keys: ['bridge'], line: 'Bridge a small amount each week so the route stays live.' },
    { keys: ['staking', 'restak'], line: "Claim and restake the week's rewards so the position keeps compounding." },
    { keys: ['perpetual', 'derivative'], line: 'Open and close one small hedge each week so the margin account stays warm.' },
    { keys: ['prediction'], line: 'Place one small market position each week so the activity stays steady instead of one burst.' },
    { keys: ['curator', 'allocator'], line: 'Rebalance the vault deposit each week so the position keeps moving.' },
    { keys: ['stable'], line: 'Mint or redeem a small amount of the stable asset each week so the position keeps moving.' },
    { keys: ['rwa'], line: 'Mint a small amount of the yield asset each week and hold it.' },
    { keys: ['insurance'], line: "Check the cover's terms each week and renew it before it lapses." },
    { keys: ['basis'], line: "Check the basis vault's funding each week and top up while the rate favours you." },
    { keys: ['payment'], line: 'Route a small payment each week so the channel stays active.' },
    { keys: ['otc'], line: 'Refresh the OTC listing each week so the order stays visible.' },
    { keys: ['cedefi'], line: "Check the managed vault's yield each week and top up while the rate favours you." },
    { keys: ['farm'], line: "Harvest the farm's rewards each week and re-deposit them so the position compounds." },
    { keys: ['liquidity manager'], line: 'Rebalance the managed position each week so the range stays in the market.' },
    { keys: ['governance'], line: 'Vote on one proposal each week so the governance activity stays steady.' },
    { keys: ['anchor'], line: 'Check the peg each week and top up the collateral while it holds.' },
    { keys: ['card'], line: 'Spend a small amount on the card each week so the account stays active.' },
    { keys: ['btc'], line: 'Check the wrapped position each week and move it only when the peg slips.' },
    { keys: ['chain'], line: 'Use the app once a week — a swap, a vote or a deposit — so the wallet stays warm.' }
  ];
  function weeklyMove(p) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < WEEKLIES.length; i++) {
      var entry = WEEKLIES[i];
      for (var j = 0; j < entry.keys.length; j++) {
        if (c.indexOf(entry.keys[j]) >= 0) return entry.line;
      }
    }
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function waitedFor(age) {
    if (age === null || age === undefined) return 'an unlisted time';
    if (age >= 365) return (age / 365).toFixed(1) + ' years';
    return Math.max(0, Math.round(age)) + ' days';
  }
  function timingCall(p, capital, rel, expected, likelihood, age) {
    var money = function (n) { return '$' + n.toLocaleString('en-US'); };
    var likely = Math.round((likelihood === null || likelihood === undefined ? 0 : likelihood) * 100) + '% launch likelihood after ' + waitedFor(age) + ' with no token';
    if (rel <= -5) {
      var half = Math.max(25, Math.round(capital / 2));
      return { text: 'TVL is falling ' + Math.abs(rel).toFixed(1) + '% against its category — start with half the capital (' + money(half) + ') and add the rest only after the position holds for two weeks.', cost: money(half) + ' now, ' + money(capital - half) + ' later', time: 'two weeks to size up' };
    }
    if (rel >= 5) {
      return { text: 'TVL is growing ' + rel.toFixed(1) + '% faster than its category — set the position up this week, while the protocol is gaining share; the model puts its expected value at ' + money(expected) + ' on a ' + likely + '.', cost: 'no extra cost, only timing', time: 'this week' };
    }
    return { text: 'TVL is tracking its category (' + (rel >= 0 ? '+' : '') + rel.toFixed(1) + '% relative) — no timing edge either way, so start with the standard stake; the model puts it at a ' + likely + '.', cost: 'the standard ' + money(capital) + ' stake', time: '15 minutes to set up' };
  }
  function renderStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planSteps(p) {
    var chain = firstChain(p);
    var capital = stakeFor(p);
    var hold = holdFor(p.age_days);
    var gas = feeFor(chain);
    var rel = p.relative_growth_pct === null || p.relative_growth_pct === undefined ? 0 : p.relative_growth_pct;
    var steps = [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'nothing to set up', time: '5 minutes' },
      timingCall(p, capital, rel, p.implied_value_usd, p.launch_likelihood, p.age_days),
      { text: openingMove(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' for the first transaction', time: '15 minutes to set up' },
      { text: weeklyMove(p), cost: gas + ' a week', time: '10 minutes a week' }
    ];
    if (p.chains && p.chains.length > 1) {
      steps.push({ text: 'The protocol also runs on ' + (p.chains.length - 1) + ' other chain' + (p.chains.length - 1 === 1 ? '' : 's') + ' — copy the position to a second chain only after the first one qualifies, so the activity lands on two chains.', cost: gas + ' per chain mirrored', time: '15 minutes a chain' });
    }
    steps.push(
      { text: 'Keep the position open for at least ' + hold + ' days so more than one snapshot counts the activity.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it later.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Exit in stages: take out a third, wait a day, then take out the rest, keeping enough ' + (chain === 'its main chain' ? 'native token' : chain) + ' for the exit gas.', cost: gas, time: 'two days to exit fully' }
    );
    return steps.map(renderStep);
  }

  function loadState() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('scope')) view.scope = params.get('scope');
  }
  function saveState() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.scope !== 'all') params.set('scope', view.scope);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (view.scope === 'watchlist' && r.scope !== 'watchlist') return false;
      if (view.scope === 'off-list' && r.scope !== 'off-list') return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function shownValue(r) {
    return tweak.active ? recomputeRow(r, sandboxModel()) : r.implied_value_usd;
  }
  function sortedRows(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = shownValue(a); bv = shownValue(b); }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', null, 'Snapshot ', h('b', { text: DATA.as_of })),
        h('span', null, 'DefiLlama protocol index'),
        h('span', null, h('b', { text: DATA.model_version }), ' model')
      )
    );
  }

  // The lede's fact column: coverage counts and the highest expected value,
  // so the reader sees the board's shape before the first row.
  function factsGrid(top) {
    return h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Off-list rows found' }), h('b', { text: String(DATA.early_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Highest expected value' }), h('b', { text: top ? usd(top.implied_value_usd) : 'n/a' }))
    );
  }

  function ledeSection() {
    var top = DATA.rows.length > 0 ? DATA.rows[0] : null;
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by expected value' }),
        h('p', null,
          'The watchlist is the floor: every protocol with at least ', h('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The radar adds ', h('b', { text: String(DATA.early_size) }),
          ' pre-token protocols the watchlist leaves out, so the board is the whole pre-token universe this snapshot can see. Expected value is the modeled token value times how likely the protocol is to launch one — its category\'s launch rate times its age factor — a model, not a promise.')
      ),
      factsGrid(top)
    );
  }

  // One toggle button for the scope and tab groups: same shape, different
  // label and state, so the filter row stays a list instead of five copies.
  function tabButton(label, pressed, onclick) {
    return h('button', { type: 'button', 'aria-pressed': pressed ? 'true' : 'false', text: label, onclick: onclick });
  }

  // One labelled select for the filter row: the label, the "all" option, the
  // values, and what a change does. Category and chain share the shape.
  function selectField(id, label, allLabel, options, value, onChange) {
    var sel = h('select', { id: id, 'aria-label': 'Filter by ' + label.toLowerCase() },
      h('option', { value: 'all', text: allLabel }),
      options.map(function (o) { return h('option', { value: o, text: o, selected: o === value ? 'selected' : null }); })
    );
    sel.addEventListener('change', function () { onChange(sel.value); });
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), sel);
  }

  function filterRow() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; saveState(); renderPage(); });
    var cat = selectField('category', 'Category', 'All categories', categories, view.category, function (v) { view.category = v; saveState(); renderPage(); });
    var chain = selectField('chain', 'Chain', 'All chains', chains, view.chain, function (v) { view.chain = v; saveState(); renderPage(); });
    var scopeAll = tabButton('All rows', view.scope === 'all', function () { view.scope = 'all'; saveState(); renderPage(); });
    var scopeWatch = tabButton('Watchlist', view.scope === 'watchlist', function () { view.scope = 'watchlist'; saveState(); renderPage(); });
    var scopeOff = tabButton('Off-list', view.scope === 'off-list', function () { view.scope = 'off-list'; saveState(); renderPage(); });
    var pre = tabButton('Pre-token', view.tab === 'pre-token', function () { view.tab = 'pre-token'; renderPage(); });
    var live = tabButton('Live token', view.tab === 'live', function () { view.tab = 'live'; renderPage(); });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      cat,
      chain,
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Scope' }), h('div', { class: 'tabs' }, scopeAll, scopeWatch, scopeOff)),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: view.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortCell(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } renderPage(); } },
        label,
        view.sort === key ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // One board row's cells: rank, protocol, TVL, growth, age, expected value
  // with its bar, and scope. The bar scales against the strongest shown
  // value, so the longest bar is always the top row on screen.
  function boardCells(r, shown, topShown) {
    var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var chance = r.launch_likelihood === null || r.launch_likelihood === undefined ? '' : Math.round(r.launch_likelihood * 100) + '% likely';
    return [
      h('td', { class: 'num', text: String(r.rank) }),
      h('td', null, h('div', { class: 'name' },
        h('b', { text: r.name }),
        h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      )),
      h('td', { class: 'num', text: usd(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growth }),
      h('td', { class: 'num', text: ageLabel(r.age_days) }),
      h('td', null, h('div', { class: 'implied' },
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((shown / topShown) * 100)) + '%' })),
        h('div', { class: 'value' },
          h('span', { class: 'num', text: usd(shown) }),
          h('span', { class: 'chance', text: chance })
        )
      )),
      h('td', null, h('span', { class: 'scope ' + (r.scope === 'watchlist' ? 'watch' : 'off'), text: r.scope === 'watchlist' ? 'WATCHLIST' : 'OFF-LIST' }))
    ];
  }

  function boardGrid() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.scope = 'all'; saveState(); renderPage(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return shownValue(r); })) || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var shown = shownValue(r);
      var tr = h('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openRow(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(r.slug); } }
      }, boardCells(r, shown, max));
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest expected value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortCell('implied', 'Rank'),
            sortCell('name', 'Protocol'),
            sortCell('tvl', 'TVL'),
            sortCell('growth', '7d'),
            sortCell('age', 'Age'),
            sortCell('implied', 'Expected value'),
            h('th', { scope: 'col', text: 'Scope' })
          )),
          tbody
        )
      )
    );
  }

  // One live row's cells: status, protocol, TVL, growth, market cap, token.
  // The market cap is the market's own number, so no model figure appears.
  function liveCells(r) {
    return [
      h('td', { class: 'num', text: 'live' }),
      h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
      h('td', { class: 'num', text: usd(r.tvl_usd) }),
      h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
      h('td', { class: 'num', text: usd(r.mcap_usd) }),
      h('td', null, h('span', { class: 'status live', text: 'already trades' }))
    ];
  }

  function liveBoard() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null, liveCells(r)));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The age curve panel: the launch rate by time since listing as bars, one
  // row per bucket, drawn from the calibration the model computed. Each row
  // shows the bucket, the raw token rate as the bar, the bucket's size and
  // its with-token count, the shrunk rate the factor is built from, and the
  // factor itself — so the reader sees where the age factor comes from
  // instead of taking the table's word for it. The bars climb from the
  // youngest bucket to the oldest: age is the model's second launch signal,
  // and the curve is the evidence for it.
  function ageCurvePanel() {
    var cal = DATA.calibration;
    var buckets = cal.age_buckets || [];
    if (buckets.length === 0) return null;
    var global = Math.round(cal.global_token_rate * 100);
    var first = Math.round((buckets[0].rate || 0) * 100);
    var last = Math.round((buckets[buckets.length - 1].rate || 0) * 100);
    var rows = buckets.map(function (b) {
      var rate = Math.round((b.rate || 0) * 100);
      var shrunk = Math.round((b.shrunk_rate || 0) * 100);
      return h('div', { class: 'age-row' },
        h('span', { class: 'age-lab', text: b.label }),
        h('div', { class: 'age-track', 'aria-hidden': 'true' }, h('i', { class: 'age-fill', style: 'width:' + Math.max(2, rate) + '%' })),
        h('span', { class: 'age-num', text: rate + '% launch rate' }),
        h('span', { class: 'age-meta', text: 'n=' + b.protocols + ' · ' + b.with_token + ' with token · shrunk ' + shrunk + '% · ' + b.factor.toFixed(2) + 'x' })
      );
    });
    return h('div', { class: 'agecurve' },
      h('h3', { text: 'The age curve: launch rate by time since listing' }),
      h('p', { class: 'sub', text: 'Each bar is the share of protocols first listed that long ago that record a token. The factor beside it is the bucket rate shrunk toward the global ' + global + '% with ten pseudo-counts, divided by that global rate. The curve climbs from ' + first + '% under six months to ' + last + '% over three years — and the gap survives inside the big categories, so age earns its place as the likelihood\'s second leg.' }),
      rows
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var multRows = cal.categories.filter(function (c) { return c.multiple_calibrated; }).map(function (c) {
      return h('tr', null,
        h('td', { text: c.category }),
        h('td', { class: 'num', text: c.multiple.toFixed(3) + 'x' }),
        h('td', { class: 'num', text: String(c.live_count) })
      );
    });
    var priorRows = cal.categories.slice().sort(function (a, b) { return b.pre_token - a.pre_token || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0); }).slice(0, 12).map(function (c) {
      return h('tr', null,
        h('td', { text: c.category }),
        h('td', { class: 'num', text: String(c.with_token) + ' of ' + String(c.protocols) }),
        h('td', { class: 'num', text: Math.round(c.prior * 100) + '%' })
      );
    });
    var ageRows = (cal.age_buckets || []).map(function (b) {
      return h('tr', null,
        h('td', { text: b.label }),
        h('td', { class: 'num', text: String(b.protocols) }),
        h('td', { class: 'num', text: String(b.with_token) }),
        h('td', { class: 'num', text: Math.round(b.rate * 100) + '%' }),
        h('td', { class: 'num', text: b.factor.toFixed(2) + 'x' })
      );
    });
    var gw = h('input', { type: 'number', id: 'gw', min: '0', max: '1', step: '0.1', value: String(m.growth_weight), 'aria-label': 'Growth weight' });
    var lf = h('input', { type: 'number', id: 'lf', min: '0', max: '0.5', step: '0.05', value: String(m.likelihood_floor), 'aria-label': 'Likelihood floor' });
    var lw = h('input', { type: 'number', id: 'lw', min: '0', max: '1', step: '0.1', value: String(m.likelihood_weight), 'aria-label': 'Likelihood weight' });
    var apply = h('button', { class: 'button primary', type: 'button', text: 'Re-rank the board', onclick: function () {
      tweak.growth_weight = parseFloat(gw.value);
      tweak.likelihood_floor = parseFloat(lf.value);
      tweak.likelihood_weight = parseFloat(lw.value);
      if (!isFinite(tweak.growth_weight)) tweak.growth_weight = m.growth_weight;
      if (!isFinite(tweak.likelihood_floor)) tweak.likelihood_floor = m.likelihood_floor;
      if (!isFinite(tweak.likelihood_weight)) tweak.likelihood_weight = m.likelihood_weight;
      tweak.active = true;
      view.sort = 'implied'; view.dir = -1;
      renderPage();
    } });
    var reset = h('button', { class: 'button', type: 'button', text: 'Reset to ' + DATA.model_version, onclick: function () {
      tweak.active = false; tweak.growth_weight = null; tweak.likelihood_floor = null; tweak.likelihood_weight = null;
      gw.value = String(m.growth_weight); lf.value = String(m.likelihood_floor); lw.value = String(m.likelihood_weight);
      renderPage();
    } });
    return h('section', { class: 'panel model', id: 'model' },
      h('h2', { text: 'How expected value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' },
        'expected = round( tvl_usd x ', h('b', { text: 'category multiple' }),
        ' x (1 + clamp(change_7d - category median, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')',
        ' x (1 + 0.02 x min(chains - 1, 10))',
        ' x min(1, ' + m.likelihood_floor + ' + ' + m.likelihood_weight + ' x launch prior x age factor) )'
      ),
      h('p', { class: 'sub', text: 'Two things are new here. Growth is measured against the category: a protocol holding flat while its category falls is gaining share, and the snapshot\'s week was a down week for almost every category, so the category median of ' + pct(cal.global_median_change) + ' is the honest zero. And the launch likelihood is now two-way: how often the category launches, times how often protocols of this age launch. Age is the time since the protocol was first listed, the best record of how long it has run with no token — protocols listed under six months ago record a token 26% of the time, while protocols listed over three years ago record one 79% of the time, and the gap survives inside the big categories. Each bucket\'s factor is its token rate shrunk toward the global ' + Math.round(cal.global_token_rate * 100) + '% with ten pseudo-counts, divided by that global rate. The combined rate is capped at 1 before dampening — a likelihood is a probability — and seven old Lending and Dexs rows reach the cap. A protocol whose listing date the snapshot does not carry gets a neutral factor of 1.0: the unknown-age bucket\'s 77% rate looks like unrecorded old listings, so the model does not credit an age it cannot measure. Chains reward distribution: a protocol live on more chains reaches more farmers.' }),
      ageCurvePanel(),
      h('p', { class: 'sub', text: 'Three ideas were tested against the snapshot and dropped. Size tiers are flat: token rates by TVL tier run 52%, 52%, 55%, 59%, 66% and 56% from the smallest tier to the largest, so size per se does not predict a launch and no size-tier prior was added. Category share is weak and confounded: a protocol\'s share of its category\'s TVL moves the token rate only from 47% in the bottom decile to 67% in the top, and the movement tracks TVL itself. And raw seven-day change is confounded by the down week: protocols whose TVL fell hardest record tokens more often (59.8% for a fall over 10%, against 22.9% for a rise of 2-10%), because the week punishes young categories hardest — a raw change term would reward the wrong rows, so momentum stays category-relative.' }),
      h('div', { class: 'twin' },
        h('table', { class: 'calib' },
          h('caption', { class: 'sub', text: 'Calibrated multiples, from this snapshot\'s live tokens' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Category' }), h('th', { scope: 'col', text: 'Multiple' }), h('th', { scope: 'col', text: 'Live tokens' }))),
          h('tbody', null, multRows)
        ),
        h('table', { class: 'calib' },
          h('caption', { class: 'sub', text: 'Launch priors: the 12 categories with the most pre-token rows' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Category' }), h('th', { scope: 'col', text: 'With token' }), h('th', { scope: 'col', text: 'Prior' }))),
          h('tbody', null, priorRows)
        )
      ),
      h('table', { class: 'calib' },
        h('caption', { class: 'sub', text: 'Age factors: token rates by time since listing, shrunk toward the global rate' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Listed' }), h('th', { scope: 'col', text: 'Protocols' }), h('th', { scope: 'col', text: 'With token' }), h('th', { scope: 'col', text: 'Token rate' }), h('th', { scope: 'col', text: 'Factor' }))),
        h('tbody', null, ageRows)
      ),
      h('div', { class: 'sandbox' },
        h('div', { class: 'field' }, h('label', { for: 'gw', text: 'Growth weight' }), gw),
        h('div', { class: 'field' }, h('label', { for: 'lf', text: 'Likelihood floor' }), lf),
        h('div', { class: 'field' }, h('label', { for: 'lw', text: 'Likelihood weight' }), lw),
        apply, reset,
        h('span', { class: 'note', text: tweak.active ? 'Sandbox live: the board below is re-ranked with your constants. The board keeps ' + DATA.model_version + '\'s ranks.' : 'Try the model: change a constant and re-rank the board live.' })
      )
    );
  }

  function readingPanel() {
    return h('section', { class: 'panel method' },
      h('h2', { text: 'How to read this radar' }),
      h('p', null, h('b', { text: 'Watchlist is the floor, never the ceiling. ' }), 'A protocol the watchlist leaves out is no worse a subject: the board ranks every pre-token protocol the snapshot can see, and the scope column says which ones the watchlist named. Wrapped, staked and bridged products of tokens that already trade are left out entirely — a wrapped token is not a launch waiting to happen.'),
      h('p', null, h('b', { text: 'Expected value is a value times a chance. ' }), 'The modeled token value is what the token would be worth if it launches; the launch likelihood is how often the protocol\'s category launches one, times how often protocols of its age launch one. A big protocol in a category that rarely launches can sit below a smaller one in a category that almost always does — that is the point of ranking by expected value, and the detail view shows both numbers for every row.'),
      h('p', null, h('b', { text: 'Say "records no token", never "has none". ' }), 'DefiLlama\'s record is not proof: a protocol on this board may still have a token its record does not carry. Expected value is the entry\'s own claim from the snapshot\'s figures — never a price, and never a promise of a launch.'),
      h('p', null, h('b', { text: 'Farm before the token, not after. ' }), 'The plan on each row is the concrete way to qualify: a fresh wallet, a timing call from the protocol\'s own momentum, one position, a weekly action, a hold of weeks, and an exit in stages. Never pay to claim an airdrop — claim only from the link the protocol itself publishes.')
    );
  }

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; saveState(); });

  function openRow(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    saveState();
    dialog.textContent = '';
    var steps = planSteps(row);
    var factor = factorOf(row.category);
    var recomputed = recomputeRow(row, DATA.model);
    var likelihoodPct = row.launch_likelihood === null || row.launch_likelihood === undefined ? 'n/a' : Math.round(row.launch_likelihood * 100) + '%';
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.scope === 'watchlist' ? 'watchlist' : 'off-list') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Expected value' }),
      h('p', { class: 'summary', text: usd(row.implied_value_usd) + ': the modeled token value ' + usd(row.raw_implied_value_usd) + ' times a ' + likelihoodPct + ' launch likelihood.' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: usd(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Category multiple' }), h('b', { class: 'num', text: factor.multiple.toFixed(3) + 'x' + (factor.multiple_calibrated ? '' : ' (global)') })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row.change_7d) })),
        h('div', null, h('span', { text: 'Category median growth' }), h('b', { class: 'num', text: pct(factor.median_change) })),
        h('div', null, h('span', { text: 'Relative growth' }), h('b', { class: 'num', text: pct(row.relative_growth_pct) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageLabel(row.age_days) })),
        h('div', null, h('span', { text: 'Age bucket' }), h('b', { class: 'num', text: row.age_bucket || 'unknown' })),
        h('div', null, h('span', { text: 'Age factor' }), h('b', { class: 'num', text: (row.age_factor === null || row.age_factor === undefined ? 'n/a' : row.age_factor.toFixed(2) + 'x') })),
        h('div', null, h('span', { text: 'Chains' }), h('b', { class: 'num', text: String((row.chains || []).length) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
        h('div', null, h('span', { text: 'Breadth multiplier' }), h('b', { class: 'num', text: String(row.breadth_multiplier) })),
        h('div', null, h('span', { text: 'Modeled token value' }), h('b', { class: 'num', text: usd(row.raw_implied_value_usd) })),
        h('div', null, h('span', { text: 'Launch likelihood' }), h('b', { class: 'num', text: likelihoodPct + ' (' + (row.category || 'Other') + ' prior ' + Math.round(factor.prior * 100) + '% x age ' + (row.age_factor === null || row.age_factor === undefined ? 'n/a' : row.age_factor.toFixed(2) + 'x') + ')' })),
        h('div', null, h('span', { text: 'Expected value' }), h('b', { class: 'num', text: usd(row.implied_value_usd) }))
      ),
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + usd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function renderPage() {
    mount.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(masthead());
    shell.appendChild(ledeSection());
    shell.appendChild(filterRow());
    shell.appendChild(view.tab === 'pre-token' ? boardGrid() : liveBoard());
    if (view.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(readingPanel());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) openRow(view.selected);
  }

  loadState();
  renderPage();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

