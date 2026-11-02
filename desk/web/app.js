'use strict';
// remimon: live on-chain activity for Remilia collections, served by the %remimon agent.

const API = '/apps/remimon/api';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const IMG = {
  milady: (id) => `https://www.miladymaker.net/milady/${id}.png`,
  remilio: (id) => `https://remilio.org/remilio/${id}.png`,
  radbro: (id) => `https://radbro.xyz/api/tokens/images/${id}.png`,
  yayo: (id) => `https://yayo.fund/yayo_nft/${id}.png`,
};
// collections whose image URL isn't derivable from the id: read it from the token metadata once
const META = {
  schizo: (id) => `https://schizoposters.xyz/api/tokens/metadata/${id}`,
};
// one color per collection, in this fixed order (dataviz validator: all checks pass on the dark panel)
const COLL_COLORS = ['#2f95bd', '#d45a90', '#b08a00', '#8a6fd6', '#3fa66b'];
const VENUE = {
  'OpenSea': { c: 'var(--v-opensea)', label: 'OpenSea listing' },
  'OpenSea offer': { c: 'var(--v-opensea)', label: 'OpenSea offer', ring: true },
  'Blur': { c: 'var(--v-blur)', label: 'Blur' },
  'Blend': { c: 'var(--v-blend)', label: 'Blend (locked)' },
};
const KNOWN = {
  '0x29469395eaf6f95920e59f858042f0e28d98a20b': 'Blend',
  '0x0000000000a39bb272e79075ade125fd351887ac': 'Blur Pool',
  '0xb2ecfe4e4d61f8790bbb9de2d1259b9e2410cea5': 'Blur',
  '0x0000000000000068f116a894984e2db1123eb395': 'Seaport',
  '0x000000000000000000000000000000000000dead': 'burn',
  '0x0000000000000000000000000000000000000000': 'null',
};
const KIND = { sale: 'sale', move: 'transfer', loan: 'loan', repay: 'repaid', seize: 'seized', mint: 'mint', burn: 'burn' };

// act arrays from the agent: [hash, coll, id, from, to, kind, venue, gwei, at, block, idx]
const A = (r) => ({ hash: r[0], coll: r[1], id: r[2], from: r[3], to: r[4], kind: r[5], venue: r[6], eth: r[7] / 1e9, at: r[8], block: r[9], idx: r[10] });

let S = null;               // last /state
let acts = [], sales = [];  // decoded
let coll = load('coll', 'all');
let range = +load('range', 7);
let kind = load('kind', 'all');
let settings = { watch: [], below: {} };
let lastSeen = +load('lastSeen', 0);

function load(k, d) { try { const v = localStorage.getItem('remimon.' + k); return v == null ? d : v; } catch { return d; } }
function save(k, v) { try { localStorage.setItem('remimon.' + k, v); } catch {} }

// ---------------------------------------------------------------- formatting

const collName = (c) => c === 'all' ? 'All collections' : (S?.collections.find((x) => x.key === c)?.name) || c;
// shorter names where space is tight (header pills, All-view tiles)
const SHORT = { schizo: 'Schizo' };
const shortName = (c) => SHORT[c] || collName(c);
const collAddr = (c) => S?.collections.find((x) => x.key === c)?.addr;
const fmtEth = (e) => e >= 100 ? e.toFixed(0) : e >= 10 ? e.toFixed(1) : e >= 1 ? e.toFixed(2) : e.toFixed(3);
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
const when = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function sigil(p, size) {
  const n = p.replace(/[~-]/g, '').length / 3;
  if (typeof window.urbitSigil !== 'function' || ![1, 2, 4].includes(n)) return '';
  try { return `<span class="sig">${window.urbitSigil({ point: p, size, foreground: '#0b0b0b', background: '#ffd60a', space: 'default' })}</span>`; } catch { return ''; }
}
function who(addr) {
  const ships = S.names[addr];
  if (ships && ships.length) return `<span class="who ship" data-addr="${addr}" title="${addr}">${sigil(ships[0], 14)}${esc(ships[0])}${ships.length > 1 ? ` +${ships.length - 1}` : ''}</span>`;
  if (KNOWN[addr]) return `<span class="who" data-addr="${addr}" title="${addr}">${KNOWN[addr]}</span>`;
  return `<span class="who" data-addr="${addr}">${short(addr)}</span>`;
}
const imgCache = {}, imgPending = new Set();
function img(c, id) {
  if (IMG[c]) return IMG[c](id);
  const k = c + ':' + id;
  if (imgCache[k]) return imgCache[k];
  const v = load('img.' + k, null);
  if (v) return (imgCache[k] = v);
  resolveImg(c, id);
  return '';
}
const ipfs = (u) => {
  const m = u.match(/^https:\/\/([a-z0-9]+)\.ipfs\.[^/]+\/(.*)$/) || u.match(/^ipfs:\/\/(?:ipfs\/)?([^/]+)\/?(.*)$/);
  return m ? `https://ipfs.filebase.io/ipfs/${m[1]}/${m[2]}` : u;
};
async function resolveImg(c, id) {
  const k = c + ':' + id;
  if (!META[c] || imgPending.has(k) || imgPending.size > 40) return;
  imgPending.add(k);
  try {
    const j = await (await fetch(META[c](id))).json();
    const u = ipfs(j.image || '');
    if (u) { imgCache[k] = u; save('img.' + k, u); document.querySelectorAll(`img[data-img="${k}"]`).forEach((e) => { e.src = u; }); }
  } catch {}
  imgPending.delete(k);
}
const imgAttr = (c, id) => `src="${img(c, id)}" data-img="${c}:${id}"`;
const collColor = (c) => COLL_COLORS[Math.max(0, (S?.collections || []).findIndex((x) => x.key === c)) % COLL_COLORS.length];

// ---------------------------------------------------------------- data

async function refresh() {
  try {
    const r = await fetch(API + '/state', { credentials: 'include' });
    if (!r.ok) throw new Error(r.status);
    S = await r.json();
  } catch (e) {
    $('sync').innerHTML = `<i class="dot bad"></i>can't reach your ship`;
    return;
  }
  acts = S.acts.map(A);
  sales = S.sales.map(A).sort((a, b) => a.at - b.at);
  if (S.settings && typeof S.settings === 'object') settings = { watch: [], below: {}, ...S.settings };
  alerts();
  render();
}

async function saveSettings() {
  try { await fetch(API + '/settings', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) }); } catch {}
}

// ---------------------------------------------------------------- watchlist & alerts

function watched(a) {
  return settings.watch.some((w) =>
    (w.t === 'token' && w.c === a.coll && w.id === a.id) ||
    (w.t === 'addr' && (w.a === a.from || w.a === a.to)) ||
    (w.t === 'ship' && [a.from, a.to].some((x) => (S.names[x] || []).includes(w.p))));
}
function alertWorthy(a) {
  if (watched(a)) return true;
  const lim = +settings.below[a.coll];
  return a.kind === 'sale' && lim > 0 && a.eth > 0 && a.eth < lim;
}
function alerts() {
  const newest = acts.length ? acts[0].block : 0;
  if (!lastSeen) { lastSeen = newest; save('lastSeen', lastSeen); return; }
  const fresh = acts.filter((a) => a.block > lastSeen && alertWorthy(a));
  if (newest > lastSeen) { lastSeen = newest; save('lastSeen', lastSeen); }
  if (!fresh.length || !('Notification' in window) || Notification.permission !== 'granted') return;
  for (const a of fresh.slice(0, 5)) {
    const title = `${collName(a.coll)} #${a.id} ${KIND[a.kind] || a.kind}${a.eth ? ' · ' + fmtEth(a.eth) + ' ETH' : ''}`;
    try { new Notification(title, { body: a.venue || '', icon: img(a.coll, a.id), tag: a.hash + a.idx }); } catch {}
  }
}
function parseWatch(q) {
  q = q.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return { t: 'addr', a: q.toLowerCase() };
  if (/^~[a-z-]+$/.test(q)) return { t: 'ship', p: q };
  const m = q.match(/^#?(\d{1,5})$/);
  if (m) return coll === 'all' ? null : { t: 'token', c: coll, id: +m[1] };
  return null;
}
const watchKey = (w) => JSON.stringify(w);
const watchLabel = (w) => w.t === 'token' ? `${collName(w.c)} #${w.id}` : w.t === 'ship' ? w.p : short(w.a);
function toggleWatch(w) {
  const k = watchKey(w);
  const i = settings.watch.findIndex((x) => watchKey(x) === k);
  if (i >= 0) settings.watch.splice(i, 1); else settings.watch.push(w);
  saveSettings(); render();
}
const isWatched = (w) => settings.watch.some((x) => watchKey(x) === watchKey(w));

// ---------------------------------------------------------------- render

function render() {
  if (!S) return;
  renderSync(); renderColls(); renderStats(); renderChart(); renderFeed(); renderShips(); renderWatch();
}

function renderSync() {
  const heads = Object.values(S.heads);
  const behind = heads.length ? Math.max(...heads.map((h) => S.latest - 2 - h)) : 1;
  const start = S.latest - S.backfill;
  const pct = heads.length ? Math.min(...heads.map((h) => (h - start) / S.backfill)) : 0;
  let txt, cls = '';
  if (S.error && !heads.length) { txt = S.error; cls = 'bad'; }
  else if (behind > 50) { txt = `syncing history ${Math.floor(pct * 100)}%`; cls = 'busy'; }
  else if (S.queue > 0) { txt = `reading ${S.queue} transactions`; cls = 'busy'; }
  else txt = `live · block ${S.latest.toLocaleString()}`;
  $('sync').innerHTML = `<i class="dot ${cls}"></i>${esc(txt)}`;
  $('sync').title = S.error || '';
}

function renderColls() {
  if (coll !== 'all' && !S.collections.some((c) => c.key === coll)) coll = 'all';
  $('colls').innerHTML = `<button data-c="all" class="all ${coll === 'all' ? 'on' : ''}">All</button>` + S.collections.map((c) => {
    const last = sales.filter((s) => s.coll === c.key).at(-1);
    return `<button data-c="${c.key}" class="${c.key === coll ? 'on' : ''}"><img ${last ? imgAttr(c.key, last.id) : 'src=""'} alt="">${esc(shortName(c.key))}</button>`;
  }).join('');
  $('alertrule').hidden = coll === 'all';
  $('alerthint').hidden = coll !== 'all';
  $('alertcoll').textContent = collName(coll);
  const b = settings.below[coll];
  if (document.activeElement !== $('below')) $('below').value = b || '';
}

function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function renderStats() {
  if (coll === 'all') return renderAllStats();
  const now = Date.now(), D = 86400e3;
  const cs = sales.filter((s) => s.coll === coll);
  const in1 = cs.filter((s) => s.at > now - D), in7 = cs.filter((s) => s.at > now - 7 * D), in30 = cs.filter((s) => s.at > now - 30 * D);
  const vol = (xs) => xs.reduce((t, s) => t + s.eth, 0);
  const last = cs.at(-1);
  const loans7 = acts.filter((a) => a.coll === coll && a.kind === 'loan' && a.at > now - 7 * D).length;
  const low = in1.length ? Math.min(...in1.map((s) => s.eth)) : null;
  const tile = (k, v, s) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('stats').innerHTML =
    (last ? `<div class="tile last" data-tok="${last.id}"><img ${imgAttr(coll, last.id)} alt=""><div style="min-width:0"><div class="k">Last sale</div><div class="v">${fmtEth(last.eth)} <small>ETH</small></div><div class="s">#${last.id} · ${esc(last.venue)} · ${ago(last.at)} ago</div></div></div>`
      : tile('Last sale', '—', 'none in the window yet')) +
    tile('Low sale · 24h', low == null ? '—' : `${fmtEth(low)} <small>ETH</small>`, 'a floor estimate from sales') +
    tile('Median · 7d', in7.length ? `${fmtEth(median(in7.map((s) => s.eth)))} <small>ETH</small>` : '—', `${in7.length} sales`) +
    tile('Volume · 24h', `${fmtEth(vol(in1))} <small>ETH</small>`, `${in1.length} sales`) +
    tile('Volume · 7d', `${fmtEth(vol(in7))} <small>ETH</small>`, `${loans7} Blend loans opened`) +
    tile('Volume · 30d', `${fmtEth(vol(in30))} <small>ETH</small>`, `${in30.length} sales`);
}

function renderAllStats() {
  const now = Date.now(), D = 86400e3;
  const vol = (xs) => xs.reduce((t, s) => t + s.eth, 0);
  const in1 = sales.filter((s) => s.at > now - D), in7 = sales.filter((s) => s.at > now - 7 * D);
  $('stats').innerHTML = `<div class="tile"><div class="k">All · 24h</div><div class="v">${fmtEth(vol(in1))} <small>ETH</small></div><div class="s">${in1.length} sales · ${fmtEth(vol(in7))} ETH this week</div></div>` +
    S.collections.map((c) => {
      const cs = sales.filter((s) => s.coll === c.key);
      const c1 = cs.filter((s) => s.at > now - D), c7 = cs.filter((s) => s.at > now - 7 * D);
      const last = cs.at(-1);
      return `<div class="tile ctile" data-c="${c.key}"><div class="k"><i style="background:${collColor(c.key)}"></i>${esc(shortName(c.key))}</div>
        <div class="v">${c7.length ? fmtEth(median(c7.map((s) => s.eth))) : '—'} <small>ETH</small></div>
        <div class="s" title="7-day median sale · sales in the last 24h">median · ${c1.length} today</div></div>`;
    }).join('');
}

// ---------------------------------------------------------------- chart

let pts = [];
function renderChart() {
  if (coll === 'all') return renderVolume();
  const svg = $('svg'), box = $('chart').getBoundingClientRect();
  const W = box.width, H = box.height;
  $('charttitle').textContent = `${collName(coll)} sales`;
  document.querySelectorAll('#ranges button').forEach((b) => b.classList.toggle('on', +b.dataset.r === range));
  const t1 = Date.now(), t0 = t1 - range * 86400e3;
  const cs = sales.filter((s) => s.coll === coll && s.at >= t0);
  const venues = [...new Set(cs.map((s) => s.venue))].filter((v) => VENUE[v]);
  $('legend').innerHTML = Object.entries(VENUE).filter(([v]) => venues.includes(v))
    .map(([, m]) => `<span><i class="${m.ring ? 'ring' : ''}" style="background:${m.c};border-color:${m.c}"></i>${m.label}</span>`).join('') +
    (cs.length > 4 ? `<span><i class="line"></i>rolling median</span>` : '');
  if (!cs.length || W < 50) { svg.innerHTML = ''; pts = []; $('chartnote').textContent = cs.length ? '' : `No ${collName(coll)} sales in this range yet.`; return; }
  // y: clamp to the 2nd–98th percentile so one fat-finger doesn't flatten everything
  const ps = cs.map((s) => s.eth).sort((a, b) => a - b);
  const q = (f) => ps[Math.min(ps.length - 1, Math.max(0, Math.round(f * (ps.length - 1))))];
  let lo = q(0.02), hi = q(0.98);
  if (hi - lo < hi * 0.1) { lo = lo * 0.9; hi = hi * 1.1; }
  const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi = hi + pad;
  const L = 52, R = 10, T = 8, B = 22;
  const x = (t) => L + (t - t0) / (t1 - t0) * (W - L - R);
  const y = (p) => T + (1 - (Math.min(hi, Math.max(lo, p)) - lo) / (hi - lo)) * (H - T - B);
  const ticks = niceTicks(lo, hi, 5);
  let g = `<g class="grid">${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>`;
  g += `<g class="axis">${ticks.map((v) => `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtEth(v)}</text>`).join('')}`;
  const nx = Math.max(2, Math.floor((W - L) / 110));
  for (let i = 0; i <= nx; i++) {
    const t = t0 + (t1 - t0) * i / nx;
    const lab = range <= 1 ? new Date(t).toLocaleTimeString(undefined, { hour: 'numeric' }) : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    g += `<text x="${x(t)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}">${lab}</text>`;
  }
  g += `<text x="${L - 8}" y="${T - 0}" text-anchor="end" dy="-2" opacity=".7">ETH</text></g>`;
  // rolling median of the last 9 sales
  if (cs.length > 4) {
    const line = cs.map((s, i) => [x(s.at), y(median(cs.slice(Math.max(0, i - 8), i + 1).map((z) => z.eth)))]);
    g += `<path class="med" d="M${line.map((p) => p.map((n) => n.toFixed(1)).join(',')).join('L')}"/>`;
  }
  pts = cs.map((s) => ({ s, x: x(s.at), y: y(s.eth) }));
  g += `<line id="cross" class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
  g += pts.map((p, i) => { const m = VENUE[p.s.venue] || { c: 'var(--muted)' };
    return `<circle class="d${m.ring ? ' ring' : ''}" data-i="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" style="fill:${m.c};${m.ring ? 'stroke:' + m.c : ''}"/>`; }).join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g;
  const clipped = cs.filter((s) => s.eth > hi || s.eth < lo).length;
  $('chartnote').textContent = `${cs.length} sales${clipped ? ` · ${clipped} outlier${clipped > 1 ? 's' : ''} pinned to the edge` : ''} · prices include marketplace fees · click a dot for the token`;
}
// all collections: volume per day (per hour on 24h), stacked by collection
let bars = [];
function renderVolume() {
  const svg = $('svg'), box = $('chart').getBoundingClientRect();
  const W = box.width, H = box.height;
  document.querySelectorAll('#ranges button').forEach((b) => b.classList.toggle('on', +b.dataset.r === range));
  const hourly = range <= 1, step = hourly ? 3600e3 : 86400e3;
  $('charttitle').textContent = `Volume per ${hourly ? 'hour' : 'day'}`;
  const end = hourly ? Math.ceil(Date.now() / step) * step : (() => { const d = new Date(); d.setHours(24, 0, 0, 0); return +d; })();
  const n = hourly ? 24 : range;
  const start = end - n * step;
  const keys = S.collections.map((c) => c.key);
  const bins = Array.from({ length: n }, (_, i) => ({ t: start + i * step, v: Object.fromEntries(keys.map((k) => [k, 0])), c: Object.fromEntries(keys.map((k) => [k, 0])) }));
  for (const s of sales) { const i = Math.floor((s.at - start) / step); if (i >= 0 && i < n && s.coll in bins[i].v) { bins[i].v[s.coll] += s.eth; bins[i].c[s.coll]++; } }
  const tot = (b) => keys.reduce((t, k) => t + b.v[k], 0);
  const max = Math.max(0.0001, ...bins.map(tot));
  $('legend').innerHTML = S.collections.map((c) => `<span><i style="background:${collColor(c.key)}"></i>${esc(c.name)}</span>`).join('');
  const L = 52, R = 10, T = 8, B = 22;
  const ticks = niceTicks(0, max * 1.05, 4), hi = Math.max(max * 1.05, ticks.at(-1));
  const y = (v) => T + (1 - v / hi) * (H - T - B);
  const bw = (W - L - R) / n, gap = Math.min(6, bw * 0.25);
  let g = `<g class="grid">${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g><g class="axis">`;
  g += ticks.map((v) => `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtEth(v)}</text>`).join('');
  const every = Math.ceil(n / Math.max(2, Math.floor((W - L) / 70)));
  bins.forEach((b, i) => { if (i % every === 0) g += `<text x="${L + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${hourly ? new Date(b.t).toLocaleTimeString(undefined, { hour: 'numeric' }) : new Date(b.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>`; });
  g += `<text x="${L - 8}" y="${T}" text-anchor="end" dy="-2" opacity=".7">ETH</text></g>`;
  bars = [];
  bins.forEach((b, i) => {
    let acc = 0; const x0 = L + i * bw + gap / 2, w = Math.max(1, bw - gap);
    keys.forEach((k) => {
      if (!b.v[k]) return;
      const y1 = y(acc), y2 = y(acc + b.v[k]); acc += b.v[k];
      const h = Math.max(1, y1 - y2 - 2);   // 2px surface gap between stacked segments
      g += `<rect x="${x0.toFixed(1)}" y="${(y1 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, w / 4)}" fill="${collColor(k)}"/>`;
    });
    bars.push({ b, x0, w, top: y(acc) });
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g;
  pts = [];
  const total = bins.reduce((t, b) => t + tot(b), 0);
  $('chartnote').textContent = `${fmtEth(total)} ETH across ${bins.reduce((t, b) => t + keys.reduce((u, k) => u + b.c[k], 0), 0)} sales · hover a bar for the split · pick a collection for its price chart`;
}
function volTip(ev) {
  const r = $('chart').getBoundingClientRect(), mx = ev.clientX - r.left;
  const bar = bars.find((b) => mx >= b.x0 - 2 && mx <= b.x0 + b.w + 2);
  const tip = $('tip');
  if (!bar) { tip.hidden = true; return; }
  const { b } = bar, hourly = range <= 1;
  const lines = S.collections.filter((c) => b.c[c.key]).map((c) => `<span style="display:flex;gap:6px;align-items:center"><i style="width:8px;height:8px;border-radius:50%;background:${collColor(c.key)}"></i>${esc(c.name)} <b style="font-size:12px;margin-left:auto;padding-left:10px">${fmtEth(b.v[c.key])}</b><span style="color:var(--muted)">· ${b.c[c.key]}</span></span>`);
  tip.innerHTML = `<div><b>${hourly ? new Date(b.t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' }) : new Date(b.t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</b><br>${lines.join('') || '<span style="color:var(--muted)">no sales</span>'}</div>`;
  tip.hidden = false;
  tip.style.left = Math.min(r.width - tip.offsetWidth, Math.max(0, bar.x0 + bar.w + 8)) + 'px';
  tip.style.top = Math.max(0, bar.top - 20) + 'px';
}

function niceTicks(lo, hi, n) {
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function nearest(ev) {
  const r = $('chart').getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  let best = null, bd = 18 * 18;
  for (const p of pts) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p; } }
  return { best, mx, r };
}
$('chart').addEventListener('mousemove', (ev) => {
  if (coll === 'all') return volTip(ev);
  const { best, r } = nearest(ev);
  const tip = $('tip'), cross = $('cross');
  document.querySelectorAll('#svg circle.hot').forEach((c) => c.classList.remove('hot'));
  if (!best) { tip.hidden = true; cross?.setAttribute('visibility', 'hidden'); return; }
  const s = best.s;
  document.querySelector(`#svg circle[data-i="${pts.indexOf(best)}"]`)?.classList.add('hot');
  cross.setAttribute('x1', best.x); cross.setAttribute('x2', best.x); cross.setAttribute('visibility', 'visible');
  tip.innerHTML = `<img ${imgAttr(s.coll, s.id)} alt=""><div><b>${fmtEth(s.eth)} ETH</b><br>${esc(collName(s.coll))} #${s.id}<br><span style="color:var(--muted)">${esc((VENUE[s.venue] || {}).label || s.venue)} · ${when(s.at)}</span></div>`;
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.min(r.width - tw, Math.max(0, best.x + 12)) + 'px';
  tip.style.top = Math.max(0, best.y - th - 10) + 'px';
});
$('chart').addEventListener('mouseleave', () => { $('tip').hidden = true; $('cross')?.setAttribute('visibility', 'hidden'); });
$('chart').addEventListener('click', (ev) => { const { best } = nearest(ev); if (best) openToken(best.s.coll, best.s.id); });

// ---------------------------------------------------------------- feed

function row(a) {
  const k = KIND[a.kind] || a.kind;
  const price = a.eth ? `<span class="p">${fmtEth(a.eth)} Ξ</span>` : `<span class="p" style="color:var(--faint)">—</span>`;
  let l2;
  if (a.kind === 'mint') l2 = `minted to ${who(a.to)}`;
  else if (a.kind === 'burn') l2 = `burned by ${who(a.from)}`;
  else if (a.kind === 'loan') l2 = `${who(a.from)} borrowed against it`;
  else if (a.kind === 'repay') l2 = `back to ${who(a.to)}`;
  else if (a.kind === 'seize') l2 = `seized by ${who(a.to)}`;
  else l2 = `${who(a.from)} → ${who(a.to)}`;
  return `<div class="row${watched(a) ? ' watched' : ''}">
    <img class="t" loading="lazy" ${imgAttr(a.coll, a.id)} alt="" data-tok="${a.id}" data-c="${a.coll}">
    <div style="min-width:0"><div class="l1"><span class="nm" data-tok="${a.id}" data-c="${a.coll}">${esc(collName(a.coll))} #${a.id}</span><span class="badge ${a.kind}">${k}</span>${a.venue && a.kind === 'sale' ? `<span class="note">${esc(a.venue)}</span>` : ''}</div>
    <div class="l2">${l2}</div></div>
    <div class="r">${price}<span class="when"><a href="https://etherscan.io/tx/${a.hash}" target="_blank" rel="noopener" title="${when(a.at)}">${ago(a.at)} ↗</a></span></div>
  </div>`;
}
function renderFeed() {
  document.querySelectorAll('#kinds button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
  let xs = coll === 'all' ? acts : acts.filter((a) => a.coll === coll);
  if (kind === 'sale') xs = xs.filter((a) => a.kind === 'sale');
  else if (kind === 'loan') xs = xs.filter((a) => ['loan', 'repay', 'seize'].includes(a.kind));
  else if (kind === 'move') xs = xs.filter((a) => ['move', 'mint', 'burn'].includes(a.kind));
  else if (kind === 'watch') xs = xs.filter(watched);
  const feed = $('feed'), top = feed.scrollTop;
  feed.innerHTML = xs.length ? xs.slice(0, 250).map(row).join('') :
    `<div class="empty">${kind === 'watch' ? 'Nothing from your watchlist in recent activity.' : 'No activity yet. The first sync reads about 30 days of history.'}</div>`;
  feed.scrollTop = top;
}

// ---------------------------------------------------------------- urbit ids

function renderShips() {
  const seen = new Map();
  for (const a of [...acts, ...sales]) seen.set(a.hash + ':' + a.idx, a);
  const by = {};
  for (const a of seen.values()) {
    for (const [addr, role] of [[a.to, 'in'], [a.from, 'out']]) {
      const ships = S.names[addr]; if (!ships) continue;
      const e = by[addr] || (by[addr] = { addr, ships, buys: 0, sells: 0, moves: 0, last: 0 });
      if (a.kind === 'sale') role === 'in' ? e.buys++ : e.sells++; else e.moves++;
      e.last = Math.max(e.last, a.at);
    }
  }
  const list = Object.values(by).sort((a, b) => b.last - a.last);
  $('shipct').textContent = list.length ? `${list.length} wallet${list.length > 1 ? 's' : ''} own Urbit IDs` : '';
  $('ships').innerHTML = list.length ? list.map((e) => {
    const bits = [e.buys && `${e.buys} bought`, e.sells && `${e.sells} sold`, e.moves && `${e.moves} other`].filter(Boolean).join(' · ');
    return `<div class="shipc" data-addr="${e.addr}">${sigil(e.ships[0], 28)}<div style="min-width:0"><div class="nm">${esc(e.ships[0])}${e.ships.length > 1 ? ` <span class="ct">+${e.ships.length - 1}</span>` : ''}</div><div class="ct">${bits} · ${ago(e.last)} ago</div></div></div>`;
  }).join('') : `<div class="empty" style="padding:6px 0">No wallets in this activity own an Urbit ID yet. Owners are matched against your ship's Azimuth state.</div>`;
}

function renderWatch() {
  $('watches').innerHTML = settings.watch.length ? settings.watch.map((w, i) =>
    `<span class="chip"><span data-w="${i}">${w.t === 'ship' ? sigil(w.p, 14) : ''} ${esc(watchLabel(w))}</span><button data-unw="${i}" aria-label="Stop watching">✕</button></span>`).join('')
    : `<span class="note">Watch a token, wallet or ship to highlight it in the feed and get alerts.</span>`;
  const n = $('notify');
  if (!('Notification' in window)) n.hidden = true;
  else if (Notification.permission === 'granted') { n.textContent = 'Notifications on (while this tab is open)'; n.disabled = true; }
}

// ---------------------------------------------------------------- drawer

async function find(q) {
  const r = await fetch(API + '/find?q=' + encodeURIComponent(q), { credentials: 'include' });
  return r.ok ? (await r.json()).map(A) : [];
}
function openDrawer(html) { $('dbody').innerHTML = html; $('drawer').hidden = false; $('dclose').focus(); }
function closeDrawer() { $('drawer').hidden = true; }

async function openToken(c, id) {
  const w = { t: 'token', c, id };
  const addr = collAddr(c);
  const head = () => `<div class="dhead"><img ${imgAttr(c, id)} alt=""><div><h3 id="dtitle">${esc(collName(c))} #${id}</h3>
    <button data-watch='${JSON.stringify(w)}'>${isWatched(w) ? '★ Watching' : '☆ Watch'}</button>
    <div class="links"><a href="https://opensea.io/assets/ethereum/${addr}/${id}" target="_blank" rel="noopener">OpenSea ↗</a><a href="https://blur.io/eth/asset/${addr}/${id}" target="_blank" rel="noopener">Blur ↗</a><a href="https://etherscan.io/nft/${addr}/${id}" target="_blank" rel="noopener">Etherscan ↗</a></div></div></div>`;
  openDrawer(head() + `<div class="empty">Loading history…</div>`);
  const hist = (await find(String(id))).filter((a) => a.coll === c);
  const ss = hist.filter((a) => a.kind === 'sale' && a.eth);
  const owner = hist[0]?.to;
  openDrawer(head() + `<div class="dstats"><div><b>${ss.length ? fmtEth(ss[0].eth) + ' Ξ' : '—'}</b>last sale</div><div><b>${ss.length}</b>sales seen</div><div><b>${owner ? who(owner) : '—'}</b>latest holder</div></div>
    <h2 style="margin:6px 0 6px">History</h2><div class="feed">${hist.length ? hist.map(row).join('') : '<div class="empty">No activity in the synced window.</div>'}</div>`);
}

async function openTokenAll(id) {
  openDrawer(`<h3 id="dtitle" class="mono">#${id} in every collection</h3><div class="empty">Loading…</div>`);
  const hist = await find(String(id));
  const cs = S.collections.filter((c) => hist.some((a) => a.coll === c.key));
  openDrawer(`<h3 id="dtitle" class="mono" style="margin:0 0 6px">#${id} in every collection</h3>
    <div class="note" style="margin-bottom:12px">Open one: ${S.collections.map((c) => `<a href="#" data-tok="${id}" data-c="${c.key}">${esc(c.name)}</a>`).join(' · ')}</div>
    <div class="feed">${hist.length ? hist.map(row).join('') : '<div class="empty">No activity for that id in the synced window.</div>'}</div>`);
}

async function openAddr(addr) {
  const ships = S.names[addr] || [];
  const w = ships.length ? { t: 'ship', p: ships[0] } : { t: 'addr', a: addr };
  const head = `<div class="dhead">${ships.length ? sigil(ships[0], 96) : ''}<div><h3 id="dtitle">${ships.length ? esc(ships[0]) : short(addr)}</h3>
    <div class="mono note" style="word-break:break-all">${addr}</div>
    ${ships.length > 1 ? `<div class="note">also owns ${ships.slice(1).map(esc).join(', ')}</div>` : ''}
    <div style="margin-top:8px"><button data-watch='${JSON.stringify(w)}'>${isWatched(w) ? '★ Watching' : '☆ Watch'}</button></div>
    <div class="links"><a href="https://etherscan.io/address/${addr}" target="_blank" rel="noopener">Etherscan ↗</a><a href="https://opensea.io/${addr}" target="_blank" rel="noopener">OpenSea ↗</a></div></div></div>`;
  openDrawer(head + `<div class="empty">Loading activity…</div>`);
  const hist = await find(addr);
  const bought = hist.filter((a) => a.kind === 'sale' && a.to === addr), sold = hist.filter((a) => a.kind === 'sale' && a.from === addr);
  const sum = (xs) => xs.reduce((t, a) => t + a.eth, 0);
  openDrawer(head + `<div class="dstats"><div><b>${bought.length}</b>bought · ${fmtEth(sum(bought))} Ξ</div><div><b>${sold.length}</b>sold · ${fmtEth(sum(sold))} Ξ</div><div><b>${hist.length}</b>events</div></div>
    <h2 style="margin:6px 0 6px">Activity</h2><div class="feed">${hist.length ? hist.map(row).join('') : '<div class="empty">No activity in the synced window.</div>'}</div>`);
}

async function openShip(p) {
  const addrs = Object.entries(S.names).filter(([, s]) => s.includes(p)).map(([a]) => a);
  if (addrs.length) return openAddr(addrs[0]);
  openDrawer(`<div class="dhead">${sigil(p, 96)}<div><h3 id="dtitle">${esc(p)}</h3><div class="note">This ship's owner address hasn't traded ${S.collections.map((c) => c.name).join(' or ')} in the synced window.</div>
    <div style="margin-top:8px"><button data-watch='${JSON.stringify({ t: 'ship', p })}'>${isWatched({ t: 'ship', p }) ? '★ Watching' : '☆ Watch'}</button></div></div></div>`);
}

// ---------------------------------------------------------------- events

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-c],[data-tok],[data-addr],[data-r],[data-k],[data-watch],[data-unw],[data-w]');
  if (!t) { if (ev.target === $('drawer')) closeDrawer(); return; }
  if (t.dataset.watch) { toggleWatch(JSON.parse(t.dataset.watch)); t.textContent = isWatched(JSON.parse(t.dataset.watch)) ? '★ Watching' : '☆ Watch'; return; }
  if (t.dataset.unw) { settings.watch.splice(+t.dataset.unw, 1); saveSettings(); render(); return; }
  if (t.dataset.w) { const w = settings.watch[+t.dataset.w]; if (w.t === 'token') openToken(w.c, w.id); else if (w.t === 'ship') openShip(w.p); else openAddr(w.a); return; }
  if (t.dataset.tok) { openToken(t.dataset.c || coll, +t.dataset.tok); return; }
  if (t.dataset.addr) { openAddr(t.dataset.addr); return; }
  if (t.dataset.c) { coll = t.dataset.c; save('coll', coll); render(); return; }
  if (t.dataset.r) { range = +t.dataset.r; save('range', range); renderChart(); return; }
  if (t.dataset.k) { kind = t.dataset.k; save('kind', kind); renderFeed(); return; }
});
$('dclose').onclick = closeDrawer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
$('search').onsubmit = (e) => {
  e.preventDefault();
  const w = parseWatch($('q').value);
  if (!w) return;
  if (w.t === 'token') coll === 'all' ? openTokenAll(w.id) : openToken(coll, w.id); else if (w.t === 'ship') openShip(w.p); else openAddr(w.a);
};
$('watchform').onsubmit = (e) => {
  e.preventDefault();
  const w = parseWatch($('watchin').value);
  if (!w) { if (coll === 'all' && /^#?\d+$/.test($('watchin').value.trim())) $('watchin').placeholder = 'pick a collection to watch a token'; $('watchin').select(); return; }
  if (!isWatched(w)) toggleWatch(w);
  $('watchin').value = '';
};
$('below').onchange = () => { const v = parseFloat($('below').value); if (v > 0) settings.below[coll] = v; else delete settings.below[coll]; saveSettings(); };
$('notify').onclick = async () => { try { await Notification.requestPermission(); } catch {} renderWatch(); };
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderChart, 100); });

refresh();
setInterval(refresh, 20000);
setInterval(() => { if (S) { renderStats(); renderSync(); } }, 15000);
