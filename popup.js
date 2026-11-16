import { parseShopsList, parseSkroutzSearch } from './lib/parser.js';
import { optimize } from './lib/optimizer.js';
import { t, count, setLang, defaultLang, applyStatic } from './lib/i18n.js';
import { findMatch, fetchOffers as fetchBpOffers, fetchItemMeta, titleCodes, parseItemLink, rank, evidence } from './lib/bestprice.js';

const ORIGIN = 'https://www.skroutz.gr';
const CACHE_TTL = 15 * 60 * 1000;
const HISTORY_MAX = 30;
const PRODUCT_URL = /^https?:\/\/(?:www\.)?skroutz\.gr\/s\/(\d+)(\/[^?#\s]*)?/i;
const BP_VER = 4;     // BestPrice records: bump when their shape changes
const OFFERS_VER = 2; // cached Skroutz price lists: bump when their shape changes

const state = {
  // [{id, url, name, image, qty, mpn, brand}], or, for a product added from
  // BestPrice whose Skroutz twin is not settled yet, a placeholder
  // {id: 'bp<itemId>', name, bpItem: {id, url, name}, qty, searched, skCands}
  cart: [],
  // avail: 'any' | 'stock' | 'now'; maxDays: 0 (any) or a number of days
  settings: { hasPlus: false, delivery: 'point', bestprice: true, avail: 'any', maxDays: 0 },
  lockEdit: null,                             // product whose "buy from this shop" chooser is open
  long: {},                                   // result tab -> inputs it was asked to search longer for
  openTab: null,                              // result tab whose details are open (none when the popup opens)
  offers: {},                                 // id -> {ts, name, offers, titles}
  status: {},                                 // id -> 'loading' | 'error'
  bp: {},                                     // Skroutz id -> {v, item, candidates, confident, manual, searched, offers, offersTs}
  bpStatus: {},                               // Skroutz id -> 'loading' | 'error'
  bpEdit: null,                               // Skroutz id whose BestPrice match is being changed
  bpPaste: null,                              // Skroutz id whose "paste a BestPrice link" box is open
  phStatus: {},                               // placeholder id -> 'loading' | 'error'
  history: [],                                // earlier versions of the cart, newest last (for Undo)
  currentTab: null,                           // {kind: 'sk'|'bp', id, url} when the active tab is a product page
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
  const data = await chrome.storage.local.get(['cart', 'settings', 'offers', 'history', 'bp']);
  state.bp = {};
  for (const [id, rec] of Object.entries(data.bp || {})) {
    if (!rec) continue;
    if (rec.v === BP_VER) state.bp[id] = rec;
    // version 3 matches are still right; only their saved prices lack stock and links
    else if (rec.v === 3) state.bp[id] = { ...rec, v: BP_VER, offers: null, offersTs: 0 };
  }
  state.history = Array.isArray(data.history) ? data.history : [];
  state.cart = Array.isArray(data.cart) ? data.cart : [];
  Object.assign(state.settings, data.settings || {});
  state.offers = {};
  for (const [id, o] of Object.entries(data.offers || {})) if (o && o.v === OFFERS_VER) state.offers[id] = o;
}
const saveCart = () => chrome.storage.local.set({ cart: state.cart });
/** Call right before changing the cart, so Undo can bring this version back. */
function remember() {
  state.history.push(JSON.parse(JSON.stringify(state.cart)));
  if (state.history.length > HISTORY_MAX) state.history.shift();
  chrome.storage.local.set({ history: state.history });
}
const saveSettings = () => chrome.storage.local.set({ settings: state.settings });
function saveOffers() {
  const ids = new Set(state.cart.map((p) => p.id));
  for (const id of Object.keys(state.offers)) if (!ids.has(id)) delete state.offers[id];
  return chrome.storage.local.set({ offers: state.offers });
}
function saveBp() {
  // keep matches for products that Undo could still bring back
  const keep = new Set(state.cart.map((p) => p.id));
  for (const past of state.history) for (const p of past) keep.add(p.id);
  for (const id of Object.keys(state.bp)) if (!keep.has(id)) delete state.bp[id];
  return chrome.storage.local.set({ bp: state.bp });
}

// ---------- Skroutz ----------
async function fetchOffers(id) {
  // credentials are omitted on purpose: we always read the public price list,
  // and apply Skroutz Plus ourselves from the setting.
  const res = await fetch(`${ORIGIN}/s/${id}/shops_list`, { credentials: 'omit', headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'Product not found' : `Skroutz answered ${res.status}`);
  return parseShopsList(new DOMParser().parseFromString(await res.text(), 'text/html'));
}

/** Name, picture, manufacturer part number and brand from a Skroutz product page. */
async function getMeta(id, url) {
  const res = await fetch(url || `${ORIGIN}/s/${id}/p.html`, { credentials: 'omit' });
  if (!res.ok) return null;
  const html = await res.text();
  const meta = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]*)"`, 'i'));
    return m ? new DOMParser().parseFromString(m[1], 'text/html').documentElement.textContent : null;
  };
  const out = { name: meta('title'), image: meta('image'), mpn: '', brand: '', url: null };
  try {
    const ld = JSON.parse(html.match(/<script[^>]+id="product-schema"[^>]*>([\s\S]*?)<\/script>/i)[1]);
    out.mpn = typeof ld.mpn === 'string' ? ld.mpn : '';
    out.brand = (ld.brand && ld.brand.name) || '';
  } catch { /* no structured data */ }
  if (res.url && PRODUCT_URL.test(res.url)) out.url = res.url.split(/[?#]/)[0];
  return out;
}

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

const offerJobs = new Map();
function loadOffers(id, force = false) {
  const cached = state.offers[id];
  if (!force && cached && Date.now() - cached.ts < CACHE_TTL) return Promise.resolve();
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
    console.warn('CartWise:', id, e);
  }
  render();
}

async function searchSkroutz(query) {
  const res = await fetch(`${ORIGIN}/search?keyphrase=${encodeURIComponent(query)}`, { credentials: 'omit', headers: { Accept: 'text/html' } });
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
  let rec = state.bp[id] || (ph ? { v: BP_VER, item: { ...item.bpItem }, candidates: [], searched: true, confident: true, manual: true } : {});
  const fresh = rec.offers && Date.now() - rec.offersTs < CACHE_TTL;
  if (!force && (fresh || (rec.searched && !rec.item))) return;
  state.bpStatus[id] = 'loading';
  renderResults();
  try {
    if (!rec.item) {
      if (item.mpn === undefined) await fetchMeta(item);
      await loadOffers(id); // the shops' listing titles help to verify the match
      const live = state.cart.find((p) => p.id === id) || item;
      const name = live.name.startsWith('Product ') ? (state.offers[id]?.name || live.name) : live.name;
      const m = await findMatch({ name, mpn: live.mpn || '', brand: live.brand || '', titles: state.offers[id]?.titles || [] });
      rec = { v: BP_VER, ...m, searched: true, offersTs: m.offers ? Date.now() : 0 };
    }
    if (rec.item && !(rec.offers && Date.now() - rec.offersTs < 60000)) {
      const page = await fetchBpOffers(rec.item.url);
      rec.offers = page.offers;
      rec.offersTs = Date.now();
      if (!rec.item.name) rec.item.name = page.name || (await fetchItemMeta(rec.item.url)).name || 'BestPrice product';
    }
    state.bp[id] = rec;
    delete state.bpStatus[id];
    saveBp();
  } catch (e) {
    state.bpStatus[id] = 'error';
    console.warn('CartWise (BestPrice):', id, e);
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
  for (const p of state.cart) if (isPh(p) && (!p.searched || force || p.name === 'BestPrice product')) resolvePh(p.id);
  const on = state.settings.bestprice !== false;
  const queue = state.cart.filter((p) => (isPh(p) ? p.searched && !force : on)).map((p) => p.id);
  const worker = async () => { while (queue.length) await loadBp(queue.shift(), force); };
  await Promise.all([worker(), worker()]);
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
          adopt(phId, cand, page);
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
      if (top && top.base >= 0.75 && (!next || top.base - next.base >= 0.15)) adopt(phId, top, page);
      else {
        const live = state.cart.find((p) => p.id === phId);
        if (live) { live.skCands = open; live.searched = true; saveCart(); }
      }
    }
    delete state.phStatus[phId];
  } catch (e) {
    state.phStatus[phId] = 'error';
    console.warn('CartWise (Skroutz search):', phId, e);
  }
  render();
}

/** Replace a BestPrice placeholder with the Skroutz product it corresponds to. */
function adopt(phId, cand, page) {
  const i = state.cart.findIndex((p) => p.id === phId);
  if (i < 0) return;
  const ph = state.cart[i];
  state.bp[cand.id] = {
    v: BP_VER, item: { ...ph.bpItem, name: ph.bpItem.name || ph.name }, candidates: [],
    searched: true, confident: true, manual: true,
    offers: page ? page.offers : null, offersTs: page ? Date.now() : 0,
  };
  if (state.cart.some((p) => p.id === cand.id)) state.cart.splice(i, 1);
  else {
    state.cart[i] = { id: cand.id, url: cand.url, name: cand.name, image: cand.image || null, mpn: cand.mpn, brand: cand.brand, qty: ph.qty || 1 };
    if (ph.lock) state.cart[i].lock = ph.lock; // a BestPrice merchant chosen before the match
  }
  delete state.bp[phId];
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
  if (cand) adopt(phId, cand, null);
}

async function loadAll(force = false) {
  const queue = state.cart.filter((p) => !isPh(p)).map((p) => p.id);
  const worker = async () => { while (queue.length) await loadOffers(queue.shift(), force); };
  $('refresh').classList.add('spin');
  await Promise.all([worker(), worker(), worker(), loadAllBp(force)]);
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
  state.cart = state.history.pop().map((p) => {
    // keep the name / picture we have learned since that version was saved
    const now = current[p.id];
    return now ? { ...p, name: now.name, image: now.image || p.image, url: now.url || p.url } : p;
  });
  chrome.storage.local.set({ history: state.history });
  saveCart();
  flash('');
  render();
  loadAll();
  for (const item of state.cart) if (!isPh(item) && !item.image) fetchMeta(item);
}

// ---------- offers of a product: both sites, shop choice, availability ----------
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
 * (or its Plus eligibility). A chosen shop ("buy only from…") narrows both
 * lists down to that shop; if the shop no longer sells it, the choice is ignored.
 */
function sources(item) {
  const raw = rawOffers(item);
  let sk = raw.sk;
  let bp = raw.bp.map((o) => ({ ...o, shopId: 'bp' + o.shopId }));
  let lockLost = false;
  if (item.lock) {
    const fromBp = item.lock.src === 'bp';
    const pick = (fromBp ? bp : sk).filter((o) => o.shopId === (fromBp ? 'bp' : '') + item.lock.shopId);
    if (pick.length) { sk = fromBp ? [] : pick; bp = fromBp ? pick : []; }
    else lockLost = fromBp ? !!(state.bp[item.id] && state.bp[item.id].offers) : !!state.offers[item.id];
  }
  return { sk, bp, lockLost };
}

const filtersOn = () => (state.settings.avail && state.settings.avail !== 'any') || !!+state.settings.maxDays;
function passes(o) {
  const s = state.settings;
  if (s.avail === 'stock' && o.stock === false) return false;
  if (s.avail === 'now' && !o.immediate) return false;
  if (+s.maxDays && !(o.days != null && o.days <= +s.maxDays)) return false;
  return true;
}

function setLock(id, value) {
  const item = state.cart.find((p) => p.id === id);
  if (!item) return;
  let lock = null;
  if (value) {
    const src = value.slice(0, 2);
    const shopId = value.slice(3);
    const raw = rawOffers(item);
    const o = (src === 'bp' ? raw.bp : raw.sk).find((x) => x.shopId === shopId);
    if (!o) return;
    lock = { src, shopId, shopName: o.shopName };
  }
  remember();
  if (lock) item.lock = lock; else delete item.lock;
  state.lockEdit = null;
  saveCart();
  render();
}

// ---------- rendering: products ----------
const LOCK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
function icon(svg) {
  const el = document.createElement('span');
  el.className = 'ico';
  el.innerHTML = svg; // constant markup from this file only
  return el;
}

function placeholderMeta(item) {
  const status = state.phStatus[item.id];
  if (status === 'loading' || (!item.searched && status !== 'error')) return h('div', { class: 'p-meta dots' }, t('findingOnSk'));
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

function productMeta(item) {
  if (isPh(item)) return placeholderMeta(item);
  const data = state.offers[item.id];
  const status = state.status[item.id];
  if (status === 'loading' && !data) return h('div', { class: 'p-meta dots' }, t('checking'));
  if (status === 'error' && !data) {
    return h('div', { class: 'p-meta err' }, t('loadErr'),
      h('button', { class: 'retry', onclick: () => loadOffers(item.id, true) }, t('retry')));
  }
  if (data && !data.offers.length) return h('div', { class: 'p-meta err' }, t('noStore'));
  if (!data) return h('div', { class: 'p-meta' }, ' ');
  const min = Math.min(...data.offers.map((o) => o.price));
  const shops = new Set(data.offers.map((o) => o.shopId)).size;
  const hub = data.offers.some((o) => o.hub);
  return h('div', { class: 'p-meta' }, t('fromStores', { price: eur(min), stores: count(shops, 'store') }),
    hub && ' · ', hub && h('span', { class: 'badge hub' }, 'Hub'));
}

/** "Buy this product only from…": the chooser while it is open, else the current choice. */
function lockRow(item) {
  if (state.lockEdit === item.id) {
    const raw = rawOffers(item);
    const shops = (offers) => {
      const m = new Map();
      for (const o of offers) {
        const e = m.get(o.shopId);
        if (!e || o.price < e.price) m.set(o.shopId, { id: o.shopId, name: o.shopName, price: o.price });
      }
      return [...m.values()].sort((a, b) => a.price - b.price);
    };
    const cur = item.lock ? `${item.lock.src}:${item.lock.shopId}` : '';
    const group = (label, src, offers) => offers.length > 0 && h('optgroup', { label },
      shops(offers).map((s) => h('option', { value: `${src}:${s.id}`, selected: cur === `${src}:${s.id}` }, `${s.name} · ${eur(s.price)}`)));
    return h('div', { class: 'p-pick' },
      h('select', { 'aria-label': t('lockLabel'), onchange: (e) => setLock(item.id, e.target.value) },
        h('option', { value: '', selected: !cur }, t('anyShop')),
        group('Skroutz', 'sk', raw.sk),
        group('BestPrice', 'bp', raw.bp)));
  }
  if (!item.lock) return null;
  const lost = sources(item).lockLost;
  return h('div', { class: 'p-lock' + (lost ? ' err' : '') }, icon(LOCK_ICON),
    h('span', {}, t(lost ? 'lockLost' : 'lockedTo', { shop: item.lock.shopName })));
}

function renderProducts() {
  $('products').replaceChildren(...state.cart.map((item) => h('li', { class: 'product' },
    item.image
      ? h('img', { class: 'thumb-img', src: item.image, alt: '', loading: 'lazy' })
      : h('div', { class: 'thumb-img blank' }, '🛒'),
    h('div', { class: 'p-main' },
      h('a', { class: 'p-name', href: productUrl(item), target: '_blank', rel: 'noreferrer', title: item.name }, item.name),
      productMeta(item),
      lockRow(item)),
    h('div', { class: 'p-side' },
      h('div', { class: 'qty' },
        h('button', { onclick: () => setQty(item.id, -1), 'aria-label': t('less') }, '−'),
        h('span', {}, item.qty || 1),
        h('button', { onclick: () => setQty(item.id, 1), 'aria-label': t('more') }, '+')),
      h('button', {
        class: 'lock-btn' + (item.lock ? ' on' : ''), title: t('lockTitle'), 'aria-label': t('lockTitle'),
        'aria-expanded': String(state.lockEdit === item.id),
        onclick: () => { state.lockEdit = state.lockEdit === item.id ? null : item.id; renderProducts(); },
      }, icon(LOCK_ICON)),
      h('button', { class: 'remove', title: t('remove'), 'aria-label': t('remove'), onclick: () => removeProduct(item.id) }, '×')))));
  $('count').textContent = state.cart.length;
  $('clear').disabled = state.cart.length === 0;
  $('undo').disabled = state.history.length === 0;
}

// ---------- rendering: result cards ----------
/** ctx: {name(id), url(item, shipment)} */
function shipmentView(s, ctx, hideHead = false) {
  const title = s.hub
    ? [h('span', { class: 'badge hub' }, 'Skroutz Hub'), h('span', {}, s.shops.join(' + '))]
    : [s.showSrc && h('span', { class: 'badge ' + (s.src === 'BestPrice' ? 'bp' : 'sk') }, s.src), h('span', {}, s.shops[0])];
  const ship = s.fee > 0
    ? h('span', { class: 'v' }, (s.feeEstimated ? '≈ ' : '') + eur(s.fee))
    : h('span', { class: 'v free' }, s.feeReason === 'plus' ? t('freePlus') : t('free'));
  return h('div', { class: 'shipment' },
    !hideHead && h('div', { class: 's-head' }, title),
    s.items.map((it) => {
      const name = ctx.name(it.productId) || it.name;
      return h('div', { class: 'row' },
        h('span', { class: 'n' },
          // the link opens this shop's own offer
          h('a', { href: ctx.url(it, s), target: '_blank', rel: 'noreferrer', title: name + (it.eta ? ` · ${it.eta}` : '') },
            (it.qty > 1 ? `${it.qty} × ` : '') + name),
          s.hub && s.shops.length > 1 && h('em', {}, ` · ${it.shopName}`)),
        it.stock === false && h('span', { class: 'badge warn avail', title: it.eta || '' },
          it.days != null ? t('etaDays', { n: it.days }) : t('notInStock')),
        h('span', { class: 'v' }, eur(it.price)));
    }),
    h('div', { class: 'row ship' }, h('span', { class: 'n' }, t('shipping')), ship));
}

function resultCard({ kicker, title, sol, badge, note, warn, extra }, ctx) {
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
    extra);
}

const notice = (...content) => h('div', { class: 'notice' }, content);
const dots = (text) => h('span', { class: 'dots' }, text);

// ---------- calculating (in a worker, so the popup never freezes) ----------
const skroutzSettings = () => ({
  hasPlus: state.settings.hasPlus,
  delivery: state.settings.delivery,
  // Skroutz Plus: free per shipment from 15 € to a Skroutz Point, 25 € to an address
  plusMin: state.settings.delivery === 'home' ? 25 : 15,
});

const calc = {}; // tab -> {key, result, products, settings}
let worker = null;
let workerTimer = null;

/** The result for these inputs if it is ready; otherwise starts the calculation and returns null. */
function requestCalc(tab, key, products, settings) {
  const cur = calc[tab];
  if (cur && cur.key === key) return cur.result;
  calc[tab] = { key, result: null, products, settings };
  if (!workerTimer) workerTimer = setTimeout(runWorker, 0);
  return null;
}

/** Drops whatever is running (its inputs are out of date) and queues every unfinished tab. */
function runWorker() {
  workerTimer = null;
  const todo = ['skroutz', 'bestprice', 'overall'].filter((tab) => calc[tab] && !calc[tab].result);
  if (!todo.length) return;
  try {
    if (worker) worker.terminate();
    worker = new Worker(chrome.runtime.getURL('lib/worker.js'), { type: 'module' });
    worker.onmessage = (e) => {
      const { tab, key, result } = e.data;
      if (calc[tab] && calc[tab].key === key) { calc[tab].result = result; renderResults(); }
    };
    worker.onerror = () => { worker = null; todo.forEach(calcHere); renderResults(); };
    for (const tab of todo) {
      const j = calc[tab];
      worker.postMessage({ tab, key: j.key, products: j.products, settings: j.settings });
    }
  } catch {
    todo.forEach(calcHere); // no worker available: calculate here
    renderResults();
  }
}
function calcHere(tab) {
  const j = calc[tab];
  if (!j || j.result) return;
  try { j.result = optimize(j.products, j.settings); } catch (e) { j.result = { error: String(e.message || e) }; }
}

/** Products and offers for one tab. */
function tabProducts(kind, list) {
  const products = [];
  const info = { other: 0, unfiltered: [], missing: [] };
  for (const { item, sk, bp } of list) {
    let offers;
    if (kind === 'skroutz') { offers = sk.length ? sk : bp; if (!sk.length && bp.length) info.other++; }
    else if (kind === 'bestprice') { offers = bp.length ? bp : sk; if (!bp.length && sk.length) info.other++; }
    else offers = [...sk, ...bp];
    if (!offers.length) { info.missing.push(item.id); continue; }
    const ok = offers.filter(passes);
    if (ok.length) offers = ok; else if (filtersOn()) info.unfiltered.push(item.id);
    products.push({ id: item.id, name: item.name, qty: item.qty || 1, offers });
  }
  return { products, info };
}

function compute() {
  const c = { bpOn: state.settings.bestprice !== false, real: state.cart.filter((p) => !isPh(p)), tabs: {} };
  const phs = state.cart.filter(isPh);
  const pending = c.real.filter((p) => !state.offers[p.id]);

  if (phs.some((p) => state.phStatus[p.id] === 'loading' || (!p.searched && state.phStatus[p.id] !== 'error'))) {
    c.wait = true;
    c.block = dots(t('findingSkProduct'));
  } else if (pending.length) {
    c.wait = !pending.some((p) => state.status[p.id] === 'error');
    c.block = c.wait ? dots(t('collecting')) : t('someFailed');
  }

  c.recs = c.real.map((item) => ({ item, rec: state.bp[item.id] || {}, status: state.bpStatus[item.id] }));
  c.busy = c.bpOn && state.bpAccess !== false
    && c.recs.some((r) => r.status === 'loading' || (!r.rec.searched && !r.rec.item && r.status !== 'error'));
  c.priced = c.recs.filter((r) => r.rec.item && r.rec.offers && r.rec.offers.length);
  if (c.block) return c;

  const list = state.cart.map((item) => ({ item, ...sources(item) }));
  const s = state.settings;
  const sig = [s.hasPlus ? 1 : 0, s.delivery, s.avail || 'any', +s.maxDays || 0, c.bpOn ? 1 : 0, state.bpAccess === false ? 0 : 1,
    ...state.cart.map((p) => [p.id, p.qty || 1, p.lock ? p.lock.src + p.lock.shopId : '',
      (state.offers[p.id] && state.offers[p.id].ts) || 0,
      (state.bp[p.id] && state.bp[p.id].offersTs) || 0,
      (state.bp[p.id] && state.bp[p.id].item && state.bp[p.id].item.id) || ''].join(':'))].join('|');

  const want = (kind) => {
    const { products, info } = tabProducts(kind, list);
    const tab = { info, base: `${kind}|${sig}` };
    if (info.missing.length) { tab.block = t('removeMissing'); return tab; }
    const long = state.long[kind] === tab.base;
    tab.res = requestCalc(kind, tab.base + (long ? '|long' : ''), products,
      { ...skroutzSettings(), budgetMs: long ? 45000 : 5000 });
    return tab;
  };

  // a product tied to a BestPrice merchant needs the BestPrice prices first
  const bpLock = state.cart.some((p) => p.lock && p.lock.src === 'bp');
  if (!(bpLock && c.busy)) c.tabs.skroutz = want('skroutz');
  if (c.bpOn && state.bpAccess !== false && !c.busy) {
    c.usesBp = list.some((x) => x.bp.length > 0);
    c.tabs.bestprice = want('bestprice');
    c.tabs.overall = want('overall');
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

function notesFor(tab, sol) {
  const notes = [];
  if (tab.info.unfiltered.length) notes.push(t('filterIgnored', { n: count(tab.info.unfiltered.length, 'product') }));
  if (sol.shipments.some((s) => s.feeEstimated)) notes.push(t('estShort'));
  return notes;
}

/** "Best found, not proven cheapest" with a way to let the search run longer. */
function stoppedNote(kind, tab, sol) {
  if (sol.exact) return null;
  return h('div', { class: 'r-note' }, t('bestFound'), ' ',
    state.long[kind] !== tab.base && h('button', { class: 'link-btn', onclick: () => { state.long[kind] = tab.base; renderResults(); } }, t('searchLonger')));
}

// ---------- the four panels ----------
function panelSingle(c, ctx) {
  const tab = c.tabs.skroutz;
  const wait = notReady(c, tab);
  if (wait) return wait;
  const n = state.cart.length;
  const single = tab.res.single[0];
  if (!single) return [notice(t('noSingle', { n }))];
  const others = tab.res.single.slice(1);
  const mixed = tagSources(single, tab.info.other > 0);
  for (const o of others) tagSources(o, false);
  const hubStores = single.hub ? single.shipments[0].shops.length : 0;
  const best = single.total <= tab.res.overall.total + 0.004;
  return [resultCard({
    kicker: t('bestSingle'),
    title: single.hub ? `Skroutz Hub · ${count(hubStores, 'store')}` : single.label,
    sol: single,
    badge: n > 1 && (best
      ? h('span', { class: 'badge win' }, t('alsoCheapestSk'))
      : h('span', { class: 'badge warn' }, t('moreThanSplit', { amount: eur(single.total - tab.res.overall.total) }))),
    note: [mixed.bp > 0 && t('skOther', { n: count(tab.info.other, 'product') }), ...notesFor(tab, single)].filter(Boolean).join(' '),
    extra: others.length > 0 && h('details', { class: 'others' },
      h('summary', {}, t('moreSingles', { n: others.length })),
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
    badge: single && (saving > 0.004
      ? h('span', { class: 'badge save' }, t('savesVsSingle', { amount: eur(saving) }))
      : h('span', { class: 'badge win' }, t('sameAsSingle'))),
    note: [tab.info.other > 0 && t('skOther', { n: count(tab.info.other, 'product') }), ...notesFor(tab, overall)].filter(Boolean).join(' '),
    warn: stoppedNote('skroutz', tab, overall),
  }, ctx)];
}

function accessNotice() {
  return notice(
    h('p', {}, h('b', {}, t('access1'))),
    h('p', {}, state.bpAccessErr ? t('access2err') : t('access2')),
    h('p', { style: 'margin-top:6px' }, h('button', { class: 'btn small', onclick: grantBpAccess }, t('allow'))));
}

function matchRow(item) {
  const rec = state.bp[item.id] || {};
  const status = state.bpStatus[item.id];
  const cands = rec.candidates || [];
  let tag = null;
  if (status === 'loading') tag = h('span', { class: 'dots' }, t('searching'));
  else if (status === 'error') tag = h('span', { class: 'badge bad' }, t('couldNotLoad'));
  else if (!rec.item) tag = cands.length ? h('span', { class: 'badge warn' }, t('notSure')) : h('span', { class: 'badge bad' }, t('notFound'));
  else if (rec.offers && !rec.offers.length) tag = h('span', { class: 'badge bad' }, t('noMerchants'));

  let body = null;
  if (state.bpPaste === item.id) {
    const input = h('input', { type: 'text', placeholder: 'https://www.bestprice.gr/item/…', spellcheck: 'false' });
    const submit = () => { if (!pasteMatch(item.id, input.value)) input.style.outline = '2px solid var(--bad)'; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    body = h('div', { class: 'm-pick' }, input,
      h('button', { class: 'btn small', onclick: submit }, t('use')),
      h('button', { class: 'btn small', onclick: () => { state.bpPaste = null; state.bpEdit = null; renderResults(); } }, t('cancel')));
    setTimeout(() => input.focus());
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
    h('div', { class: 'm-src' }, h('span', { title: item.name }, item.name), tag),
    body);
}

function panelBestPrice(c, ctx) {
  if (state.bpAccess === false) return [accessNotice()];
  if (c.block) return [notice(c.block)];
  const n = c.recs.length;
  const open = c.priced.length < n || state.bpEdit != null || state.bpPaste != null;
  const matches = n > 0 && h('details', { class: 'matches', open },
    h('summary', {}, t('matched')),
    c.real.map(matchRow));
  const shell = (title, note) => [h('article', { class: 'result' },
    h('div', { class: 'r-head' }, h('div', {},
      h('div', { class: 'r-kicker' }, t('cheapestBp')),
      h('div', { class: 'r-title' }, title))),
    note && h('div', { class: 'r-note' }, note),
    matches)];

  const tab = c.tabs.bestprice;
  if (c.busy || !tab) return shell(dots(t('searchingBp')));
  if (tab.block) return shell(t('noTotal'), tab.block);
  // nothing at all could be priced on BestPrice: a total would just repeat Skroutz
  if (!c.usesBp) return shell(t('noTotal'), t('unmatchedNote', { n, total: count(n, 'product') }));
  if (!tab.res) return shell(dots(t('calculating')));
  if (tab.res.error) return shell(t('noTotal'), t('calcError', { msg: tab.res.error }));

  const sol = tab.res.overall;
  const from = tagSources(sol, tab.info.other > 0);
  const merchants = sol.shipments.filter((s) => s.src === 'BestPrice').length;
  const skTotal = tabTotal(c.tabs.skroutz, (r) => r.overall.total);
  const diff = skTotal == null ? null : skTotal - sol.total;
  const badge = diff == null ? null
    : diff > 0.004 ? h('span', { class: 'badge save' }, t('cheaperThanSk', { amount: eur(diff) }))
    : diff < -0.004 ? h('span', { class: 'badge warn' }, t('skCheaper', { amount: eur(-diff) }))
    : h('span', { class: 'badge warn' }, t('sameAsSk'));
  const notes = [t('ownSite')];
  if (tab.info.other > 0) notes.push(t('bpOther', { n: count(tab.info.other, 'product') }));
  notes.push(...notesFor(tab, sol));
  return [resultCard({
    kicker: t('cheapestBp'),
    title: count(merchants, 'merchant') + (from.sk ? ` · ${t('nFromSk', { n: from.sk })}` : ''),
    sol,
    badge,
    note: notes.join(' '),
    warn: stoppedNote('bestprice', tab, sol),
    extra: matches,
  }, ctx)];
}

function panelOverall(c, ctx) {
  if (!c.block && state.bpAccess === false) return [accessNotice()];
  const tab = c.tabs.overall;
  const wait = notReady(c, tab);
  if (wait) return wait;

  const sol = tab.res.overall;
  const from = tagSources(sol, true);
  const n = c.recs.length;
  // compare with buying everything on one site, where that is possible
  const sk = c.tabs.skroutz && c.tabs.skroutz.info.other === 0 ? tabTotal(c.tabs.skroutz, (r) => r.overall.total) : null;
  const bp = c.usesBp && c.tabs.bestprice && c.tabs.bestprice.info.other === 0 ? tabTotal(c.tabs.bestprice, (r) => r.overall.total) : null;
  const alone = sk == null ? bp : bp == null ? sk : Math.min(sk, bp);
  const aloneName = alone != null && alone === bp && bp !== sk ? 'BestPrice' : 'Skroutz';
  const notes = [];
  if (from.bp) notes.push(t('bpItemsOwnSite'));
  if (c.priced.length < n) notes.push(t('noCertain', { n: n - c.priced.length, total: count(n, 'product') }));
  notes.push(...notesFor(tab, sol));
  return [resultCard({
    kicker: t('cheapestOverall'),
    title: !from.bp ? t('allSk') : !from.sk ? t('allBp') : t('split', { sk: from.sk, bp: from.bp }),
    sol,
    badge: alone == null ? null : alone - sol.total > 0.004
      ? h('span', { class: 'badge save' }, t('savesVs', { amount: eur(alone - sol.total), site: aloneName }))
      : h('span', { class: 'badge win' }, t('noMixGain')),
    note: notes.join(' '),
    warn: stoppedNote('overall', tab, sol),
  }, ctx)];
}

function renderResults() {
  const box = $('results');
  box.hidden = state.cart.length === 0;
  if (box.hidden) return;

  const c = compute();
  const sk = c.tabs.skroutz;
  const calcBusy = (tab) => !!c.wait || (!c.block && (!tab || (!tab.block && !tab.res)));
  const tabs = [
    { key: 'single', label: t('tabSingle'), total: tabTotal(sk, (r) => (r.single[0] ? r.single[0].total : null)), busy: calcBusy(sk) },
    { key: 'skroutz', label: 'Skroutz', total: tabTotal(sk, (r) => r.overall.total), busy: calcBusy(sk) },
    c.bpOn && { key: 'bestprice', label: 'BestPrice', total: c.usesBp ? tabTotal(c.tabs.bestprice, (r) => r.overall.total) : null,
      busy: state.bpAccess !== false && (c.busy || (c.usesBp !== false && calcBusy(c.tabs.bestprice))) },
    c.bpOn && { key: 'overall', label: t('tabOverall'), total: tabTotal(c.tabs.overall, (r) => r.overall.total),
      busy: state.bpAccess !== false && (c.busy || calcBusy(c.tabs.overall)) },
  ].filter(Boolean);
  // All tabs start closed; clicking a tab opens its details, clicking it again closes them.
  if (!tabs.some((x) => x.key === state.openTab)) state.openTab = null;
  const active = state.openTab;
  const totals = tabs.map((x) => x.total).filter((x) => x != null);
  const min = totals.length > 1 ? Math.min(...totals) : null;

  $('tabs').replaceChildren(...tabs.map((tab) => h('button', {
    class: 'tab' + (min != null && tab.total != null && tab.total <= min + 0.004 ? ' cheapest' : ''),
    type: 'button', 'aria-expanded': String(tab.key === active), 'aria-controls': 'panel',
    title: tab.key === active ? t('hideDetails') : t('showDetails'),
    onclick: () => { state.openTab = state.openTab === tab.key ? null : tab.key; renderResults(); },
  }, h('span', {}, tab.label), h('b', {}, tab.total != null ? eur(tab.total) : tab.busy ? '…' : '—'))));

  $('panel').hidden = !active;
  if (!active) { $('panel').replaceChildren(); return; }
  const byId = Object.fromEntries(state.cart.map((p) => [p.id, p]));
  const ctx = {
    name: (id) => byId[id] && byId[id].name,
    // straight to the chosen shop's offer: the merchant's page via BestPrice,
    // or the Skroutz product page with that shop's listing selected
    url: (it, s) => {
      const item = byId[it.productId] || { id: it.productId };
      if (s.key.startsWith('sbp')) return it.url || (state.bp[item.id] && state.bp[item.id].item && state.bp[item.id].item.url) || productUrl(item);
      const base = productUrl(item);
      return it.cardId ? `${base}${base.includes('?') ? '&' : '?'}product_id=${it.cardId}` : base;
    },
  };
  const panel = active === 'single' ? panelSingle(c, ctx)
    : active === 'skroutz' ? panelSkroutz(c, ctx)
    : active === 'bestprice' ? panelBestPrice(c, ctx)
    : panelOverall(c, ctx);
  $('panel').replaceChildren(...panel);
}

function renderAddCurrent() {
  const btn = $('add-current');
  const tab = state.currentTab;
  btn.hidden = !tab;
  $('add-hint').hidden = !!tab || state.cart.length > 0;
  if (!tab) return;
  const inCart = tab.kind === 'bp' ? bpInCart(tab.id) : state.cart.some((p) => p.id === tab.id);
  btn.disabled = inCart;
  btn.textContent = inCart ? t('inList') : t('addCurrent');
}

function render() {
  renderAddCurrent();
  renderProducts();
  renderResults();
}

// ---------- wiring ----------
async function init() {
  await load();
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
  $('undo').addEventListener('click', undo);

  // The page button (content script) may change the list while the popup is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.history) { state.history = changes.history.newValue || []; $('undo').disabled = !state.history.length; }
    if (!changes.cart) return;
    const next = changes.cart.newValue || [];
    if (JSON.stringify(next) === JSON.stringify(state.cart)) return;
    state.cart = next;
    render();
    loadAll();
  });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = (tab && tab.url) || '';
    const sk = url.match(PRODUCT_URL);
    const bp = parseItemLink(url);
    if (sk) state.currentTab = { kind: 'sk', id: sk[1], url };
    else if (bp) state.currentTab = { kind: 'bp', id: bp.id, url: bp.url };
  } catch { /* no tab access */ }

  await checkBpAccess();
  render();
  loadAll();
}

init();
