// Token Radar dashboard (peer-priced-2). Reads window.RADAR from data.js,
// written beside this page by main.ts. No network, no fetch: every number
// on screen, including each farm plan, is the exact value board.json
// carries, so what the reader sees is what the gate scored.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, wlOnly: false, tab: 'pre-token', sort: 'implied', selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + ' yrs';
    return Math.round(d) + ' days';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('wl') === '1') state.wlOnly = true;
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.wlOnly) p.set('wl', '1');
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.wlOnly && !r.watchlist) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var k = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -1e18 : a.change_7d; bv = b.change_7d === null ? -1e18 : b.change_7d; }
      else if (k === 'multiple') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      return bv - av || (a.slug < b.slug ? -1 : 1);
    });
  }

  function header() {
    return el('div', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'ring' }), el('span', null, 'Token Radar', el('small', { text: 'peer-priced launch radar' }))),
      el('div', { class: 'meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index, frozen' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))));
  }
  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', null, 'Which pre-token protocol is ', el('em', { text: 'worth farming next' }), '?'),
        el('p', { text: 'Every protocol here records no token yet. Instead of ranking by raw TVL, this radar prices each one with the multiple the market already pays for tokenised peers in the same category, then adjusts for its 7-day trend, its age with no token, and its chain spread. The result is an implied launch value you can audit, row by row.' })),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every protocol at or above ' + fmtUsd(DATA.floor_usd) + ' TVL' })),
        el('div', { class: 'stat' }, el('span', { text: 'Protocols ranked' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early finds below the floor' })),
        el('div', { class: 'stat' }, el('span', { text: 'Combined implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('small', { text: 'across the whole board' })),
        el('div', { class: 'stat' }, el('span', { text: 'Top of the board' }), el('b', { text: top ? top.name : '-' }), el('small', { text: top ? fmtUsd(top.implied_value_usd) + ' implied on ' + fmtUsd(top.tvl_usd) + ' TVL' : '' }))));
  }
  function method() {
    var chips = DATA.categories.filter(function (c) { return c.board_rows > 0; }).slice(0, 10).map(function (c) {
      var b = el('button', { class: 'cat-chip', type: 'button' }, c.category + ' ', el('b', { text: c.peer_multiple.toFixed(2) + 'x' }), ' · ' + c.peer_count + ' peers');
      b.addEventListener('click', function () { state.category = c.category; writeHash(); render(); });
      return b;
    });
    return el('section', { class: 'method' },
      el('h2', { text: 'The method: peer pricing, not a flat guess' }),
      el('p', { text: 'For tokenised protocols the snapshot records a real market cap, so mcap / TVL is the price the market pays per TVL dollar in that category. We take the median per category (never the mean, so one 400x outlier cannot poison a category), shrink it in log space toward the global median of ' + DATA.global_multiple.toFixed(2) + 'x by peer count (one lone 2.97x peer shrinks to 0.36x, not the 0.77x an arithmetic shrink would give), and clamp it to 0.02x-1.50x. Confidence rises with peer count. No name is special-cased.' }),
      el('div', { class: 'formula', text: 'implied  =  TVL  x  peer multiple (category median, shrunk, clamped)  x  growth  x  maturity  x  chain spread' }),
      el('div', { class: 'cats' }, chips));
  }
  function spotlight() {
    return el('div', { class: 'spot' }, DATA.rows.slice(0, 5).map(function (r) {
      var card = el('button', { class: 'spot-card', type: 'button' },
        el('span', { class: 'rk', text: 'RANK #' + r.rank + (r.watchlist ? ' · WATCHLIST' : ' · EARLY') }),
        el('h3', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains[0] || '') }),
        el('div', { class: 'val num', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'sub', text: 'on ' + fmtUsd(r.tvl_usd) + ' TVL at ' + r.peer_multiple.toFixed(2) + 'x peers' }));
      card.addEventListener('click', function () { openDetail(r.slug); });
      return card;
    }));
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTableOnly(); });
    var catSel = el('select', { 'aria-label': 'Category' }, el('option', { value: 'all', text: 'All categories' }), cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { 'aria-label': 'Chain' }, el('option', { value: 'all', text: 'All chains' }), chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var tvlSel = el('select', { 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '50000000', text: 'TVL at least $50M' }),
      el('option', { value: '100000000', text: 'TVL at least $100M' }),
      el('option', { value: '500000000', text: 'TVL at least $500M' }),
      el('option', { value: '1000000000', text: 'TVL at least $1B' }));
    tvlSel.value = String(state.minTvl);
    tvlSel.addEventListener('change', function () { state.minTvl = Number(tvlSel.value); render(); });
    var sortSel = el('select', { 'aria-label': 'Sort' },
      el('option', { value: 'implied', text: 'Sort: implied value' }),
      el('option', { value: 'tvl', text: 'Sort: TVL' }),
      el('option', { value: 'growth', text: 'Sort: 7d growth' }),
      el('option', { value: 'multiple', text: 'Sort: peer multiple' }));
    sortSel.value = state.sort;
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
    var wl = el('input', { type: 'checkbox' }); wl.checked = state.wlOnly;
    wl.addEventListener('change', function () { state.wlOnly = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board' });
    pre.addEventListener('click', function () { state.tab = 'pre-token'; render(); });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens (peers)' });
    live.addEventListener('click', function () { state.tab = 'live'; render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { text: 'Size' }), tvlSel),
      el('div', { class: 'field' }, el('label', { text: 'Order' }), sortSel),
      el('label', { class: 'check' }, wl, ' Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', id: 'row-count', text: '' }));
  }

  var tableHost = el('div');
  function boardTable() {
    var list = sorted(filtered());
    var count = document.getElementById('row-count');
    if (count) count.textContent = list.length + ' of ' + DATA.board_size + ' protocols shown';
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'Nothing matches that filter' }),
        el('p', { text: 'Loosen the search, category, chain or TVL filter to see the board again.' }),
        el('button', { class: 'primary', type: 'button', text: 'Clear all filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.wlOnly = false; writeHash(); render(); } })));
    }
    var maxImp = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; }));
    var maxTvl = Math.max.apply(null, list.map(function (r) { return r.tvl_usd; }));
    var tbody = el('tbody');
    list.forEach(function (r) {
      var trendCls = r.change_7d === null ? 'flat' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0' },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.slice(0, 3).join(', ') || 'unnamed chain') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
          r.watchlist ? el('span', { class: 'wl', text: 'WATCHLIST' }) : null)),
        el('td', null, el('div', { class: 'bar tvl' }, el('i', { style: 'width:' + Math.max(3, Math.round(r.tvl_usd / maxTvl * 100)) + '%' })), el('span', { class: 'num', text: fmtUsd(r.tvl_usd) })),
        el('td', null, el('span', { class: 'pill ' + trendCls, text: fmtPct(r.change_7d) })),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'num', text: r.peer_multiple.toFixed(2) + 'x' }), el('span', { class: 'sub', text: ' · ' + r.peer_count + ' peers' })),
        el('td', null, el('span', { class: 'conf ' + r.confidence, text: r.confidence })),
        el('td', null, el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(3, Math.round(r.implied_value_usd / maxImp * 100)) + '%' })), el('b', { class: 'num', text: fmtUsd(r.implied_value_usd) })));
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } });
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols ranked by peer-priced implied value. Select any row for its full valuation breakdown, launch signals and farm plan.' }),
        el('thead', null, el('tr', null,
          el('th', { text: '#' }), el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: '7d trend' }),
          el('th', { text: 'Age, no token' }), el('th', { text: 'Peer multiple' }), el('th', { text: 'Confidence' }), el('th', { text: 'Implied value' }))),
        tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.slice(0, 2).join(', ')) }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, el('span', { class: 'pill ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.tvl_usd > 0 && r.mcap_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'The peer set: protocols that already trade. Their real mcap / TVL ratios are the raw material of the peer multiples on the board. They are never ranked as farm targets.' }),
        el('thead', null, el('tr', null, el('th', { text: 'Status' }), el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: '7d' }), el('th', { text: 'Market cap' }), el('th', { text: 'Mcap / TVL' }), el('th', { text: 'Token' }))),
        tbody)));
  }
  function renderTableOnly() {
    tableHost.textContent = '';
    tableHost.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
  }

  var dialog = el('dialog', { class: 'detail' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function signal(label, value) { return el('span', { class: 'sig' }, label + ' ', el('b', { text: value })); }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug; writeHash();
    var trend = row.change_7d === null ? 'unreported' : row.change_7d >= 5 ? 'accelerating' : row.change_7d >= 0 ? 'growing' : row.change_7d >= -10 ? 'cooling' : 'contracting';
    var why = [];
    if (row.watchlist) why.push('On the house watchlist: at least ' + fmtUsd(DATA.floor_usd) + ' TVL with no token on record.');
    else why.push('An early find below the watchlist floor, ranked here because its peer-priced value still clears the board.');
    why.push('Its ' + (row.category || 'uncategorised') + ' peers trade at a median multiple that shrinks to ' + row.peer_multiple.toFixed(2) + 'x from ' + row.peer_count + ' tokenised protocols (' + row.confidence + ' confidence).');
    why.push('TVL trend is ' + trend + ' at ' + fmtPct(row.change_7d) + ' over seven days, and it has run ' + fmtAge(row.age_days) + ' with no token on record across ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + '.');
    dialog.textContent = '';
    var steps = row.farm_steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
    });
    dialog.appendChild(el('div', { class: 'detail-in' },
      el('div', { class: 'detail-head' },
        el('div', null, el('span', { class: 'sub', text: 'Rank #' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · WATCHLIST' : ' · EARLY FIND') }),
          el('h2', { text: row.name }),
          el('span', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.join(', ') || 'unnamed chain') })),
        el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })),
      el('div', { class: 'signals' },
        signal('Trend:', trend + ' ' + fmtPct(row.change_7d)),
        signal('Age:', fmtAge(row.age_days)),
        signal('Chains:', String(row.chains.length)),
        signal('Confidence:', row.confidence)),
      el('h3', { text: 'Why it ranks here' }),
      el('p', { class: 'note', text: why.join(' ') }),
      el('h3', { text: 'Implied value, step by step' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple' }), el('b', { class: 'num', text: row.peer_multiple.toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: row.growth_multiplier.toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: row.maturity_multiplier.toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'Chain spread' }), el('b', { class: 'num', text: row.chain_multiplier.toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'Implied launch value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))),
      el('p', { class: 'note', text: 'Implied value is this entry\u2019s own model claim about what a launch would be worth if the record stayed as it is. It is not a prediction that a token will be issued, and not a price.' }),
      el('h3', { text: 'Farm plan: ' + row.farm_steps.length + ' steps' }),
      el('ol', { class: 'steps' }, steps)));
    if (!dialog.isConnected) document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(method());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    tableHost = el('div');
    shell.appendChild(tableHost);
    shell.appendChild(el('footer', { text: 'Source: ' + DATA.source + ' · Snapshot ' + DATA.as_of + ' · Implied values are model estimates by this dashboard, not statements by make.fun or DefiLlama. A protocol listed here records no token in the snapshot; that is not proof it has none.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    renderTableOnly();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
})();
