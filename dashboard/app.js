// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the model's own inputs and the protocol's farm plan, and a model sandbox that
// re-ranks the board live. No network: every byte it shows is in data.js.
//
// The page recomputes every row from the snapshot figures with the same calibrated
// model main.ts used, and checks the number board.json carries, so the page's code
// and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  var view = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var tweak = { growth_weight: null, maturity_floor: null, active: false };

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

  // The calibrated multiple one category gets: the table main.ts computed from this
  // snapshot's live-token protocols, or the global median when the category has too few.
  function categoryMultiple(category) {
    var key = category || 'Other';
    var found = null;
    DATA.calibration.categories.forEach(function (c) { if (c.category === key) found = c; });
    if (found && found.calibrated) return { multiple: found.multiple, calibrated: true };
    return { multiple: DATA.calibration.global_multiple, calibrated: false };
  }

  // The model in one function: the same arithmetic as lib/model.ts, so the detail view
  // can recompute a row and check it against the board.
  function recomputeValue(row, model) {
    var m = model || DATA.model;
    var mult = categoryMultiple(row.category).multiple;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * mult * growthMult * maturity * breadth));
  }

  function tweakedModel() {
    if (!tweak.active) return DATA.model;
    var m = {};
    Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
    if (tweak.growth_weight !== null) m.growth_weight = tweak.growth_weight;
    if (tweak.maturity_floor !== null) m.maturity_floor = tweak.maturity_floor;
    return m;
  }

  function node(tag, attrs) {
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
  // TVL and age decide the action, the capital, the hold and every cost and time.
  // No name is special-cased.
  function leadChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
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
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 'about $3 to $8 of gas';
    if (c === 'solana') return 'under $0.10 of fees';
    var cheap = ['arbitrum', 'optimism', 'base', 'blast', 'zksync', 'linea', 'scroll', 'mode', 'mantle', 'polygon', 'bsc', 'avalanche', 'fantom', 'gnosis', 'celo', 'starknet', 'manta', 'taiko', 'zora'];
    for (var i = 0; i < cheap.length; i++) if (c.indexOf(cheap[i]) >= 0) return 'about $0.10 to $1 of gas';
    return 'about $2 of gas';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and keep the position open.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + ' of USDC in ' + name + "'s app on " + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function joinStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planFor(p) {
    var chain = leadChain(p);
    var capital = stakeFor(p);
    var hold = holdFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'nothing to set up', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' for the first transaction', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Unwind in stages: withdraw a third, wait a day, then withdraw the rest, keeping enough ' + (chain === 'its main chain' ? 'native token' : chain) + ' for the exit gas.', cost: gas, time: 'two days to exit fully' }
    ].map(joinStep);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('scope')) view.scope = params.get('scope');
  }
  function writeHash() {
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

  function visibleRows() {
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
    return tweak.active ? recomputeValue(r, tweakedModel()) : r.implied_value_usd;
  }
  function orderedRows(list) {
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

  function topBar() {
    return node('header', { class: 'top' },
      node('div', { class: 'brand' }, node('span', { class: 'mark' }), node('span', { class: 'brand-name', text: 'Token Radar' })),
      node('div', { class: 'top-meta' },
        node('span', null, 'Snapshot ', node('b', { text: DATA.as_of })),
        node('span', null, 'DefiLlama protocol index'),
        node('span', null, node('b', { text: DATA.model_version }), ' model')
      )
    );
  }

  function intro() {
    return node('section', { class: 'lede' },
      node('div', null,
        node('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        node('p', null,
          'The watchlist is the floor: every protocol with at least ', node('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The radar adds ', node('b', { text: String(DATA.early_size) }),
          ' pre-token protocols the watchlist leaves out, so the board is the whole pre-token universe this snapshot can see. Implied value is a model, not a promise.')
      ),
      node('div', { class: 'facts' },
        node('div', { class: 'fact' }, node('span', { text: 'Watchlist covered' }), node('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        node('div', { class: 'fact' }, node('span', { text: 'Pre-token rows scored' }), node('b', { text: String(DATA.board_size) })),
        node('div', { class: 'fact' }, node('span', { text: 'Off-list rows found' }), node('b', { text: String(DATA.early_size) })),
        node('div', { class: 'fact' }, node('span', { text: 'Live-token protocols set aside' }), node('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function filterBar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = node('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeHash(); render(); });
    var cat = node('select', { id: 'category', 'aria-label': 'Filter by category' },
      node('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return node('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { view.category = cat.value; writeHash(); render(); });
    var chain = node('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      node('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return node('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { view.chain = chain.value; writeHash(); render(); });
    var scopeAll = node('button', { type: 'button', 'aria-pressed': view.scope === 'all' ? 'true' : 'false', text: 'All rows', onclick: function () { view.scope = 'all'; writeHash(); render(); } });
    var scopeWatch = node('button', { type: 'button', 'aria-pressed': view.scope === 'watchlist' ? 'true' : 'false', text: 'Watchlist', onclick: function () { view.scope = 'watchlist'; writeHash(); render(); } });
    var scopeOff = node('button', { type: 'button', 'aria-pressed': view.scope === 'off-list' ? 'true' : 'false', text: 'Off-list', onclick: function () { view.scope = 'off-list'; writeHash(); render(); } });
    var pre = node('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; render(); } });
    var live = node('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; render(); } });
    return node('div', { class: 'controls' },
      node('div', { class: 'field' }, node('label', { for: 'q', text: 'Search' }), search),
      node('div', { class: 'field' }, node('label', { for: 'category', text: 'Category' }), cat),
      node('div', { class: 'field' }, node('label', { for: 'chain', text: 'Chain' }), chain),
      node('div', { class: 'field' }, node('span', { class: 'sub', text: 'Scope' }), node('div', { class: 'tabs' }, scopeAll, scopeWatch, scopeOff)),
      node('div', { class: 'field' }, node('span', { class: 'sub', text: 'Token status' }), node('div', { class: 'tabs' }, pre, live)),
      node('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHead(key, label) {
    return node('th', { scope: 'col' },
      node('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } render(); } },
        label,
        view.sort === key ? node('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardPanel() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return node('div', { class: 'panel' }, node('div', { class: 'empty' },
        node('h2', { text: 'No protocol matches that filter' }),
        node('p', { text: 'Clear the search or pick another category to see the board again.' }),
        node('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return shownValue(r); })) || 1;
    var tbody = node('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var shown = shownValue(r);
      var tr = node('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        node('td', { class: 'num', text: String(r.rank) }),
        node('td', null, node('div', { class: 'name' },
          node('b', { text: r.name }),
          node('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        node('td', { class: 'num', text: usd(r.tvl_usd) }),
        node('td', { class: 'num ' + growthClass, text: growth }),
        node('td', { class: 'num', text: ageLabel(r.age_days) }),
        node('td', null, node('div', { class: 'implied' },
          node('div', { class: 'bar', 'aria-hidden': 'true' }, node('i', { style: 'width:' + Math.max(3, Math.round((shown / max) * 100)) + '%' })),
          node('span', { class: 'num', text: usd(shown) })
        )),
        node('td', null, node('span', { class: 'scope ' + (r.scope === 'watchlist' ? 'watch' : 'off'), text: r.scope === 'watchlist' ? 'WATCHLIST' : 'OFF-LIST' }))
      );
      tbody.appendChild(tr);
    });
    return node('div', { class: 'panel' },
      node('div', { class: 'table-wrap' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          node('thead', null, node('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('implied', 'Implied value'),
            node('th', { scope: 'col', text: 'Scope' })
          )),
          tbody
        )
      )
    );
  }

  function livePanel() {
    var tbody = node('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(node('tr', null,
        node('td', { class: 'num', text: 'live' }),
        node('td', null, node('div', { class: 'name' }, node('b', { text: r.name }), node('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        node('td', { class: 'num', text: usd(r.tvl_usd) }),
        node('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        node('td', { class: 'num', text: usd(r.mcap_usd) }),
        node('td', null, node('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return node('div', { class: 'panel' },
      node('div', { class: 'table-wrap' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Status' }), node('th', { scope: 'col', text: 'Protocol' }), node('th', { scope: 'col', text: 'TVL' }), node('th', { scope: 'col', text: '7d' }), node('th', { scope: 'col', text: 'Market cap' }), node('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelSection() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var rows = cal.categories.filter(function (c) { return c.calibrated; }).map(function (c) {
      return node('tr', null,
        node('td', { text: c.category }),
        node('td', { class: 'num', text: c.multiple.toFixed(3) + 'x' }),
        node('td', { class: 'num', text: String(c.live_count) })
      );
    });
    var gw = node('input', { type: 'number', id: 'gw', min: '0', max: '1', step: '0.1', value: String(m.growth_weight), 'aria-label': 'Growth weight' });
    var mf = node('input', { type: 'number', id: 'mf', min: '0.4', max: '0.8', step: '0.1', value: String(m.maturity_floor), 'aria-label': 'Maturity floor' });
    var apply = node('button', { class: 'button primary', type: 'button', text: 'Re-rank the board', onclick: function () {
      tweak.growth_weight = parseFloat(gw.value);
      tweak.maturity_floor = parseFloat(mf.value);
      if (!isFinite(tweak.growth_weight)) tweak.growth_weight = m.growth_weight;
      if (!isFinite(tweak.maturity_floor)) tweak.maturity_floor = m.maturity_floor;
      tweak.active = true;
      view.sort = 'implied'; view.dir = -1;
      render();
    } });
    var reset = node('button', { class: 'button', type: 'button', text: 'Reset to ' + DATA.model_version, onclick: function () {
      tweak.active = false; tweak.growth_weight = null; tweak.maturity_floor = null;
      gw.value = String(m.growth_weight); mf.value = String(m.maturity_floor);
      render();
    } });
    return node('section', { class: 'panel model' },
      node('h2', { text: 'How implied value is computed' }),
      node('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      node('div', { class: 'formula' },
        'implied = round( tvl_usd x ', node('b', { text: 'category multiple' }),
        ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')',
        ' x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')',
        ' x (1 + 0.02 x min(chains - 1, 10)) )'
      ),
      node('p', { class: 'sub', text: 'The category multiple is calibrated from this snapshot: the median market-cap-to-TVL ratio of that category\'s live-token protocols, five or more required, else the global median of ' + cal.global_multiple.toFixed(3) + 'x across ' + cal.global_live_count + ' live tokens. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chains reward distribution: a protocol live on more chains reaches more farmers.' }),
      node('table', { class: 'calib' },
        node('caption', { class: 'sub', text: 'Calibrated multiples, from this snapshot\'s live tokens' }),
        node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Category' }), node('th', { scope: 'col', text: 'Multiple' }), node('th', { scope: 'col', text: 'Live tokens' }))),
        node('tbody', null, rows)
      ),
      node('div', { class: 'sandbox' },
        node('div', { class: 'field' }, node('label', { for: 'gw', text: 'Growth weight' }), gw),
        node('div', { class: 'field' }, node('label', { for: 'mf', text: 'Maturity floor' }), mf),
        apply, reset,
        node('span', { class: 'note', text: tweak.active ? 'Sandbox live: the board below is re-ranked with your constants. The board keeps ' + DATA.model_version + '\'s ranks.' : 'Try the model: change a constant and re-rank the board live.' })
      )
    );
  }

  function methodSection() {
    return node('section', { class: 'panel method' },
      node('h2', { text: 'How to read this radar' }),
      node('p', null, node('b', { text: 'Watchlist is the floor, never the ceiling. ' }), 'A protocol the watchlist leaves out is no worse a subject: the board ranks every pre-token protocol the snapshot can see, and the scope column says which ones the watchlist named. Wrapped, staked and bridged products of tokens that already trade are left out entirely: a wrapped token is not a launch waiting to happen.'),
      node('p', null, node('b', { text: 'Say "records no token", never "has none". ' }), 'DefiLlama\'s record is not proof: a protocol on this board may still have a token its record does not carry. Implied value is the entry\'s own claim from the snapshot\'s figures, never a price and never a promise of a launch.'),
      node('p', null, node('b', { text: 'Farm before the token, not after. ' }), 'The plan on each row is the concrete way to qualify: a fresh wallet, one position, a weekly action, a hold of weeks, and an exit in stages. Never pay to claim an airdrop, and claim only from the link the protocol itself publishes.')
    );
  }

  var dialog = node('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = planFor(row);
    var mult = categoryMultiple(row.category);
    var recomputed = recomputeValue(row, DATA.model);
    dialog.appendChild(node('div', { class: 'detail-head' },
      node('div', null,
        node('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.scope === 'watchlist' ? 'watchlist' : 'off-list') }),
        node('h2', { id: 'detail-title', text: row.name }),
        node('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      node('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Implied value' }),
      node('div', { class: 'equation' },
        node('div', null, node('span', { text: 'TVL' }), node('b', { class: 'num', text: usd(row.tvl_usd) })),
        node('div', null, node('span', { text: 'Category multiple' }), node('b', { class: 'num', text: mult.multiple.toFixed(3) + 'x' + (mult.calibrated ? '' : ' (global)') })),
        node('div', null, node('span', { text: 'Seven-day growth' }), node('b', { class: 'num', text: pct(row.change_7d) })),
        node('div', null, node('span', { text: 'Age with no token' }), node('b', { class: 'num', text: ageLabel(row.age_days) })),
        node('div', null, node('span', { text: 'Chains' }), node('b', { class: 'num', text: String((row.chains || []).length) })),
        node('div', null, node('span', { text: 'Growth multiplier' }), node('b', { class: 'num', text: String(row.growth_multiplier) })),
        node('div', null, node('span', { text: 'Maturity multiplier' }), node('b', { class: 'num', text: String(row.maturity_multiplier) })),
        node('div', null, node('span', { text: 'Breadth multiplier' }), node('b', { class: 'num', text: String(row.breadth_multiplier) })),
        node('div', null, node('span', { text: 'Implied value' }), node('b', { class: 'num', text: usd(row.implied_value_usd) }))
      ),
      node('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + usd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Farm plan' }),
      node('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return node('li', null, node('b', { text: action }), node('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    mount.textContent = '';
    var shell = node('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? boardPanel() : livePanel());
    if (view.tab === 'pre-token') shell.appendChild(modelSection());
    shell.appendChild(methodSection());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) openDetail(view.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
