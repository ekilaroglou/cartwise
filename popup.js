import { parseSkroutzSearch } from './lib/parser.js';
import { ORIGIN, PRODUCT_URL, BP_VER, OFFERS_VER, fetchShopsList as fetchOffers, getMeta, skFetch } from './lib/skroutz.js';
import { optimize } from './lib/optimizer.js';
import { t, count, setLang, defaultLang, applyStatic } from './lib/i18n.js';
import { findMatch, fetchOffers as fetchBpOffers, fetchItemMeta, titleCodes, parseItemLink, rank, evidence, sameModel, conflict } from './lib/bestprice.js';

const CACHE_TTL = 15 * 60 * 1000;
const HISTORY_MAX = 30;

const state = {
  // [{id, url, name, image, qty, mpn, brand}], or, for a product added from
  // BestPrice whose Skroutz twin is not settled yet, a placeholder
  // {id: 'bp<itemId>', name, bpItem: {id, url, name}, qty, searched, skCands}
  cart: [],
  // avail: 'any' | 'stock' | 'now'; maxDays: 0 (any) or a number of days
  settings: { hasPlus: false, delivery: 'point', bestprice: true, avail: 'any', maxDays: 0, cartHidden: false },
  long: {},                                   // result tab -> inputs it was asked to search longer for
  openTab: null,                              // result tab whose details are open (none when the popup opens)
  offers: {},                                 // id -> {ts, name, offers, titles}
  status: {},                                 // id -> 'loading' | 'error'
  bp: {},                                     // Skroutz id -> {v, item, candidates, confident, manual, auto, searched, offers, offersTs}
  bpStatus: {},                               // Skroutz id -> 'loading' | 'error'
  bpEdit: null,                               // Skroutz id whose BestPrice match is being changed
  bpPaste: null,                              // Skroutz id whose "paste a BestPrice link" box is open
  phStatus: {},                               // placeholder id -> 'loading' | 'error'
  history: [],                                // earlier versions of the cart, newest last (for Undo)
  currentTab: null,                           // {kind: 'sk'|'bp', id, url} when the active tab is a product page
  calcCache: {},                              // tab -> {key, result}: the last results, also for the next opening
  open: {},                                   // <details> key -> open, as the user left it
  bgLookups: {},                              // id -> start time, while the background looks the product up
  restored: [],                               // names of products the upgrade put back in the list (see load)
};

const $ = (id) => document.getElementById(id);
const isPh = (p) => String(p.id).startsWith('bp');

// ---------- tiny DOM helper (never uses innerHTML with page data) ----------
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const eur = (n) => n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const productUrl = (item) => (isPh(item) ? item.bpItem.url : item.url || `${ORIGIN}/s/${item.id}/p.html`);

// ---------- storage ----------
async function load() {
  const [data, session] = await Promise.all([
    chrome.storage.local.get(['cart', 'cartRev', 'settings', 'offers', 'history', 'bp', 'calc', 'cartJob', 'cartResult']),
    // products the background is looking up right now (added from a page a moment ago)
    chrome.storage.session.get('lookups').catch(() => ({})),
  ]);
  state.bgLookups = (session && session.lookups) || {};
  // An order that no Skroutz cart page took in time (3 minutes, see content.js),
  // or a summary that was not shown: no longer used, so deleted (PRIVACY.md).
  const unused = [];
  if (data.cartJob && !(Date.now() - data.cartJob.ts <= 3 * 60000)) unused.push('cartJob');
  if (data.cartResult && !(Date.now() - data.cartResult.ts <= 120000)) unused.push('cartResult');
  if (unused.length) chrome.storage.local.remove(unused);
  // results saved by this version (the calculation may differ in another)
  state.calcCache = (data.calc && data.calc.ver === chrome.runtime.getManifest().version && data.calc.tabs) || {};
  state.history = Array.isArray(data.history) ? data.history : [];
  state.cart = Array.isArray(data.cart) ? data.cart : [];
  synced = { rev: data.cartRev || 0, cart: copy(state.cart) };
  syncedMaps.offers = copy(data.offers || {});
  syncedMaps.bp = copy(data.bp || {});
  // the products' names, also of those Undo can bring back (for checking old matches)
  const names = {};
  for (const list of [state.cart, ...[...state.history].reverse()]) for (const p of list) names[p.id] ??= p.name;
  state.bp = {};
  const back = new Map(); // product id -> the BestPrice product to put back in its place
  let older = false;
  for (const [id, rec] of Object.entries(data.bp || {})) {
    if (!rec) continue;
    if (rec.v === BP_VER) { state.bp[id] = rec; continue; }
    older = true;
    if (!(rec.v < BP_VER)) continue; // from a newer version: left as it is
    const r = rec.v >= 3 ? oldMatch(id, rec, names[id]) : { rec: null, back: null };
    if (r.rec) state.bp[id] = r.rec;
    else dropped.bp.add(id); // looked for again: the old match goes from storage too
    if (r.back) back.set(id, r.back);
  }
  // A Skroutz product that may have replaced one added from BestPrice, which
  // today's rules call a different model. When the list knows the replacement
  // was automatic (`origin`, kept since 1.13.3), the BestPrice product simply
  // comes back, to be matched again (Undo brings the other back). Lists saved
  // earlier cannot tell an automatic replacement from a product the user added
  // or picked: then the product's line asks the user, and it is not sent to
  // the Skroutz cart until they answer.
  state.restored = [];
  const placed = new Set(state.cart.map((p) => p.id));
  let asked = false;
  const list = state.cart.map((p) => {
    const b = back.get(p.id);
    if (!b || placed.has('bp' + b.id)) return p;
    if (!(p.origin && p.origin.auto)) { asked = true; return { ...p, review: b }; }
    placed.add('bp' + b.id);
    state.restored.push(b.name);
    return bpPlaceholder(b, p);
  });
  if (state.restored.length) remember();
  if (state.restored.length || asked) { state.cart = list; saveCart(); }
  // saved at once, so the page button on bestprice.gr and the background see the same
  if (older) saveBp();
  // "buy from a specific shop" was removed: forget choices saved by that version
  if (state.cart.some((p) => 'lock' in p)) {
    for (const p of state.cart) delete p.lock;
    saveCart();
  }

  Object.assign(state.settings, data.settings || {});
  state.offers = {};
  for (const [id, o] of Object.entries(data.offers || {})) {
    if (o && o.v === OFFERS_VER) state.offers[id] = o;
    else if (!(o && o.v > OFFERS_VER)) dropped.offers.add(id); // an older format: read again, and taken out of storage
  }
  fixNames();
}

/**
 * A BestPrice record saved by an older version, whose matching was looser.
 * Returns {rec, back}: what is kept of the record (null: the match is looked
 * for again with today's rules), and the BestPrice product to put back in the
 * list in place of this product (null: none). `skName`: this product's name.
 */
function oldMatch(id, rec, skName) {
  const named = !!skName && !/^Product \d+$/.test(skName);
  // Saved by 1.13.2, which already found its matches with today's rules. Its
  // upgrade asked about old pairs again ("not sure", the old match as the only
  // choice), but did not deal with the Skroutz product that an older version
  // may have put in place of one added from BestPrice: that is done now.
  if (rec.v === 6) {
    const was = !rec.item && rec.offers === null && rec.candidates && rec.candidates.length === 1 ? rec.candidates[0] : null;
    return { rec: { ...rec, v: BP_VER }, back: was && named ? was : null };
  }
  // found automatically: looked for again
  if (!rec.manual || !rec.item) return { rec: null, back: null };
  // version 3 prices lack stock and links, so they are read again
  const kept = { ...rec, v: BP_VER, ...(rec.v < 4 ? { offers: null, offersTs: 0 } : {}) };
  // a product added from BestPrice: the record is that product itself
  if (id.startsWith('bp')) return { rec: kept, back: null };
  const bpName = rec.item.name || '';
  if (!bpName || !named) return { rec: kept, back: null };
  // Not picked from a list of BestPrice candidates: the Skroutz product that an
  // older version found for one added from BestPrice (by itself, or picked by
  // the user), saved the same way as a match the user chose.
  const fromBp = !(rec.candidates && rec.candidates.length);
  if (conflict(skName, bpName) || (fromBp && !sameModel(skName, bpName))) {
    // Today's rules call them different products: the match is asked again
    // ("not sure", the old one as the choice). Its BestPrice prices are kept,
    // so a BestPrice product that comes back is priced at once (see load).
    const was = { id: rec.item.id, url: rec.item.url, name: bpName };
    const prices = rec.v >= 4 && rec.offers ? { wasOffers: rec.offers, wasOffersTs: rec.offersTs || 0 } : {};
    return { rec: { v: BP_VER, item: null, confident: false, searched: true, candidates: [was], offers: null, offersTs: 0, ...prices }, back: fromBp ? was : null };
  }
  return { rec: kept, back: null };
}

/**
 * The list entry for a product added from BestPrice ({id, url, name}) that
 * comes back in place of `p` (same quantity), to be matched with Skroutz again.
 * Until then it is priced from BestPrice, with the prices kept for it if any.
 */
function bpPlaceholder(b, p) {
  const phId = 'bp' + b.id;
  const old = state.bp[p.id] || {};
  if (!state.bp[phId]) {
    state.bp[phId] = {
      v: BP_VER, item: { id: b.id, url: b.url, name: b.name }, candidates: [], searched: true, confident: true, manual: true,
      offers: old.wasOffers || null, offersTs: old.wasOffersTs || 0,
    };
  }
  return { id: phId, name: b.name, bpItem: { id: b.id, url: b.url, name: b.name }, image: null, qty: p.qty || 1 };
}

/** "Keep this": the product stays; the user has checked it. */
function keepReviewed(id) {
  const p = state.cart.find((x) => x.id === id);
  if (!p || !p.review) return;
  remember();
  delete p.review;
  saveCart();
  render();
}

/** "Use the BestPrice one": the product added from BestPrice comes back in its place. */
function restoreReviewed(id) {
  const i = state.cart.findIndex((x) => x.id === id);
  if (i < 0 || !state.cart[i].review) return;
  const b = state.cart[i].review;
  remember();
  if (state.cart.some((x) => x.id === 'bp' + b.id)) state.cart.splice(i, 1); // already in the list
  else state.cart[i] = bpPlaceholder(b, state.cart[i]);
  saveCart();
  saveBp();
  render();
  resolvePh('bp' + b.id); // matched with Skroutz again, with today's rules
}

/**
 * What the background lookup read from a product's page (it saves it with the
 * prices, never in the list itself): a name for products still called
 * "Product <id>", a picture, and the part number and brand that the BestPrice
 * search uses (so the page is not read a second time).
 */
function fixNames() {
  let changed = false;
  for (const p of state.cart) {
    const o = state.offers[p.id];
    if (!o || isPh(p)) continue;
    if (o.name && (!p.name || p.name.startsWith('Product '))) { p.name = o.name; changed = true; }
    if (o.image && !p.image) { p.image = o.image; changed = true; }
    if (p.mpn === undefined && typeof o.mpn === 'string') {
      p.mpn = o.mpn;
      p.brand = o.brand || '';
      if (o.url) p.url = o.url;
      changed = true;
    }
  }
  if (changed) saveCart();
  return changed;
}

// Two places change the list: this window, and the background (for the page
// button). Each change is saved under one lock that both take, onto the list
// as it is stored at that moment, and counts up `cartRev`. So a change made
// here keeps what the background changed meanwhile, and the other way round;
// and this window tells its own saves (reported back by storage, sometimes
// late) from changes made elsewhere.
const CART_LOCK = 'cartwise-cart';
const withLock = (fn) => (navigator.locks ? navigator.locks.request(CART_LOCK, fn) : fn());
const canon = (cart) => JSON.stringify(cart, sortedFields);
const copy = (x) => JSON.parse(JSON.stringify(x));
let synced = { rev: 0, cart: [] }; // the stored list as this window last read or saved it

/** `mine` with the changes made elsewhere since `base` (which gave `theirs`). */
function mergeCart(base, mine, theirs) {
  const was = new Map(base.map((p) => [p.id, p]));
  const now = new Map(theirs.map((p) => [p.id, p]));
  const here = new Set(mine.map((p) => p.id));
  const out = [];
  for (const p of mine) {
    const b = was.get(p.id), t = now.get(p.id);
    if (b && !t) continue; // removed elsewhere
    // changed elsewhere and not here: that change
    out.push(b && t && canon(t) !== canon(b) && canon(p) === canon(b) ? t : p);
  }
  for (const t of theirs) if (!was.has(t.id) && !here.has(t.id)) out.push(t); // added elsewhere
  return out;
}

function saveCart() {
  return withLock(async () => {
    const { cart: stored, cartRev = 0 } = await chrome.storage.local.get(['cart', 'cartRev']);
    if (cartRev !== synced.rev) {
      // changed elsewhere since this window read it (the report may not have arrived yet)
      const merged = mergeCart(synced.cart, state.cart, Array.isArray(stored) ? stored : []);
      if (canon(merged) !== canon(state.cart)) { state.cart = merged; render(); loadAll(); }
    }
    const before = synced;
    const cart = copy(state.cart);
    synced = { rev: cartRev + 1, cart }; // before the save: its report must find it
    try {
      await chrome.storage.local.set({ cart, cartRev: cartRev + 1 });
    } catch (e) {
      synced = before;
      throw e;
    }
  });
}

/** Call right before changing the cart, so Undo can bring this version back. */
function remember() {
  const snap = copy(state.cart);
  state.history.push(snap);
  if (state.history.length > HISTORY_MAX) state.history.shift();
  // added to the history as it is stored now (the background adds to it too)
  withLock(async () => {
    const { history } = await chrome.storage.local.get('history');
    await chrome.storage.local.set({ history: (Array.isArray(history) ? history : []).concat([snap]).slice(-HISTORY_MAX) });
  });
}
const saveSettings = () => chrome.storage.local.set({ settings: state.settings });
// Prices (`offers`) and BestPrice matches (`bp`) are saved by this window and
// by the background (for a product added from a page). Both take the list's
// lock and merge, product by product: what this window changed since it last
// read or saved them goes in, and what changed elsewhere stays. When both
// changed the same product, the newer prices win (and a match the user chose).
const syncedMaps = { offers: {}, bp: {} }; // as stored when this window last read or saved them
// entries this window took out on purpose (saved by an older version, see load):
// taken out of storage too at the next save, unless changed elsewhere meanwhile
const dropped = { offers: new Set(), bp: new Set() };
const newer = {
  offers: (m, t) => ((t.ts || 0) > (m.ts || 0) ? t : m),
  bp: (m, t) => (m.manual ? m : t.manual ? t : (t.offersTs || 0) > (m.offersTs || 0) ? t : m),
};
/** `keep(stored)`: the products whose entries stay (those in the list, here or as stored). */
function saveMap(key, mine, keep) {
  return withLock(async () => {
    const stored = await chrome.storage.local.get([key, 'cart', 'history']);
    const theirs = stored[key] && typeof stored[key] === 'object' ? stored[key] : {};
    const base = syncedMaps[key];
    const out = {};
    for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const m = mine[id], t = theirs[id];
      // an entry this window does not have is not taken out by it (a product
      // leaves with the list; see `keep`)
      const v = m === undefined || canon(m) === canon(base[id]) ? t // not changed here
        : t === undefined || canon(t) === canon(base[id]) ? m      // changed here only
        : newer[key](m, t);                                         // changed on both sides
      if (v !== undefined) out[id] = v;
    }
    for (const id of dropped[key]) {
      if (mine[id] === undefined && canon(theirs[id]) === canon(base[id])) delete out[id];
    }
    const ids = keep(stored);
    for (const id of Object.keys(out)) if (!ids.has(id)) delete out[id];
    syncedMaps[key] = copy(out); // before the save: its report must find it
    await chrome.storage.local.set({ [key]: out });
    dropped[key].clear();
  });
}
const idsOf = (lists) => new Set(lists.flat().map((p) => p.id));
function saveOffers() {
  const ids = idsOf([state.cart]);
  for (const id of Object.keys(state.offers)) if (!ids.has(id)) delete state.offers[id];
  return saveMap('offers', state.offers, (stored) => idsOf([state.cart, stored.cart || []]));
}
function saveBp() {
  // keep matches for products that Undo could still bring back
  const keep = idsOf([state.cart, ...state.history]);
  for (const id of Object.keys(state.bp)) if (!keep.has(id)) delete state.bp[id];
  return saveMap('bp', state.bp, (stored) => idsOf([state.cart, ...state.history, stored.cart || [], ...(stored.history || [])]));
}

// ---------- Skroutz ----------
// fetchOffers and getMeta: lib/skroutz.js
const metaJobs = new Map();
/** Fill in a cart item's name, picture and part number (one request at a time per product). */
function fetchMeta(item) {
  if (!metaJobs.has(item.id)) metaJobs.set(item.id, readMeta(item).finally(() => metaJobs.delete(item.id)));
  return metaJobs.get(item.id);
}
async function readMeta(item) {
  try {
    const m = await getMeta(item.id, productUrl(item));
    const live = state.cart.find((p) => p.id === item.id);
    if (!live || !m) return;
    live.image = m.image || live.image;
    live.name = m.name || live.name;
    live.mpn = m.mpn;
    live.brand = m.brand;
    if (m.url) live.url = m.url;
    await saveCart();
    render();
  } catch { /* cosmetic only */ }
}

/**
 * The background is reading this product right now (it was just added from a
 * page): its results arrive through storage, so it is not read twice. Older
 * than 90 s means that lookup was given up.
 */
const bgBusy = (id) => Date.now() - (state.bgLookups[id] || 0) < 90000;

const offerJobs = new Map();
function loadOffers(id, force = false) {
  const cached = state.offers[id];
  if (!force && cached && Date.now() - cached.ts < CACHE_TTL) return Promise.resolve();
  if (!force && bgBusy(id)) return Promise.resolve();
  if (!offerJobs.has(id)) offerJobs.set(id, readOffers(id).finally(() => offerJobs.delete(id)));
  return offerJobs.get(id);
}
async function readOffers(id) {
  state.status[id] = 'loading';
  render();
  try {
    const { name, offers, titles } = await fetchOffers(id);
    state.offers[id] = { v: OFFERS_VER, ts: Date.now(), name, offers, titles };
    delete state.status[id];
    const item = state.cart.find((p) => p.id === id);
    if (item && name && (!item.name || item.name.startsWith('Product '))) { item.name = name; saveCart(); }
    saveOffers();
  } catch (e) {
    state.status[id] = 'error';
    console.warn('Eksipno Kalathi:', id, e);
  }
  render();
}

async function searchSkroutz(query) {
  const res = await skFetch(`${ORIGIN}/search?keyphrase=${encodeURIComponent(query)}`, { credentials: 'omit', headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Skroutz answered ${res.status}`);
  const direct = res.url.match(PRODUCT_URL); // a search with one hit can land on the product itself
  if (direct) return [{ id: direct[1], url: res.url.split(/[?#]/)[0], name: query, hay: query }];
  return parseSkroutzSearch(new DOMParser().parseFromString(await res.text(), 'text/html'));
}

// ---------- BestPrice ----------
/** Match one product on BestPrice (once) and read its merchants' prices. */
async function loadBp(id, force = false) {
  const item = state.cart.find((p) => p.id === id);
  if (!item || state.bpAccess === false || state.bpStatus[id] === 'loading') return;
  const ph = isPh(item); // added from BestPrice: its BestPrice page is known, nothing to match
  if (!ph && state.settings.bestprice === false) return;
  if (!force && bgBusy(id)) return; // the background is matching it right now
  const started = state.bp[id]; // the record this lookup is for
  let rec = started || (ph ? { v: BP_VER, item: { ...item.bpItem }, candidates: [], searched: true, confident: true, manual: true } : {});
  const fresh = rec.offers && Date.now() - rec.offersTs < CACHE_TTL;
  if (!force && (fresh || (rec.searched && !rec.item))) return;
  state.bpStatus[id] = 'loading';
  renderResults();
  // The user chose or pasted another match while this one was read: that
  // choice stands; this answer is dropped and the new match is read instead.
  const replaced = () => {
    if (state.bp[id] === started) return false;
    delete state.bpStatus[id];
    loadBp(id, true);
    return true;
  };
  try {
    let justRead = false; // the match comes with the prices it read to verify itself
    if (!rec.item) {
      if (item.mpn === undefined) await fetchMeta(item);
      await loadOffers(id); // the shops' listing titles help to verify the match
      const live = state.cart.find((p) => p.id === id) || item;
      const name = live.name.startsWith('Product ') ? (state.offers[id]?.name || live.name) : live.name;
      const m = await findMatch({ name, mpn: live.mpn || '', brand: live.brand || '', titles: state.offers[id]?.titles || [] });
      rec = { v: BP_VER, ...m, searched: true, offersTs: m.offers ? Date.now() : 0 };
      justRead = !!m.offers;
    }
    // "Refresh prices" (force) always reads them again; otherwise prices from the last minute are kept
    if (rec.item && !justRead && (force || !(rec.offers && Date.now() - rec.offersTs < 60000))) {
      const page = await fetchBpOffers(rec.item.url);
      rec.offers = page.offers;
      rec.offersTs = Date.now();
      if (!rec.item.name) rec.item.name = page.name || (await fetchItemMeta(rec.item.url)).name || 'BestPrice product';
    }
    if (replaced()) return;
    state.bp[id] = rec;
    delete state.bpStatus[id];
    saveBp();
  } catch (e) {
    if (replaced()) return;
    state.bpStatus[id] = 'error';
    console.warn('Eksipno Kalathi (BestPrice):', id, e);
  }
  renderResults();
}

const BP_ACCESS = { origins: ['https://www.bestprice.gr/*'] };

/** Without site access the browser applies CORS and BestPrice requests fail. */
async function checkBpAccess() {
  try { state.bpAccess = await chrome.permissions.contains(BP_ACCESS); } catch { state.bpAccess = false; }
  return state.bpAccess;
}

async function grantBpAccess() {
  // Must run straight from the click, so no awaits before the request.
  try {
    state.bpAccess = await chrome.permissions.request(BP_ACCESS);
    state.bpAccessErr = !state.bpAccess;
  } catch {
    state.bpAccess = false;
    state.bpAccessErr = true; // the loaded manifest does not list bestprice.gr yet
  }
  renderResults();
  if (state.bpAccess) { state.bpStatus = {}; loadAllBp(true); }
  return state.bpAccess;
}

async function loadAllBp(force = false) {
  if (!(await checkBpAccess())) { renderResults(); return; }
  // also redo lookups that ran without the product's title (before 1.4.1)
  const phJobs = state.cart.filter((p) => isPh(p) && (!p.searched || force || p.name === 'BestPrice product')).map((p) => resolvePh(p.id));
  const on = state.settings.bestprice !== false;
  const queue = state.cart.filter((p) => (isPh(p) ? p.searched && !force : on)).map((p) => p.id);
  const worker = async () => { while (queue.length) await loadBp(queue.shift(), force); };
  // finished only when those lookups are too (the refresh button turns until then)
  await Promise.all([worker(), worker(), ...phJobs]);
}

function chooseMatch(id, value) {
  if (value === '__paste') { state.bpPaste = id; renderResults(); return; }
  const rec = state.bp[id] || {};
  const c = (rec.candidates || []).find((x) => x.id === value);
  if (!c) return;
  state.bpEdit = null;
  state.bp[id] = { ...rec, v: BP_VER, item: { id: c.id, url: c.url, name: c.name }, manual: true, confident: true, offers: null, offersTs: 0 };
  saveBp();
  loadBp(id, true);
}

function pasteMatch(id, text) {
  const link = parseItemLink(text);
  if (!link) return false;
  state.bpPaste = null;
  state.bpEdit = null;
  state.bp[id] = { ...(state.bp[id] || {}), v: BP_VER, item: { ...link, name: '' }, manual: true, confident: true, searched: true, offers: null, offersTs: 0 };
  saveBp();
  loadBp(id, true);
  return true;
}

// ---------- products added from BestPrice: find the Skroutz twin ----------
async function resolvePh(phId) {
  const ph = state.cart.find((p) => p.id === phId);
  if (!ph || state.phStatus[phId] === 'loading') return;
  state.phStatus[phId] = 'loading';
  render();
  try {
    // The full price list has no product title, so read it from the product page
    // (unless the page button already passed it along).
    const [page, info] = await Promise.all([
      fetchBpOffers(ph.bpItem.url),
      ph.bpItem.name ? null : fetchItemMeta(ph.bpItem.url),
    ]);
    const bpName = ph.bpItem.name || (info && info.name) || page.name;
    if (!bpName) throw new Error('No title on the BestPrice page');
    state.bp[phId] = {
      v: BP_VER, item: { ...ph.bpItem, name: bpName }, candidates: [],
      searched: true, confident: true, manual: true, offers: page.offers, offersTs: Date.now(),
    };
    saveBp();
    const live0 = state.cart.find((p) => p.id === phId);
    if (live0) {
      live0.name = bpName;
      live0.bpItem.name = bpName;
      if (!live0.image && info && info.image) live0.image = info.image;
      saveCart();
      render();
    }

    // Search by title first, then by the part number the merchants put in their titles.
    const queries = [bpName, ...titleCodes(page.titles).slice(0, 1), bpName.split(/\s+/).slice(0, 4).join(' ')];
    const checked = new Set();
    const open = [];
    let adopted = false;
    for (const q of [...new Set(queries)]) {
      const list = await searchSkroutz(q);
      // rank on the card title plus the words of its link; the real name is read below
      const ranked = rank({ name: bpName }, list.map((c) => ({ ...c, name: c.hay })))
        .filter((c) => !checked.has(c.id)).slice(0, 3);
      for (const c of ranked) {
        checked.add(c.id);
        const [meta, sl] = await Promise.all([getMeta(c.id, c.url), fetchOffers(c.id)]);
        if (!meta || !meta.name) continue;
        const cand = { id: c.id, url: meta.url || c.url, name: meta.name, image: meta.image, mpn: meta.mpn, brand: meta.brand };
        const ev = evidence({ name: meta.name, mpn: meta.mpn, titles: sl.titles }, { name: bpName, titles: page.titles });
        if (ev.strong) {
          state.offers[c.id] = { v: OFFERS_VER, ts: Date.now(), name: sl.name, offers: sl.offers, titles: sl.titles };
          adopt(phId, cand, page, true, open);
          adopted = true;
          break;
        }
        if (!ev.clash) open.push({ ...cand, base: ev.base });
      }
      if (adopted) break;
    }
    if (!adopted) {
      open.sort((a, b) => b.base - a.base);
      const [top, next] = open;
      // on the names alone only when they are clearly the same model (not Galaxy A55 for A56)
      if (top && top.base >= 0.75 && (!next || top.base - next.base >= 0.15) && sameModel(bpName, top.name)) adopt(phId, top, page, true, open);
      else {
        const live = state.cart.find((p) => p.id === phId);
        if (live) { live.skCands = open; live.searched = true; saveCart(); }
      }
    }
    delete state.phStatus[phId];
  } catch (e) {
    state.phStatus[phId] = 'error';
    console.warn('Eksipno Kalathi (Skroutz search):', phId, e);
  }
  render();
}

/**
 * Replace a BestPrice placeholder with the Skroutz product it corresponds to.
 * `auto`: that Skroutz product was found automatically, not picked by the
 * user; `others`: the other Skroutz products the search found.
 */
function adopt(phId, cand, page, auto = false, others = []) {
  const i = state.cart.findIndex((p) => p.id === phId);
  if (i < 0) return;
  const ph = state.cart[i];
  if (auto) {
    // The swap is a change to the list that Undo can take back. Undo brings the
    // BestPrice product back with the Skroutz products found as a list to choose
    // from (it is not swapped by itself again).
    const seen = new Set();
    ph.skCands = [cand, ...others].filter((c) => !seen.has(c.id) && seen.add(c.id))
      .map(({ id, url, name, image, mpn, brand, base }) => ({ id, url, name, image, mpn, brand, base }));
    ph.searched = true;
    remember();
  }
  // The BestPrice product is the user's own (manual: never replaced by a lookup);
  // `auto` records that the Skroutz side was not, so later rules can check it again.
  state.bp[cand.id] = {
    v: BP_VER, item: { ...ph.bpItem, name: ph.bpItem.name || ph.name }, candidates: [],
    searched: true, confident: true, manual: true, ...(auto ? { auto: true } : {}),
    offers: page ? page.offers : null, offersTs: page ? Date.now() : 0,
  };
  if (state.cart.some((p) => p.id === cand.id)) state.cart.splice(i, 1);
  else {
    state.cart[i] = {
      id: cand.id, url: cand.url, name: cand.name, image: cand.image || null, mpn: cand.mpn, brand: cand.brand, qty: ph.qty || 1,
      // what the user added, and whether this product was found for it automatically
      // or picked by the user: a later version with other rules can then put it back
      origin: { site: 'bestprice', id: ph.bpItem.id, url: ph.bpItem.url, name: ph.bpItem.name || ph.name, auto: !!auto },
    };
  }
  // the placeholder's BestPrice record stays while Undo can bring it back (saveBp tidies it up after)
  delete state.phStatus[phId];
  saveCart();
  saveBp();
  render();
  loadOffers(cand.id).then(() => saveOffers());
  loadBp(cand.id);
}

function pickSkroutz(phId, candId) {
  const ph = state.cart.find((p) => p.id === phId);
  const cand = ph && (ph.skCands || []).find((c) => c.id === candId);
  if (!cand) return;
  remember(); // a wrong pick can be taken back with Undo, and picked again
  adopt(phId, cand, null);
}

async function loadAll(force = false) {
  const queue = state.cart.filter((p) => !isPh(p)).map((p) => p.id);
  const worker = async () => { while (queue.length) await loadOffers(queue.shift(), force); };
  $('refresh').classList.add('spin');
  // two Skroutz requests at a time: more makes "too many requests" likelier on long lists
  await Promise.all([worker(), worker(), loadAllBp(force)]);
  $('refresh').classList.remove('spin');
}

// ---------- cart actions ----------
function flash(text) {
  const el = $('add-msg');
  el.textContent = text;
  el.hidden = !text;
}

function addSkroutz(url) {
  const m = String(url).trim().match(PRODUCT_URL);
  if (!m) return;
  const id = m[1];
  if (state.cart.some((p) => p.id === id)) return;
  flash('');
  remember();
  const item = { id, url: m[2] ? `${ORIGIN}/s/${id}${m[2]}` : null, name: `Product ${id}`, image: null, qty: 1 };
  state.cart.push(item);
  saveCart();
  render();
  loadOffers(id);
  fetchMeta(item).then(() => loadBp(id));
}

async function addBestPrice(url) {
  const link = parseItemLink(url);
  if (!link || bpInCart(link.id)) return;
  // reading BestPrice needs site access; ask for it right from this click
  if (state.bpAccess === false && !(await grantBpAccess())) {
    return flash(t('needBpAccessAdd'));
  }
  flash('');
  remember();
  state.cart.push({ id: 'bp' + link.id, name: 'BestPrice product', bpItem: link, image: null, qty: 1 });
  saveCart();
  render();
  resolvePh('bp' + link.id);
}

const bpInCart = (bpId) => state.cart.some((p) => p.id === 'bp' + bpId || (state.bp[p.id] && state.bp[p.id].item && state.bp[p.id].item.id === bpId));

function removeProduct(id) {
  remember();
  state.cart = state.cart.filter((p) => p.id !== id);
  delete state.status[id];
  delete state.phStatus[id];
  saveCart();
  saveOffers();
  saveBp();
  render();
}

function setQty(id, delta) {
  const item = state.cart.find((p) => p.id === id);
  const qty = item ? Math.min(99, Math.max(1, (item.qty || 1) + delta)) : 0;
  if (!item || qty === (item.qty || 1)) return;
  remember();
  item.qty = qty;
  saveCart();
  render();
}
/** Sets a product's quantity to n (Undo takes it back like any change). */
function qtyTo(id, n) {
  const item = state.cart.find((p) => p.id === id);
  if (item) setQty(id, n - (item.qty || 1));
}

function emptyCart() {
  if (!state.cart.length) return;
  remember();
  state.cart = [];
  state.status = {};
  state.phStatus = {};
  saveCart();
  saveOffers();
  saveBp();
  render();
}

function undo() {
  if (!state.history.length) return;
  const current = Object.fromEntries(state.cart.map((p) => [p.id, p]));
  const snap = state.history.pop();
  state.cart = snap.map((p) => {
    // keep the name / picture we have learned since that version was saved
    const now = current[p.id];
    return now ? { ...p, name: now.name, image: now.image || p.image, url: now.url || p.url } : p;
  });
  // taken out of the history as it is stored now (normally its last version)
  withLock(async () => {
    const { history } = await chrome.storage.local.get('history');
    const list = Array.isArray(history) ? history.slice() : [];
    const key = canon(snap);
    for (let i = list.length - 1; i >= 0; i--) if (canon(list[i]) === key) { list.splice(i, 1); break; }
    await chrome.storage.local.set({ history: list });
  });
  saveCart();
  flash('');
  render();
  loadAll();
  for (const item of state.cart) if (!isPh(item) && !item.image) fetchMeta(item);
}

// ---------- offers of a product: both sites, availability ----------
/** The product's offers on each site, as loaded. */
function rawOffers(item) {
  const ph = isPh(item);
  const sk = ph ? [] : ((state.offers[item.id] && state.offers[item.id].offers) || []);
  const rec = state.bp[item.id];
  const useBp = ph || (state.settings.bestprice !== false && state.bpAccess !== false);
  const bp = useBp && rec && rec.item && rec.offers ? rec.offers : [];
  return { sk, bp };
}

/**
 * The offers the search may use for a product. BestPrice merchants get their
 * own ids, so they are never merged with a Skroutz store of the same number
 * (or its Plus eligibility).
 */
function sources(item) {
  const raw = rawOffers(item);
  return { sk: raw.sk, bp: raw.bp.map((o) => ({ ...o, shopId: 'bp' + o.shopId })) };
}

function passes(o) {
  const s = state.settings;
  // "In stock only" keeps offers known to be in stock (not those whose availability is not shown)
  if (s.avail === 'stock' && o.stock !== true) return false;
  if (s.avail === 'now' && !o.immediate) return false;
  if (+s.maxDays && !(o.days != null && o.days <= +s.maxDays)) return false;
  return true;
}

/** The most pieces one store sells among these offers (Infinity when one states no limit). */
function mostOf(offers) {
  return Math.max(...offers.map((o) => (o.max > 0 ? o.max : Infinity)));
}

// ---------- drawing without blinking ----------
/**
 * Puts new content into a container only when it differs from what is shown,
 * and keeps the pictures already on screen. Re-drawing identical content
 * (prices read again, a status changing elsewhere) made the popup blink.
 */
const drawn = new WeakSet(); // containers whose content this script put there
function update(box, ...content) {
  const tmp = document.createElement('div');
  for (const c of content.flat(Infinity)) if (c != null && c !== false) tmp.append(c.nodeType ? c : document.createTextNode(String(c)));
  // What boot.js showed is only a copy: it looks the same but its buttons do
  // nothing, so the first drawing always replaces it (with no visible change).
  if (drawn.has(box) && tmp.innerHTML === box.innerHTML) return false;
  drawn.add(box);
  const shown = new Map();
  for (const img of box.querySelectorAll('img')) {
    const k = img.outerHTML;
    if (!shown.has(k)) shown.set(k, []);
    shown.get(k).push(img);
  }
  for (const img of tmp.querySelectorAll('img')) {
    const same = shown.get(img.outerHTML);
    if (same && same.length) img.replaceWith(same.shift());
  }
  box.replaceChildren(...tmp.childNodes);
  return true;
}

/** A <details> whose open/closed state survives re-drawing; the user's choice wins over the default. */
function fold(key, openByDefault, cls, summary, ...content) {
  const open = state.open[key] ?? openByDefault;
  return h('details', { class: cls, open },
    h('summary', { onclick: (e) => { state.open[key] = !e.currentTarget.parentElement.open; } }, summary),
    ...content);
}

/** The line under the title: what is loading, or the subtitle. */
function status(text) {
  const el = $('subtitle');
  el.textContent = text || t('subtitle');
  el.classList.toggle('busy', !!text);
}

/**
 * Keeps a copy of the window as it looks now. boot.js shows it the next time
 * the popup opens, before this script has read the saved data, so the popup
 * opens at its final size instead of growing (the "flash").
 */
let snapTimer = null;
function saveSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    // only a settled view: nothing loading or being recalculated
    if ($('subtitle').classList.contains('busy') || document.querySelector('#tabs .busy, #tabs .stale, #app .dots')) return;
    const app = $('app').cloneNode(true);
    const q = (s) => app.querySelector(s);
    // as the popup opens: settings and result details closed
    q('#settings').hidden = true;
    q('#settings-btn').setAttribute('aria-expanded', 'false');
    q('#refresh').classList.remove('spin');
    q('#panel').hidden = true;
    q('#panel').replaceChildren();
    q('#add-msg').hidden = true;
    q('#sk-access').hidden = true; // checked again on every opening
    q('#welcome').hidden = !!state.settings.welcomed; // the guide opens by itself only until it is dismissed
    for (const b of app.querySelectorAll('#tabs .tab')) b.setAttribute('aria-expanded', 'false');
    try {
      localStorage.setItem('cartwise-snapshot', JSON.stringify({
        v: chrome.runtime.getManifest().version, lang: document.documentElement.lang, html: app.innerHTML,
      }));
    } catch { /* storage full or blocked: the popup just opens without the copy */ }
  }, 400);
}

/**
 * Names as shown on one line. When two products start with the same long run
 * of words (variants such as 0.9m / 1.8m), the shared part is cut after the
 * first words, so what tells them apart stays visible: "Anker 322 … 0.9m A81H5G11".
 * The full name is always in the tooltip.
 */
function shortNames(items) {
  const words = items.map((p) => String(p.name || '').split(/\s+/).filter(Boolean));
  const out = {};
  items.forEach((p, i) => {
    const w = words[i];
    let common = 0;
    words.forEach((o, j) => {
      if (j === i) return;
      let k = 0;
      while (k < w.length && k < o.length && w[k].toLowerCase() === o[k].toLowerCase()) k++;
      common = Math.max(common, k);
    });
    out[p.id] = common >= 5 && common < w.length ? [...w.slice(0, 2), '…', ...w.slice(common)].join(' ') : p.name;
  });
  return out;
}
let shortMemo = { key: null, map: {} };
function shownName(item) {
  const key = state.cart.map((p) => p.id + '\u0001' + p.name).join('\u0002');
  if (shortMemo.key !== key) shortMemo = { key, map: shortNames(state.cart) };
  return shortMemo.map[item.id] || item.name;
}

// ---------- rendering: products ----------
function placeholderMeta(item) {
  const status = state.phStatus[item.id];
  // looked up before: keep showing that outcome while it is looked up again
  if (!item.searched && status !== 'error') return h('div', { class: 'p-meta dots' }, t('findingOnSk'));
  if (status === 'error') {
    return h('div', { class: 'p-meta err' }, t('skSearchErr'),
      h('button', { class: 'retry', onclick: () => resolvePh(item.id) }, t('retry')));
  }
  const cands = item.skCands || [];
  if (!cands.length) {
    return h('div', { class: 'p-meta' }, t('notFoundSk'), t('bpOnly'),
      h('button', { class: 'retry', onclick: () => resolvePh(item.id) }, t('retry')));
  }
  return h('div', { class: 'p-pick' },
    h('select', { 'aria-label': t('skProduct'), onchange: (e) => pickSkroutz(item.id, e.target.value) },
      h('option', { value: '', selected: true, disabled: true }, t('chooseSk')),
      cands.map((c) => h('option', { value: c.id }, c.name))));
}

/** A product that may have replaced one added from BestPrice (see load): the user decides. */
function reviewMeta(item) {
  const r = item.review;
  const name = r.name.length > 44 ? r.name.slice(0, 42) + '…' : r.name;
  return h('div', { class: 'p-review', title: r.name },
    h('span', { class: 'p-stale' }, t('reviewMatch', { name })), ' ',
    h('button', { class: 'retry', onclick: () => keepReviewed(item.id) }, t('keepThis')), ' · ',
    h('button', { class: 'retry', onclick: () => restoreReviewed(item.id) }, t('useBpOne')));
}

function productMeta(item) {
  if (isPh(item)) return placeholderMeta(item);
  if (item.review) return reviewMeta(item);
  const data = state.offers[item.id];
  const status = state.status[item.id];
  if (!data && (status === 'loading' || (!status && bgBusy(item.id)))) return h('div', { class: 'p-meta dots' }, t('checking'));
  if (status === 'error' && !data) {
    return h('div', { class: 'p-meta err' }, t('loadErr'),
      h('button', { class: 'retry', onclick: () => loadOffers(item.id, true) }, t('retry')));
  }
  // could not be read again: the totals still use the prices read before, so say so
  const stale = status === 'error' && [h('span', { class: 'p-stale' }, t('notUpdated')), ' ',
    h('button', { class: 'retry', onclick: () => loadOffers(item.id, true) }, t('retry')), ' · '];
  if (data && !data.offers.length) return h('div', { class: 'p-meta err' }, stale, t('noStore'));
  if (!data) return h('div', { class: 'p-meta' }, ' ');
  const min = Math.min(...data.offers.map((o) => o.price));
  const shops = new Set(data.offers.map((o) => o.shopId)).size;
  const hub = data.offers.some((o) => o.hub);
  // No store sells this many: say so first, with a one-click way down to the
  // most one store has. Counted among the stores the results use (those that
  // fit the availability settings), so the number is the one the results give.
  const qty = item.qty || 1;
  const fit = data.offers.filter(passes);
  const most = fit.length ? mostOf(fit) : Infinity;
  const short = qty > most && [h('span', { class: 'p-stale' }, t('mostPerStore', { n: most })), ' ',
    h('button', { class: 'retry', onclick: () => qtyTo(item.id, most) }, t('setQtyTo', { n: most })), ' · '];
  const tip = fit.length < data.offers.length ? 'mostPerStoreTipFit' : 'mostPerStoreTip';
  return h('div', { class: 'p-meta', title: short ? t(tip, { n: most }) : null }, stale, short,
    t('fromStores', { price: eur(min), stores: count(shops, 'store') }),
    hub && ' · ', hub && h('span', { class: 'badge hub' }, 'Hub'));
}

function renderProducts() {
  update($('products'), state.cart.map((item) => h('li', { class: 'product' },
    item.image
      ? h('img', { class: 'thumb-img', src: item.image, alt: '' })
      : h('div', { class: 'thumb-img blank' }, '🛒'),
    h('div', { class: 'p-main' },
      h('a', { class: 'p-name', href: productUrl(item), target: '_blank', rel: 'noreferrer', title: item.name }, shownName(item)),
      productMeta(item)),
    h('div', { class: 'p-side' },
      h('div', { class: 'qty' },
        h('button', { onclick: () => setQty(item.id, -1), 'aria-label': t('less') }, '−'),
        h('span', {}, item.qty || 1),
        h('button', { onclick: () => setQty(item.id, 1), 'aria-label': t('more') }, '+')),
      h('button', { class: 'remove', title: t('remove'), 'aria-label': t('remove'), onclick: () => removeProduct(item.id) }, '×')))));
  $('count').textContent = state.cart.length;
  $('clear').disabled = state.cart.length === 0;
  $('undo').disabled = state.history.length === 0;
  const folded = !!state.settings.cartHidden && state.cart.length > 0;
  $('products').hidden = folded;
  $('undo').hidden = folded;
  $('clear').hidden = folded;
  $('cart-toggle').disabled = state.cart.length === 0;
  $('cart-toggle').setAttribute('aria-expanded', String(!folded));
  $('cart-toggle').title = state.cart.length ? t(folded ? 'showList' : 'hideList') : '';
  saveSnapshot();
}

// ---------- rendering: result cards ----------
/** ctx: {name(id), image(id), url(item, shipment), mark?(item, shipment)} */
function shipmentView(s, ctx, hideHead = false) {
  const title = s.hub
    ? [h('span', { class: 'badge hub' }, 'Skroutz Hub'), h('span', {}, s.shops.join(' + '))]
    : [s.showSrc && h('span', { class: 'badge ' + (s.src === 'BestPrice' ? 'bp' : 'sk') }, s.src), h('span', {}, s.shops[0])];
  const ship = s.fee > 0
    // a fee the shop does not show is an estimate: said in the tooltip only
    ? h('span', { class: 'v', title: s.feeEstimated ? t('feeAssumed') : null }, eur(s.fee))
    : h('span', { class: 'v free' }, s.feeReason === 'plus' ? t('freePlus') : t('free'));
  return h('div', { class: 'shipment' },
    !hideHead && h('div', { class: 's-head' }, title),
    // one line per product, each with its picture, so two products from the same shop read as two
    s.items.map((it) => {
      const name = ctx.name(it.productId) || it.name;
      const pic = ctx.image(it.productId);
      return h('div', { class: 'row item' },
        pic ? h('img', { class: 'ti', src: pic, alt: '' }) : h('span', { class: 'ti blank', 'aria-hidden': 'true' }),
        // the link opens this shop's own offer
        h('a', { class: 'n', href: ctx.url(it, s), target: '_blank', rel: 'noreferrer', title: (ctx.fullName(it.productId) || name) + (it.eta ? ` · ${it.eta}` : '') },
          (it.qty > 1 ? `${it.qty} × ` : '') + name),
        s.hub && s.shops.length > 1 && h('span', { class: 'shop', title: it.shopName }, it.shopName),
        ctx.mark && ctx.mark(it, s),
        it.stock === false && h('span', { class: 'badge warn avail', title: it.eta || '' },
          it.days != null ? t('etaDays', { n: it.days }) : t('notInStock')),
        h('span', { class: 'v' }, eur(it.price)));
    }),
    h('div', { class: 'row ship' }, h('span', { class: 'n' }, t('shipping')), ship));
}

/** The Skroutz offers of a result, as the Skroutz cart needs them. */
function skroutzItems(sol) {
  const items = [];
  for (const s of sol.shipments) {
    if (s.key.startsWith('sbp')) continue; // BestPrice merchants are bought on their own sites
    for (const it of s.items) {
      // choice: the shop asks for a size or option first, so it is added from its page
      if (it.cardId) items.push({ sku: String(it.productId), card: String(it.cardId), qty: it.qty || 1, name: it.name, choice: !!it.choice });
    }
  }
  return items;
}

/**
 * Hands the chosen offers to the page script, which puts them in the Skroutz
 * cart from a skroutz.gr tab (so it is the user's own cart, logged in or not).
 * `empty`: also remove whatever else is in that cart.
 */
async function sendToSkroutzCart(items, empty) {
  if (!items.length) return;
  skCart = null; // that cart is about to change
  await chrome.storage.local.set({ cartJob: { ts: Date.now(), items, empty: !!empty } });
  chrome.tabs.create({ url: `${ORIGIN}/cart#eksipno-kalathi` });
}

/**
 * The products in the user's Skroutz cart: [{sku, card}]. Read with their own
 * cookies, only to tell them what else is in it; nothing is sent anywhere.
 * Kept for a few seconds, so pointing at the button and pressing it read it once.
 */
let skCart = null;
function readSkCart() {
  if (skCart && Date.now() - skCart.ts < 10000) return skCart.promise;
  const promise = fetch(`${ORIGIN}/cart/line_items.json`, { credentials: 'include', headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Skroutz answered ' + res.status))))
    .then((data) => {
      const lines = data && data.cart && data.cart.line_items;
      if (!lines || typeof lines !== 'object') throw new Error('unexpected answer');
      return Object.values(lines).map((l) => ({ sku: String(l.sku_id), card: String(l.product_id) }));
    });
  skCart = { ts: Date.now(), promise };
  promise.catch(() => { if (skCart && skCart.promise === promise) skCart = null; }); // try again next time
  return promise;
}

/**
 * "Add to your Skroutz cart?" with the choice to empty the rest of that cart.
 * `from`, `key`: where the result comes from and what it is (see shownSol and
 * orderKey). Before anything is sent, the result is worked out again for the
 * list as it is then; if it changed, the question shows the new order instead,
 * which the user confirms in turn.
 */
function confirmCart(items, sol, from, key) {
  if (document.querySelector('dialog.confirm')) return; // already asking
  let order = { items, sol, key }; // what the question is about now

  const what = h('p', {});
  const notes = h('div', {});
  const empty = h('input', { type: 'checkbox' });
  // what else is in the Skroutz cart: changes in place once that cart has been read
  const hint = h('p', { class: 'c-hint' }, t('checkingSkCart'));
  // the check before sending, and what it found
  const msg = h('p', { class: 'c-msg', hidden: true });
  const ok = h('button', { class: 'btn primary', type: 'submit', value: 'ok' }, t('confirmAdd'));
  empty.addEventListener('change', () => { ok.textContent = t(empty.checked ? 'confirmEmptyAdd' : 'confirmAdd'); });
  let skLines = null; // the Skroutz cart, once read
  const showOthers = () => {
    if (!skLines) return;
    // a product of this order that is already there is updated, not counted as "other"
    const skus = new Set(order.items.map((i) => i.sku));
    const others = skLines.filter((l) => !skus.has(l.sku)).length;
    // Seeing nothing else proves little: some browsers send this read without the
    // Skroutz login, and get an empty guest cart. So the choice always stays, and
    // the cart page (which has the login) does the emptying.
    hint.textContent = others ? t('othersInSkCart', { n: others }) : t('emptyRestHint');
  };
  const draw = () => {
    const { items: list, sol: s } = order;
    const sk = s.shipments.filter((x) => !x.key.startsWith('sbp'));
    const onBp = s.shipments.filter((x) => x.key.startsWith('sbp')).reduce((n, x) => n + x.items.length, 0);
    // What goes into the cart: not the products whose shop asks for a size or
    // option first (added from their pages). Their shipments' shipping counts
    // once one of the products added is in them.
    const adding = list.filter((i) => !i.choice);
    const goes = (it) => adding.some((i) => i.sku === String(it.productId) && i.card === String(it.cardId));
    const parts = sk.map((x) => ({ x, its: x.items.filter(goes) })).filter((p) => p.its.length);
    const stores = new Set(parts.flatMap((p) => p.its.map((it) => it.shopName))).size;
    const amount = parts.reduce((sum, p) => sum + p.x.fee + p.its.reduce((a, it) => a + it.price, 0), 0);
    const choice = list.length - adding.length;
    // a product the user still has to check in the list (see reviewMeta) is not sent
    const review = list.filter((i) => state.cart.some((p) => p.id === i.sku && p.review));
    what.textContent = t('confirmWhat', { products: count(adding.length, 'product'), stores: count(stores, 'store'), amount: eur(amount) });
    notes.replaceChildren(...[
      onBp > 0 && h('p', { class: 'c-note' }, t('confirmBpNote', { n: onBp })),
      choice > 0 && h('p', { class: 'c-note' }, t('confirmChoiceNote', { n: choice })),
      review.length > 0 && h('p', { class: 'c-note c-warn' }, t('reviewFirst', { names: review.map((i) => i.name).join(', ') })),
    ].filter(Boolean));
    ok.disabled = !adding.length || review.length > 0;
    showOthers();
  };
  const form = h('form', { method: 'dialog' },
    h('h3', { id: 'c-title' }, t('confirmTitle')),
    what, notes,
    h('label', { class: 'c-check' }, empty, h('span', {}, t('emptyRest'))),
    hint, msg,
    h('div', { class: 'c-actions' },
      h('button', { class: 'btn', type: 'submit', value: 'cancel' }, t('cancel')),
      ok));
  draw();
  const dlg = h('dialog', { class: 'confirm', 'aria-labelledby': 'c-title' }, form);
  dlg.returnValue = '';
  // Before sending: the list, its prices or the settings may have changed while
  // the question was open (a product added from a page, prices read again). The
  // order goes only if the result for the list as it is now is the one shown.
  form.addEventListener('submit', (e) => {
    if (!e.submitter || e.submitter.value !== 'ok') return; // Cancel closes as usual
    e.preventDefault();
    ok.disabled = true;
    msg.hidden = false;
    msg.classList.remove('c-warn');
    msg.textContent = t('checkingResult');
    latestSol(from).then((now) => {
      if (!dlg.isConnected) return;
      if (now && orderKey(now) === order.key) { dlg.close('ok'); return; }
      msg.classList.add('c-warn');
      if (!now) { msg.textContent = t('noResultNow'); return; }
      // changed: the question now shows the new order, which the user confirms in turn
      order = { items: skroutzItems(now), sol: now, key: orderKey(now) };
      draw();
      msg.textContent = order.items.length ? t('resultChanged') : t('nothingToAddNow');
    });
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') sendToSkroutzCart(order.items, empty.checked);
    dlg.remove();
  });
  // a click on the dimmed page around it cancels
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg); // outside #app: not part of the saved copy of the window
  dlg.showModal();
  ok.focus();
  readSkCart().then((lines) => {
    if (!dlg.isConnected) return;
    skLines = lines;
    showOthers();
  }, () => { if (dlg.isConnected) hint.textContent = t('emptyRestHint'); });
}

// ---------- is a result still the one for the list as it is now? ----------
const BUSY = 'busy';
/**
 * The result a cart button was made for, worked out again for the list, its
 * prices and the settings as they are now: BUSY while it is being calculated,
 * null when there is none. `from`: {kind: the calculation (tab), pick(res, c)}.
 */
function shownSol(from) {
  const c = compute();
  if (c.wait) return BUSY;
  if (c.block) return null;
  const tab = c.tabs[from.kind];
  if (!tab) return c.busy ? BUSY : null;
  if (tab.block) return null;
  if (!tab.res || tab.stale) return BUSY;
  if (tab.res.error) return null;
  return from.pick(tab.res, c) || null;
}
/**
 * A whole result as one string, money in whole cents: every product with its
 * quantity, shop, offer and price, every shipment's shipping (BestPrice ones
 * included), and the total. Two results with the same key are the same order
 * at the same amounts.
 */
function orderKey(sol) {
  const c = (eur) => Math.round(eur * 100);
  const shipments = sol.shipments.map((s) => [
    `${s.key} ship ${c(s.fee)}`,
    ...s.items.map((it) => [it.productId, it.shopId, it.cardId || '', it.qty || 1, it.choice ? 1 : 0, c(it.price)].join(':')).sort(),
  ].join(' '));
  return `${shipments.sort().join(' | ')} = ${c(sol.total)}`;
}
/** The result as it is now, after waiting (a few seconds at most) for a calculation in progress. */
async function latestSol(from) {
  for (let i = 0; i < 40; i++) {
    const now = shownSol(from);
    if (now !== BUSY) return now;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

function cartButton(sol, from) {
  const items = skroutzItems(sol);
  if (!items.length) return null;
  const mixed = sol.shipments.some((s) => s.key.startsWith('sbp'));
  const key = orderKey(sol);
  return h('div', { class: 'r-actions' },
    h('button', {
      class: 'btn primary', type: 'button',
      // a result being recalculated (the list changed) cannot be bought
      onclick: () => {
        const now = shownSol(from);
        if (now === BUSY) return;
        if (!now || orderKey(now) !== key) { renderResults(); return; }
        confirmCart(items, sol, from, key);
      },
      // start reading the Skroutz cart as the pointer arrives, so the question is complete when it opens
      onpointerenter: () => { readSkCart().catch(() => {}); },
      onfocus: () => { readSkCart().catch(() => {}); },
    }, t(mixed ? 'addSkPartToCart' : 'addToSkCart')));
}

/** `from`: where `sol` comes from, so its cart button can check it is still current (see shownSol). */
function resultCard({ kicker, title, sol, badge, note, warn, extra, noCart, from }, ctx) {
  return h('article', { class: 'result' },
    h('div', { class: 'r-head' },
      h('div', {},
        h('div', { class: 'r-kicker' }, kicker),
        h('div', { class: 'r-title' }, title),
        badge),
      h('div', { class: 'r-total' },
        h('b', {}, eur(sol.total)),
        h('small', {}, t('totalLine', { items: eur(sol.itemsTotal), ship: sol.shippingTotal ? eur(sol.shippingTotal) : t('freeLower') })))),
    note && h('div', { class: 'r-note' }, note),
    warn,
    // a lone store shipment would just repeat the card title
    sol.shipments.map((s) => shipmentView(s, ctx, sol.shipments.length === 1 && !s.hub && !s.showSrc && s.shops[0] === title)),
    !noCart && cartButton(sol, from),
    extra);
}

const notice = (...content) => h('div', { class: 'notice' }, content);
const dots = (text) => h('span', { class: 'dots' }, text);

// ---------- calculating (in a worker, so the popup never freezes) ----------
const skroutzSettings = () => ({
  hasPlus: state.settings.hasPlus,
  delivery: state.settings.delivery,
  // Skroutz Plus: free per shipment from 15 € to a Skroutz Point, 25 € to an address
  // (also for a shop that cannot deliver to a Point)
  plusMin: state.settings.delivery === 'home' ? 25 : 15,
  plusMinHome: 25,
});

const TABS = ['skroutz', 'overall', 'bestprice'];
const calc = {};          // tab -> {key, result, prev, products, settings}
const inFlight = new Map(); // tab -> key sent to the worker and not answered yet
let worker = null;
let workerTimer = null;

/**
 * The result for these inputs: {res, stale}. Until it is calculated, the
 * previous result is returned as `stale` (it is shown dimmed if this takes a
 * moment), so the totals never blink to "…" and back.
 */
function requestCalc(tab, key, products, settings) {
  const cur = calc[tab];
  if (cur && cur.key === key) return { res: cur.result || cur.prev, stale: !cur.result && !!cur.prev };
  const saved = state.calcCache[tab];
  if (saved && saved.key === key) {
    calc[tab] = { key, result: saved.result };
    return { res: saved.result, stale: false };
  }
  const prev = (cur && (cur.result || cur.prev)) || (saved && saved.result) || null;
  calc[tab] = { key, result: null, prev, products, settings };
  if (!workerTimer) workerTimer = setTimeout(runWorker, 0);
  return { res: prev, stale: !!prev };
}

/** A result is ready: keep it, also for the next time the popup opens. */
function calcDone(tab, result) {
  const j = calc[tab];
  j.result = result;
  j.prev = null;
  if (!result.error) {
    state.calcCache[tab] = { key: j.key, result };
    chrome.storage.local.set({ calc: { ver: chrome.runtime.getManifest().version, tabs: state.calcCache } });
  }
}

function runWorker() {
  workerTimer = null;
  const todo = TABS.filter((tab) => calc[tab] && !calc[tab].result && inFlight.get(tab) !== calc[tab].key);
  if (!todo.length) return;
  try {
    // a worker still busy with inputs that have changed since is dropped
    const outdated = [...inFlight].some(([tab, key]) => !calc[tab] || calc[tab].key !== key);
    if (worker && outdated) { worker.terminate(); worker = null; inFlight.clear(); }
    if (!worker) {
      worker = new Worker(chrome.runtime.getURL('lib/worker.js'), { type: 'module' });
      worker.onmessage = (e) => {
        const { tab, key, result } = e.data;
        if (inFlight.get(tab) === key) inFlight.delete(tab);
        if (calc[tab] && calc[tab].key === key && !calc[tab].result) { calcDone(tab, result); renderResults(); }
      };
      worker.onerror = () => { worker = null; inFlight.clear(); TABS.forEach(calcHere); renderResults(); };
    }
    for (const tab of TABS) {
      const j = calc[tab];
      if (!j || j.result || inFlight.get(tab) === j.key) continue;
      inFlight.set(tab, j.key);
      worker.postMessage({ tab, key: j.key, products: j.products, settings: j.settings });
    }
  } catch {
    TABS.forEach(calcHere); // no worker available: calculate here
    renderResults();
  }
}
function calcHere(tab) {
  const j = calc[tab];
  if (!j || j.result) return;
  let result;
  try { result = optimize(j.products, j.settings); } catch (e) { result = { error: String(e.message || e) }; }
  calcDone(tab, result);
}

/** Products and offers for one tab. */
function tabProducts(kind, list) {
  const products = [];
  // other: products priced from the other site; filtered: products the availability settings leave without an offer;
  // short: products no store (within those settings) sells in the quantity wanted
  const info = { other: 0, filtered: [], missing: [], short: [] };
  for (const { item, sk, bp } of list) {
    let offers;
    if (kind === 'skroutz') {
      // a product Skroutz does not sell is priced from BestPrice
      offers = sk.length ? sk : bp;
      if (!sk.length && bp.length) info.other++;
    } else if (kind === 'bestprice') {
      // buying on BestPrice: what it cannot supply (within the settings) comes from Skroutz
      const fit = bp.filter(passes);
      offers = fit.length ? fit : sk;
      if (!fit.length && sk.length) info.other++;
    } else offers = [...sk, ...bp];
    if (!offers.length) { info.missing.push(item.id); continue; }
    offers = offers.filter(passes);
    if (!offers.length) { info.filtered.push(item.name); continue; }
    // The Skroutz cart takes each product from one store, and a store sells at
    // most so many pieces: only stores that have the whole quantity count.
    const qty = item.qty || 1;
    const enough = offers.filter((o) => !(o.max > 0) || o.max >= qty);
    if (!enough.length) { info.short.push({ name: item.name, most: mostOf(offers) }); continue; }
    products.push({ id: item.id, name: item.name, qty, offers: enough });
  }
  return { products, info };
}

/**
 * A short fingerprint of a list of offers. The calculations are keyed on it,
 * so prices read again but unchanged do not start a new calculation.
 */
const prints = new WeakMap();
// fields in a fixed order: saved data comes back with its fields reordered
const sortedFields = (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {})
  : v);
function fingerprint(list) {
  if (!list) return '-';
  let v = prints.get(list);
  if (v == null) {
    // the sites list the same offers in a varying order
    const s = list.map((o) => JSON.stringify(o, sortedFields)).sort().join('\n');
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); }
    v = (x >>> 0).toString(36) + '.' + s.length.toString(36);
    prints.set(list, v);
  }
  return v;
}

function compute() {
  const c = { bpOn: state.settings.bestprice !== false, real: state.cart.filter((p) => !isPh(p)), tabs: {} };
  const phs = state.cart.filter(isPh);
  const pending = c.real.filter((p) => !state.offers[p.id]);

  // a product added from BestPrice blocks the results only until its first lookup
  if (phs.some((p) => !p.searched && state.phStatus[p.id] !== 'error')) {
    c.wait = true;
    c.block = dots(t('findingSkProduct'));
  } else if (pending.length) {
    c.wait = !pending.some((p) => state.status[p.id] === 'error');
    c.block = c.wait ? dots(t('collecting')) : t('someFailed');
  }

  c.recs = c.real.map((item) => ({ item, rec: state.bp[item.id] || {}, status: state.bpStatus[item.id] }));
  // Waits only for products never looked up on BestPrice, or a match just chosen
  // whose prices are not read yet. A product looked up before keeps its last
  // outcome (prices, or no match) while it is looked up again.
  c.busy = c.bpOn && state.bpAccess !== false
    && c.recs.some((r) => (!r.rec.searched && !r.rec.item && r.status !== 'error')
      || (r.rec.item && !r.rec.offers && r.status === 'loading'));
  // products with BestPrice prices: those matched there, and those added from there
  c.priced = state.cart.map((item) => state.bp[item.id] || {}).filter((rec) => rec.item && rec.offers && rec.offers.length);
  // products whose BestPrice prices could not be read just now (not "not found": not checked)
  // (a product that keeps prices read before is not among them: those are used, marked "not updated")
  c.bpFailed = c.recs.filter((r) => r.status === 'error' && !(r.rec.item && r.rec.offers && r.rec.offers.length)).map((r) => r.item.id);
  if (c.block) return c;

  const list = state.cart.map((item) => ({ item, ...sources(item) }));
  const s = state.settings;
  const sig = [s.hasPlus ? 1 : 0, s.delivery, s.avail || 'any', +s.maxDays || 0, c.bpOn ? 1 : 0, state.bpAccess === false ? 0 : 1,
    ...state.cart.map((p) => {
      const rec = state.bp[p.id];
      return [p.id, p.qty || 1,
        fingerprint(state.offers[p.id] && state.offers[p.id].offers),
        fingerprint(rec && rec.item && rec.offers),
        (rec && rec.item && rec.item.id) || ''].join(':');
    })].join('|');

  const want = (kind) => {
    const { products, info } = tabProducts(kind, list);
    const tab = { info, base: `${kind}|${sig}` };
    if (info.missing.length) { tab.block = t('removeMissing'); tab.reason = 'missing'; return tab; }
    // the availability settings are never bent: with no fitting offer there is no result;
    // nor is a store's stock: a quantity no store has gives no result either
    if (info.filtered.length || info.short.length) {
      const filtersOn = (s.avail && s.avail !== 'any') || +s.maxDays > 0;
      tab.block = [
        info.filtered.length && t('filterBlocks', { names: info.filtered.join(', ') }),
        info.short.length && t('stockBlocks', {
          list: info.short.map((x) => `${x.name} (${t('atMost', { n: x.most })})`).join(', '),
          settings: filtersOn,
        }),
      ].filter(Boolean).join(' ');
      tab.reason = info.filtered.length ? 'filter' : 'short';
      return tab;
    }
    const long = state.long[kind] === tab.base;
    const r = requestCalc(kind, tab.base + (long ? '|long' : ''), products,
      { ...skroutzSettings(), budgetMs: long ? 45000 : 5000 });
    tab.res = r.res;
    tab.stale = r.stale;
    return tab;
  };

  c.tabs.skroutz = want('skroutz');
  if (c.bpOn && state.bpAccess !== false && !c.busy) {
    c.tabs.overall = want('overall');
    c.mix = mixState(c);
    // no saving with BestPrice: work out what buying there would cost, to compare
    if (c.mix && !c.mix.wins && c.priced.length) c.tabs.bestprice = want('bestprice');
  }
  return c;
}

/** Marks every shipment with its site; `showSrc` when the card should say so. */
function tagSources(sol, always) {
  let bp = 0, sk = 0;
  for (const s of sol.shipments) {
    s.src = s.key.startsWith('sbp') ? 'BestPrice' : 'Skroutz';
    if (s.src === 'BestPrice') bp += s.items.length; else sk += s.items.length;
  }
  for (const s of sol.shipments) s.showSrc = always;
  return { bp, sk };
}

const tabTotal = (tab, pick) => (tab && tab.res && !tab.res.error ? pick(tab.res) : null);

/** A notice while a tab has nothing to show yet, or null when its result is ready. */
function notReady(c, tab) {
  if (c.block) return [notice(c.block)];
  if (!tab) return [notice(dots(t(c.busy ? 'searchingBp' : 'calculating')))];
  if (tab.block) return [notice(tab.block)];
  if (!tab.res) return [notice(dots(t('calculating')))];
  if (tab.res.error) return [notice(t('calcError', { msg: tab.res.error }))];
  return null;
}

/** "Best found, not proven cheapest" with a way to let the search run longer. */
function stoppedNote(kind, tab, sol) {
  if (sol.exact) return null;
  return h('div', { class: 'r-note' }, t('bestFound'), ' ',
    state.long[kind] !== tab.base && h('button', {
      class: 'link-btn', 'data-for': tab.base, onclick: () => { state.long[kind] = tab.base; renderResults(); },
    }, t('searchLonger')));
}

// ---------- the three panels ----------
function panelSingle(c, ctx) {
  const tab = c.tabs.skroutz;
  const wait = notReady(c, tab);
  if (wait) return wait;
  const n = state.cart.length;
  const single = tab.res.single[0];
  if (!single) return [notice(t('noSingle', { n }))];
  const others = tab.res.single.slice(1);
  tagSources(single, tab.info.other > 0);
  for (const o of others) tagSources(o, false);
  const hubStores = single.hub ? single.shipments[0].shops.length : 0;
  const best = single.total <= tab.res.overall.total + 0.004;
  return [resultCard({
    kicker: t('bestSingle'),
    title: single.hub ? `Skroutz Hub · ${count(hubStores, 'store')}` : single.label,
    sol: single,
    from: { kind: 'skroutz', pick: (r) => r.single[0] },
    badge: n > 1 && (best
      ? h('span', { class: 'badge win' }, t('alsoCheapestSk'))
      : h('span', { class: 'badge warn' }, t('moreThanSplit', { amount: eur(single.total - tab.res.overall.total) }))),
    extra: others.length > 0 && fold('others', false, 'others', t('moreSingles', { n: others.length }),
      others.map((s) => h('div', { class: 'row' },
        h('span', { class: 'n' }, s.hub && h('span', { class: 'badge hub' }, 'Skroutz Hub'), s.hub ? ' ' + s.shipments[0].shops.join(' + ') : s.label),
        h('span', { class: 'v' }, eur(s.total))))),
  }, ctx)];
}

function panelSkroutz(c, ctx) {
  const tab = c.tabs.skroutz;
  const wait = notReady(c, tab);
  if (wait) return wait;
  const overall = tab.res.overall;
  const single = tab.res.single[0];
  tagSources(overall, tab.info.other > 0);
  const stores = overall.shipments.reduce((k, s) => k + s.shops.length, 0);
  const saving = single ? single.total - overall.total : 0;
  return [resultCard({
    kicker: t('cheapestSk'),
    title: `${count(stores, 'store')} · ${count(overall.shipments.length, 'shipment')}`,
    sol: overall,
    from: { kind: 'skroutz', pick: (r) => r.overall },
    badge: single && (saving > 0.004
      ? h('span', { class: 'badge save' }, t('savesVsSingle', { amount: eur(saving) }))
      : h('span', { class: 'badge win' }, t('sameAsSingle'))),
    warn: stoppedNote('skroutz', tab, overall),
  }, ctx)];
}

function accessNotice() {
  return notice(
    h('p', {}, h('b', {}, t('access1'))),
    h('p', {}, state.bpAccessErr ? t('access2err') : t('access2')),
    h('p', { style: 'margin-top:6px' }, h('button', { class: 'btn small', onclick: grantBpAccess }, t('allow'))));
}

/** Why a product is bought from Skroutz in the BestPrice result, as a small badge. */
function bpGap(id) {
  const rec = state.bp[id] || {};
  // its BestPrice prices could not be read just now: not checked, rather than not there
  if (state.bpStatus[id] === 'error' && !(rec.item && rec.offers && rec.offers.length)) return h('span', { class: 'badge warn avail' }, t('notCheckedShort'));
  const [text, cls] = !rec.item
    ? ((rec.candidates || []).length ? [t('notSure'), 'warn'] : [t('notFound'), 'bad'])
    : rec.offers && !rec.offers.length ? [t('noMerchants'), 'bad'] : [t('noFitShort'), 'warn'];
  return h('span', { class: `badge ${cls} avail` }, text);
}

function matchRow(item) {
  const rec = state.bp[item.id] || {};
  // looked up before: keep showing that outcome while it is looked up again
  const status = state.bpStatus[item.id] === 'loading' && rec.searched && !rec.item ? undefined : state.bpStatus[item.id];
  const cands = rec.candidates || [];
  // the cheapest BestPrice price that fits the availability settings
  const fits = (rec.item && rec.offers ? rec.offers : []).filter(passes);
  const from = fits.length ? Math.min(...fits.map((o) => o.price)) : null;
  let tag = null;
  if (from != null) {
    tag = [h('span', { class: 'm-price' }, t('fromPrice2', { price: eur(from) })),
      // the price is from before: reading it again failed
      status === 'error' && h('span', { class: 'badge bad' }, t('notUpdated'))];
  } else if (status === 'loading') tag = h('span', { class: 'dots' }, t('searching'));
  else if (status === 'error') tag = h('span', { class: 'badge bad' }, t('couldNotLoad'));
  else if (!rec.item) tag = cands.length ? h('span', { class: 'badge warn' }, t('notSure')) : h('span', { class: 'badge bad' }, t('notFound'));
  else if (rec.offers && !rec.offers.length) tag = h('span', { class: 'badge bad' }, t('noMerchants'));
  else if (rec.offers) tag = h('span', { class: 'badge warn' }, t('noFit'));

  let body = null;
  if (state.bpPaste === item.id) {
    const input = h('input', { type: 'text', placeholder: 'https://www.bestprice.gr/item/…', spellcheck: 'false' });
    const submit = () => { if (!pasteMatch(item.id, input.value)) input.style.outline = '2px solid var(--bad)'; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    body = h('div', { class: 'm-pick' }, input,
      h('button', { class: 'btn small', onclick: submit }, t('use')),
      h('button', { class: 'btn small', onclick: () => { state.bpPaste = null; state.bpEdit = null; renderResults(); } }, t('cancel')));
    setTimeout(() => { const live = document.querySelector('.m-pick input'); if (live && document.activeElement !== live) live.focus(); });
  } else if (status === 'error') {
    body = h('div', { class: 'm-pick' }, h('button', { class: 'btn small', onclick: () => loadBp(item.id, true) }, t('retry')));
  } else if (rec.item && state.bpEdit !== item.id) {
    // settled: just say what it was matched with
    body = h('div', { class: 'm-to' },
      h('a', { href: rec.item.url, target: '_blank', rel: 'noreferrer', title: rec.item.name }, '→ ' + (rec.item.name || t('bpProduct'))),
      h('button', { class: 'link-btn', onclick: () => { if (cands.length) state.bpEdit = item.id; else state.bpPaste = item.id; renderResults(); } }, t('change')));
  } else if (status !== 'loading') {
    body = cands.length
      ? h('div', { class: 'm-pick' },
        h('select', { 'aria-label': t('bpProduct'), onchange: (e) => chooseMatch(item.id, e.target.value) },
          h('option', { value: '', selected: !rec.item, disabled: true }, t('chooseMatch')),
          cands.map((c) => h('option', { value: c.id, selected: rec.item && rec.item.id === c.id },
            c.name + (c.price ? t('fromPrice', { price: eur(c.price) }) : ''))),
          h('option', { value: '__paste' }, t('pasteNone'))))
      : h('div', { class: 'm-pick' },
        h('button', { class: 'btn small', onclick: () => { state.bpPaste = item.id; renderResults(); } }, t('pasteBtn')));
  }
  return h('div', { class: 'match' },
    h('div', { class: 'm-src' }, h('span', { title: item.name }, shownName(item)), tag),
    body);
}

/**
 * The cheapest way when BestPrice merchants may be used too, and whether that
 * beats buying on Skroutz only. null while it is not calculated.
 */
function mixState(c) {
  const sol = tabTotal(c.tabs.overall, (r) => r.overall);
  if (!sol) return null;
  const from = tagSources(sol, true);
  const sk = tabTotal(c.tabs.skroutz, (r) => r.overall);
  const gain = sk ? sk.total - sol.total : null;
  return { sol, from, gain, wins: from.bp > 0 && (gain == null || gain > 0.004) };
}

/** Reads BestPrice again for products whose last try failed. */
function retryBp(ids) {
  for (const id of ids) loadBp(id, true);
}

function panelMix(c, ctx) {
  if (state.bpAccess === false) return [accessNotice()];
  if (c.block) return [notice(c.block)];
  const n = c.recs.length;
  // the list of matches opens by itself only when one of them needs the user
  const needsPick = c.recs.some((r) => r.status === 'error' || (!r.rec.item && (r.rec.candidates || []).length > 0));
  const matches = n > 0 && fold('matches', needsPick || state.bpEdit != null || state.bpPaste != null, 'matches', t('matched'),
    c.real.map(matchRow));
  const shell = (title, note) => [h('article', { class: 'result' },
    h('div', { class: 'r-head' }, h('div', {},
      h('div', { class: 'r-kicker' }, t('withBp')),
      h('div', { class: 'r-title' }, title))),
    note && h('div', { class: 'r-note' }, note),
    matches)];

  const tab = c.tabs.overall;
  if (c.busy || !tab) return shell(dots(t('searchingBp')));
  if (tab.block) return shell(t('noTotal'), tab.block);
  if (!tab.res) return shell(dots(t('calculating')));
  if (tab.res.error) return shell(t('noTotal'), t('calcError', { msg: tab.res.error }));

  // some products could not be checked on BestPrice just now: the result is without them, said so with a way to try again
  const unchecked = c.bpFailed.length > 0 && [t('someNotChecked', { n: c.bpFailed.length }), ' ',
    h('button', { class: 'btn small', onclick: () => retryBp(c.bpFailed) }, t('retry'))];
  const mix = c.mix;
  if (mix.wins) {
    return [resultCard({
      kicker: t('withBp'),
      title: mix.from.sk ? t('split', { sk: mix.from.sk, bp: mix.from.bp }) : t('allBp'),
      sol: mix.sol,
      from: { kind: 'overall', pick: (r, now) => (now.mix && now.mix.wins ? now.mix.sol : null) },
      badge: mix.gain != null && h('span', { class: 'badge save' }, t('savesVsSk', { amount: eur(mix.gain) })),
      note: unchecked,
      warn: stoppedNote('overall', tab, mix.sol),
      extra: matches,
    }, ctx)];
  }

  // Nothing on BestPrice lowers the total: show what buying there would cost.
  if (!c.priced.length) {
    // nothing priced on BestPrice: because it could not be read just now (try again), or because nothing was found
    if (c.bpFailed.length) {
      return shell(t('bpNotCheckedTitle'), [t('bpNotChecked'), ' ',
        h('button', { class: 'btn small', onclick: () => retryBp(c.bpFailed) }, t('retry'))]);
    }
    return shell(t('noBpGain'), t('noBpFound'));
  }
  const bt = c.tabs.bestprice;
  if (!bt || (!bt.res && !bt.block)) return shell(t('noBpGain'), dots(t('calculating')));
  if (bt.block) return shell(t('noBpGain'), bt.block);
  if (bt.res.error) return shell(t('noBpGain'), t('calcError', { msg: bt.res.error }));
  const sol = bt.res.overall;
  const from = tagSources(sol, true);
  const merchants = sol.shipments.filter((s) => s.src === 'BestPrice').length;
  const skTotal = tabTotal(c.tabs.skroutz, (r) => r.overall.total);
  const diff = skTotal == null ? null : sol.total - skTotal;
  return [resultCard({
    kicker: t('cheapestBp'),
    title: count(merchants, 'merchant') + (from.sk ? ` · ${t('nFromSk', { n: from.sk })}` : ''),
    sol,
    badge: diff == null ? null : diff > 0.004
      ? h('span', { class: 'badge warn' }, t('skOnlyCheaper', { amount: eur(diff) }))
      : h('span', { class: 'badge win' }, t('sameAsSkOnly')),
    note: unchecked,
    warn: stoppedNote('bestprice', bt, sol),
    noCart: true, // more expensive than Skroutz only: nothing to buy from here
    extra: matches,
  }, { ...ctx, mark: (it, s) => s.src === 'Skroutz' && bpGap(it.productId) })];
}

function renderResults() {
  const box = $('results');
  box.hidden = state.cart.length === 0;
  if (box.hidden) { status(''); saveSnapshot(); return; }

  const c = compute();
  const sk = c.tabs.skroutz;
  const ov = c.tabs.overall;
  const bt = c.tabs.bestprice;
  const calcBusy = (tab) => !!c.wait || (!c.block && (!tab || (!tab.block && !tab.res)));
  const noAccess = state.bpAccess === false;
  const n = c.recs.length;
  const mix = c.mix;
  // why a tab has no total (its tooltip)
  const blocked = (tab) => (typeof c.block === 'string' ? c.block : tab && typeof tab.block === 'string' ? tab.block : null);

  // With BestPrice: the saving if there is one, otherwise what buying on BestPrice would cost
  let mixTab = null;
  if (c.bpOn) {
    mixTab = { key: 'overall', label: t('tabMix'), busy: !noAccess && (c.busy || calcBusy(ov)), stale: !!(ov && ov.stale),
      why: noAccess ? t('access1') : blocked(ov) };
    if (mix && mix.wins) mixTab.sol = mix.sol;
    else if (mix && !c.priced.length && c.bpFailed.length) { mixTab.text = t('bpNotCheckedShort'); mixTab.why = t('bpNotChecked'); }
    else if (mix && !c.priced.length) { mixTab.text = t('notOnBpShort'); mixTab.why = t('noBpFound'); }
    else if (mix) {
      mixTab.sol = tabTotal(bt, (r) => r.overall);
      mixTab.busy = !mixTab.sol && calcBusy(bt);
      mixTab.stale = mixTab.stale || !!(bt && bt.stale);
      mixTab.why = blocked(bt) || mixTab.why;
      mixTab.src = bt;
      mixTab.totalTip = t('bpPlanTip');
    }
  }
  const tabs = [
    { key: 'single', label: t('tabSingle'), sol: tabTotal(sk, (r) => r.single[0] || null), busy: calcBusy(sk), stale: !!(sk && sk.stale),
      why: blocked(sk) || t('whySingle') },
    { key: 'skroutz', label: t('tabSk'), sol: tabTotal(sk, (r) => r.overall), busy: calcBusy(sk), stale: !!(sk && sk.stale), why: blocked(sk) },
    mixTab,
  ].filter(Boolean);
  for (const tab of tabs) {
    tab.total = tab.sol ? tab.sol.total : null;
    if (tab.total != null) { tab.tip = tab.totalTip || ''; continue; }
    if (tab.busy) continue;
    tab.tip = tab.why || '';
    if (tab.text) continue;
    const src = tab.src || (tab.key === 'overall' ? ov : sk);
    tab.text = tab.key === 'overall' && noAccess ? t('noAccessShort')
      : (src && src.reason === 'filter') ? t('checkSettings')
      : (src && src.reason === 'short') ? t('lowerQty')
      : tab.key === 'single' && !c.block && !(src && src.block) ? t('notPossible')
      : t('unavailable');
  }

  // what is still loading, in the line under the title (so nothing moves)
  const prog = [];
  const got = c.real.filter((p) => state.offers[p.id]).length;
  if (got < c.real.length) prog.push(t('progPrices', { a: got, b: c.real.length }));
  if (c.bpOn && !noAccess && c.busy) {
    const done = c.recs.filter((r) => r.status !== 'loading' && (r.rec.searched || r.rec.item || r.status === 'error')).length;
    prog.push(t('progBp', { a: done, b: n }));
  }
  if (!prog.length && tabs.some((x) => x.busy)) prog.push(t('calculating') + '…');
  status(prog.join(' · '));

  // All tabs start closed; clicking a tab opens its details, clicking it again closes them.
  if (!tabs.some((x) => x.key === state.openTab)) state.openTab = null;
  const active = state.openTab;
  const totals = tabs.map((x) => x.total).filter((x) => x != null);
  const min = totals.length > 1 ? Math.min(...totals) : null;

  update($('tabs'), tabs.map((tab) => h('button', {
    class: 'tab' + (min != null && tab.total != null && tab.total <= min + 0.004 ? ' cheapest' : ''),
    type: 'button', 'aria-expanded': String(tab.key === active), 'aria-controls': 'panel',
    title: [tab.tip, tab.key === active ? t('hideDetails') : t('showDetails')].filter(Boolean).join('\n'),
    onclick: () => { state.openTab = state.openTab === tab.key ? null : tab.key; renderResults(); },
  }, h('span', {}, tab.label),
  tab.total != null ? h('b', { class: tab.stale ? 'stale' : null }, eur(tab.total))
    : tab.busy ? h('b', { class: 'busy' }, '…')
    : h('b', { class: 'note' }, tab.text))));

  const panel = $('panel');
  panel.hidden = !active;
  if (!active) { update(panel); saveSnapshot(); return; }
  const byId = Object.fromEntries(state.cart.map((p) => [p.id, p]));
  const ctx = {
    name: (id) => byId[id] && shownName(byId[id]),
    fullName: (id) => byId[id] && byId[id].name,
    image: (id) => (byId[id] && byId[id].image) || null,
    // straight to the chosen shop's offer: the merchant's page via BestPrice,
    // or the Skroutz product page with that shop's listing selected
    url: (it, s) => {
      const item = byId[it.productId] || { id: it.productId };
      if (s.key.startsWith('sbp')) return it.url || (state.bp[item.id] && state.bp[item.id].item && state.bp[item.id].item.url) || productUrl(item);
      const base = productUrl(item);
      return it.cardId ? `${base}${base.includes('?') ? '&' : '?'}product_id=${it.cardId}` : base;
    },
  };
  panel.classList.toggle('stale', !!(tabs.find((x) => x.key === active) || {}).stale);
  update(panel, active === 'single' ? panelSingle(c, ctx)
    : active === 'skroutz' ? panelSkroutz(c, ctx)
    : panelMix(c, ctx));
  saveSnapshot();
}

function renderAddCurrent() {
  // always the same size, so the popup does not jump when it opens on another page
  const btn = $('add-current');
  const tab = state.currentTab;
  btn.classList.toggle('idle', !tab);
  if (!tab) {
    btn.disabled = true;
    btn.textContent = t('openProduct');
    return;
  }
  const inCart = tab.kind === 'bp' ? bpInCart(tab.id) : state.cart.some((p) => p.id === tab.id);
  btn.disabled = inCart;
  btn.textContent = inCart ? t('inList') : t('addCurrent');
}

function render() {
  renderSkAccess();
  renderAddCurrent();
  renderProducts();
  renderResults();
}

// ---------- access to skroutz.gr ----------
// Chrome lets the user turn an extension's site access off ("On click"). For
// skroutz.gr that stops everything (prices, the page button), so it is said
// at the top, with a way to allow it again (as for bestprice.gr, see accessNotice).
const SK_ACCESS = { origins: ['https://www.skroutz.gr/*'] };
async function checkSkAccess() {
  try { state.skAccess = await chrome.permissions.contains(SK_ACCESS); } catch { state.skAccess = true; }
}
function renderSkAccess() {
  const box = $('sk-access');
  box.hidden = state.skAccess !== false;
  if (box.hidden) return;
  update(box,
    h('p', {}, state.skAccessErr ? t('skAccessErr') : t('skAccess')),
    h('button', {
      class: 'btn small', type: 'button',
      // straight from the click: the browser asks only then
      onclick: () => chrome.permissions.request(SK_ACCESS).then((ok) => {
        state.skAccess = ok;
        state.skAccessErr = !ok;
        render();
        if (ok) { state.status = {}; loadAll(true); }
      }, () => { state.skAccessErr = true; render(); }),
    }, t('allow')));
}

// ---------- wiring ----------
async function init() {
  // everything the first drawing needs, read at the same time
  const tabQuery = chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  await Promise.all([load(), checkBpAccess(), checkSkAccess()]);
  setLang(state.settings.lang || defaultLang());
  applyStatic(document);
  for (const r of document.querySelectorAll('input[name="lang"]')) {
    r.checked = r.value === (state.settings.lang || defaultLang());
    r.addEventListener('change', () => {
      state.settings.lang = r.value;
      saveSettings();
      setLang(r.value);
      applyStatic(document);
      render();
    });
  }

  // first-run guide: shown until dismissed, and again from the settings
  const showGuide = (on) => { $('welcome').hidden = !on; saveSnapshot(); };
  $('welcome').hidden = !!state.settings.welcomed;
  $('welcome-ok').addEventListener('click', () => { state.settings.welcomed = true; saveSettings(); showGuide(false); });
  $('guide-btn').addEventListener('click', () => { showGuide(true); $('settings').hidden = true; $('settings-btn').setAttribute('aria-expanded', 'false'); });

  $('settings-btn').addEventListener('click', () => {
    const open = $('settings').hidden;
    $('settings').hidden = !open;
    $('settings-btn').setAttribute('aria-expanded', String(open));
  });
  $('plus').checked = !!state.settings.hasPlus;
  $('plus').addEventListener('change', (e) => { state.settings.hasPlus = e.target.checked; saveSettings(); render(); });
  for (const r of document.querySelectorAll('input[name="delivery"]')) {
    r.checked = r.value === state.settings.delivery;
    r.addEventListener('change', () => { state.settings.delivery = r.value; saveSettings(); render(); });
  }
  $('bp-on').checked = state.settings.bestprice !== false;
  $('bp-on').addEventListener('change', (e) => {
    state.settings.bestprice = e.target.checked;
    saveSettings();
    render();
    if (e.target.checked) loadAllBp();
  });
  $('avail').value = state.settings.avail || 'any';
  $('avail').addEventListener('change', (e) => { state.settings.avail = e.target.value; saveSettings(); render(); });
  $('max-days').value = String(+state.settings.maxDays || 0);
  $('max-days').addEventListener('change', (e) => { state.settings.maxDays = +e.target.value || 0; saveSettings(); render(); });

  $('add-current').addEventListener('click', () => {
    const tab = state.currentTab;
    if (!tab) return;
    if (tab.kind === 'bp') addBestPrice(tab.url); else addSkroutz(tab.url);
  });
  $('refresh').addEventListener('click', () => loadAll(true));
  $('clear').addEventListener('click', emptyCart);
  $('cart-toggle').addEventListener('click', () => { state.settings.cartHidden = !state.settings.cartHidden; saveSettings(); renderProducts(); });
  $('undo').addEventListener('click', undo);

  // The page button (content script) and the background lookup may change the data while the popup is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    // the background finished looking products up: read here whatever it could not
    if (area === 'session') {
      if (!changes.lookups) return;
      const before = state.bgLookups;
      state.bgLookups = changes.lookups.newValue || {};
      if (Object.keys(before).some((id) => !state.bgLookups[id])) { render(); loadAll(); }
      return;
    }
    if (area !== 'local') return;
    if (changes.history) { state.history = changes.history.newValue || []; $('undo').disabled = !state.history.length; }
    // what is stored now: this window's next save of these merges onto it (see saveMap)
    if (changes.offers) syncedMaps.offers = copy(changes.offers.newValue || {});
    if (changes.bp) syncedMaps.bp = copy(changes.bp.newValue || {});
    let fresh = false;
    for (const [id, o] of Object.entries((changes.offers && changes.offers.newValue) || {})) {
      if (o && o.v === OFFERS_VER && !(state.offers[id] && state.offers[id].ts >= o.ts)) { state.offers[id] = o; delete state.status[id]; fresh = true; }
    }
    for (const [id, r] of Object.entries((changes.bp && changes.bp.newValue) || {})) {
      const cur = state.bp[id];
      if (r && r.v === BP_VER && state.bpStatus[id] !== 'loading' && !(cur && (cur.manual || (cur.offersTs || 0) >= (r.offersTs || 0)))) { state.bp[id] = r; fresh = true; }
    }
    if (fresh && !changes.cart) { if (fixNames()) renderProducts(); renderResults(); }
    if (!changes.cart) return;
    // this window's own save reported back (or one older than what it has seen): nothing new
    const rev = changes.cartRev ? changes.cartRev.newValue || 0 : null;
    if (rev != null && rev <= synced.rev) return;
    // changed elsewhere (the page button): taken in, keeping the changes made here meanwhile
    const next = Array.isArray(changes.cart.newValue) ? changes.cart.newValue : [];
    const merged = mergeCart(synced.cart, state.cart, next);
    synced = { rev: rev ?? synced.rev, cart: copy(next) };
    if (canon(merged) === canon(state.cart)) return;
    state.cart = merged;
    render();
    loadAll();
  });

  try {
    const [tab] = await tabQuery;
    const url = (tab && tab.url) || '';
    const sk = url.match(PRODUCT_URL);
    const bp = parseItemLink(url);
    if (sk) state.currentTab = { kind: 'sk', id: sk[1], url };
    else if (bp) state.currentTab = { kind: 'bp', id: bp.id, url: bp.url };
  } catch { /* no tab access */ }

  // a background lookup that ends without a word (the browser stopped it): read those products here
  const started = Object.values(state.bgLookups).filter((ts) => Date.now() - ts < 90000);
  if (started.length) setTimeout(() => loadAll(), Math.max(...started) + 90000 - Date.now() + 200);

  render();
  // the upgrade put products added from BestPrice back in the list (see load)
  if (state.restored.length) flash(t('restoredFromBp', { names: state.restored.join(', ') }));
  loadAll();
}

init();
