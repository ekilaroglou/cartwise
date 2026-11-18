// BestPrice.gr support: find the BestPrice product that corresponds to a
// Skroutz product (or the other way round), and read every merchant's price
// and shipping for it.

export const BP_ORIGIN = 'https://www.bestprice.gr';
const ITEM_PATH = /\/item\/(\d+)(?:\/[^?#]*)?/;

// ---------- text matching ----------

// Greek colour words in every form a title uses ("Μαύρο", "Μαύρη", "Μαύρα"...).
const COLORS = {};
const ENDINGS = ['ο', 'ος', 'η', 'α', 'ες', 'οι', 'ου', 'ης'];
for (const [stem, colour] of [['μαυρ', 'black'], ['λευκ', 'white'], ['ασπρ', 'white'], ['κοκκιν', 'red'], ['πρασιν', 'green'],
  ['κιτριν', 'yellow'], ['χρυσ', 'gold'], ['διαφαν', 'transparent'], ['ασημενι', 'silver']]) {
  for (const e of ENDINGS) COLORS[stem + e] = colour;
}
Object.assign(COLORS, {
  μπλε: 'blue', γκρι: 'grey', gray: 'grey', ροζ: 'pink', rose: 'pink', μωβ: 'purple', πορτοκαλι: 'orange',
  ασημι: 'silver', μπεζ: 'beige', tan: 'beige', καφε: 'brown',
});
const COLOR_NAMES = new Set([...Object.values(COLORS), 'graphite']);
const STOP = new Set(['με', 'και', 'σε', 'για', 'απο', 'with', 'and', 'for', 'the', 'of']);

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function tokens(s) {
  const out = new Set();
  for (let t of fold(s).split(/[^a-z0-9α-ω.]+/)) {
    t = t.replace(/^\.+|\.+$/g, '');
    if (!t || STOP.has(t)) continue;
    out.add(COLORS[t] || t);
  }
  return out;
}

const squash = (s) => fold(s).replace(/[^a-z0-9]/g, '');       // for part numbers
const norm = (s) => fold(s).replace(/[^a-z0-9α-ω]/g, '');      // for whole titles

// "165W", "25000mAh", "128GB", "0.9m" ... : figures that must agree between two names.
// The number must stand on its own: in model codes such as "B550M" or "A100W"
// the letters are part of the code, not a unit.
const UNITS = /(?<![a-zα-ω0-9.,])(\d+(?:[.,]\d+)?)\s?(gb|tb|mb|mah|wh|w|v|hz|dpi|mm|cm|m|τμχ|tmx|pcs|mp)(?![a-z0-9α-ω])/g;

function figures(name) {
  const out = {};
  const s = fold(name);
  for (const m of s.matchAll(UNITS)) {
    // a name that starts with "3M" is the brand, not three metres
    if (m[2] === 'm' && !s.slice(0, m.index).trim()) continue;
    (out[m[2]] ||= new Set()).add(String(parseFloat(m[1].replace(',', '.'))));
  }
  return out;
}

// "Καφέ" is the colour brown, but also coffee ("Μηχανή Καφέ", "Κάψουλες Καφέ").
// Next to one of these words it is the coffee (a second "Καφέ" is then the colour).
const COFFEE = /^(μηχαν|μυλ|καψουλ|φιλτρ|κουπ|φλιτζαν|κοκκ(ους|οι|ων)$|καφετιερ|espresso|nespresso|dolce|tassimo|frappe|φραπε|barista|στιγμιαι|ελληνικ|αλεσμεν|decaf|cappuccino|ροφημ)/;

/** The colours a product name states. */
function colours(name) {
  const words = fold(name).split(/[^a-z0-9α-ω.]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  const out = new Set();
  let kafe = 0;
  for (const w of words) {
    if (w === 'καφε') { kafe++; continue; }
    const c = COLORS[w] || (COLOR_NAMES.has(w) ? w : null);
    if (c) out.add(c);
  }
  if (kafe > (words.some((w) => COFFEE.test(w)) ? 1 : 0)) out.add('brown');
  return out;
}

const within = (x, y) => [...x].every((v) => y.has(v));

// Model codes: words that mix letters and digits ("A55", "1000XM4" of
// "WH-1000XM4", "DDR4", "i7"), each with the words around it. Figures with a
// unit ("128GB") are left to `figures`; "LR06" and "LR6" are the same code.
const UNIT_WORD = /^\d+(?:[.,]\d+)?(gb|tb|mb|mah|wh|w|v|hz|dpi|mm|cm|m|τμχ|tmx|pcs|mp)$/;
const unzero = (t) => t.replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, ''));
function models(name) {
  const w = fold(name).split(/[^a-z0-9α-ω.]+/).map((t) => t.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  return w.map((t, i) => (/\d/.test(t) && /[a-zα-ω]/.test(t) && !UNIT_WORD.test(t)
    ? { code: unzero(t), prev: w[i - 1] || '^', next: w[i + 1] || '$' }
    : null)).filter(Boolean);
}
const shape = (code) => code.replace(/\d+/g, '#'); // "a55" and "a56" -> "a#"

/**
 * True when two product names disagree on a hard fact: a figure with the same
 * unit (165W vs 140W, 8GB/128GB vs 8GB/256GB), a model code (Galaxy A55 vs
 * A56, WH-1000XM4 vs XM5) or the colour. One name may leave out a figure or a
 * code the other gives (8GB/128GB and 128GB agree; so do "A55" and "A55 SM-A556B").
 */
export function conflict(a, b) {
  const A = figures(a), B = figures(b);
  for (const u of Object.keys(A)) {
    if (B[u] && !within(A[u], B[u]) && !within(B[u], A[u])) return true;
  }
  // A code in each name that the other lacks, of the same pattern and next to
  // the same word ("Galaxy A55" / "Galaxy A56"): two different models. Codes
  // in other places are often specs that shops write differently (U1 / U3).
  const ma = models(a), mb = models(b);
  const inA = new Set(ma.map((x) => x.code)), inB = new Set(mb.map((x) => x.code));
  for (const x of ma) {
    if (inB.has(x.code)) continue;
    if (mb.some((y) => !inA.has(y.code) && shape(y.code) === shape(x.code) && (x.prev === y.prev || x.next === y.next))) return true;
  }
  const ca = colours(a), cb = colours(b);
  return ca.size > 0 && cb.size > 0 && ![...ca].some((c) => cb.has(c));
}

// Words that name another model of the same line: "Galaxy S24" and "Galaxy S24 Ultra".
const VARIANTS = ['pro', 'max', 'plus', 'ultra', 'mini', 'lite', 'air', 'fe', 'se', 'xl', 'neo', 'edge', 'slim', 'note', 'fold', 'flip', 'duo', 'prime', 'ti', 'super'];

/**
 * Strict enough to accept a match on the names alone (nothing else confirmed
 * it): no hard conflict, the numbers and codes of one name are all in the
 * other ("iPhone 15" is not "iPhone 16"), and the same variant words (Pro,
 * Plus, Ultra...) on both.
 */
export function sameModel(a, b) {
  if (conflict(a, b)) return false;
  const A = tokens(String(a).replace(/\+/g, ' plus ')), B = tokens(String(b).replace(/\+/g, ' plus '));
  const numbers = (S) => new Set([...S].filter((t) => /\d/.test(t)).map(unzero));
  const da = numbers(A), db = numbers(B);
  if (!within(da, db) && !within(db, da)) return false;
  return VARIANTS.every((v) => A.has(v) === B.has(v));
}

/** Word overlap of two names, 0..1 (numbers and model codes count double). */
export function similarity(a, b) {
  const want = tokens(a), have = tokens(b);
  const weight = (t) => (/\d/.test(t) ? 2 : 1);
  let common = 0, total = 0;
  for (const t of new Set([...want, ...have])) {
    total += weight(t);
    if (want.has(t) && have.has(t)) common += weight(t);
  }
  return total ? common / total : 0;
}

/**
 * Order candidates for a product, best first. `score` is the name similarity,
 * plus 0.5 when the manufacturer part number is in the candidate, or 0.3 when
 * the candidate is the site's first answer to a search for that part number.
 * Candidates that contradict the product (other wattage, capacity, colour) are dropped.
 */
export function rank(product, candidates) {
  const mpn = squash(product.mpn);
  return candidates
    .filter((c) => !conflict(product.name, c.name))
    .map((c) => {
      const base = similarity(product.name, c.name);
      // A part number alone is not proof: short numeric codes also turn up on unrelated products.
      const mpnHit = mpn.length >= 5 && base >= 0.2 && squash(c.name + ' ' + (c.hay || '')).includes(mpn);
      const score = base + (mpnHit ? 0.5 : c.mpnTop ? 0.3 : 0);
      return { ...c, base: Math.round(base * 100) / 100, score: Math.round(score * 100) / 100, mpnHit };
    })
    .sort((a, b) => b.score - a.score);
}

/** Model-like codes that several shops repeat in their listing titles. */
function codes(titles) {
  const count = new Map();
  for (const t of titles || []) {
    for (const raw of new Set(fold(t).split(/[\s()[\],;/]+/))) {
      const c = squash(raw);
      if (c.length < 7 || !/\d/.test(c) || !/[a-z]/.test(c)) continue;
      if (/^\d+(gb|tb|mb|mah|wh|w|v|hz|dpi|mm|cm|m)$/.test(c) || /^(usb|type|cat|bluetooth|wifi|hdmi|ddr)/.test(c)) continue;
      count.set(c, (count.get(c) || 0) + 1);
    }
  }
  return [...count].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
}

/**
 * How sure are we that a Skroutz product and a BestPrice product are the same?
 * Besides the names, both sites list each shop's own title for the product:
 * the manufacturer part number showing up there, or identical shop titles on
 * both sides, is what makes a match certain.
 *
 * @param sk {name, mpn, titles}  @param bp {name, titles}
 * @returns {{base:number, strong:boolean, clash:boolean}}
 */
export function evidence(sk, bp) {
  const base = similarity(sk.name, bp.name);
  const clash = conflict(sk.name, bp.name);
  const bpTitles = (bp.titles || []).map(norm);
  const bpText = squash(bp.name) + ' ' + (bp.titles || []).map(squash).join(' ');
  const mpn = squash(sk.mpn);
  const mpnHit = mpn.length >= 5 && bpText.includes(mpn);
  // Without a part number, fall back on codes that shops on both sides repeat.
  const codeHit = !mpn && codes(sk.titles).some((c) => (bp.titles || []).filter((t) => squash(t).includes(c)).length >= 2);
  const skTitles = new Set((sk.titles || []).map(norm).filter((t) => t.length >= 10));
  const same = bpTitles.filter((t) => skTitles.has(t)).length;
  const strong = !clash && base >= 0.15 && (mpnHit || codeHit || same >= 2 || (same >= 1 && base >= 0.4));
  return { base, strong, clash };
}

// ---------- parsing ----------

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Links carry the search text in their query string: keep the path only, or
// every result of a part-number search would seem to contain that number.
const bare = (url) => String(url || '').split(/[?#]/)[0];

function itemUrl(href) {
  const m = String(href || '').match(ITEM_PATH);
  return m ? { id: m[1], url: BP_ORIGIN + m[0] } : null;
}

/** Accepts a BestPrice product link. */
export function parseItemLink(text) {
  const m = String(text || '').trim().match(/^https?:\/\/(?:www\.)?bestprice\.gr(\/item\/\d+(?:\/[^?#\s]*)?)/i);
  return m ? itemUrl(m[1]) : null;
}

/**
 * Candidates from a BestPrice search response. `finalUrl` is the URL after
 * redirects: a search with a single hit lands directly on the product page.
 */
export function parseSearch(doc, finalUrl) {
  const direct = itemUrl(finalUrl);
  if (direct) {
    const name = clean(doc.querySelector('h1')?.textContent);
    const first = doc.querySelector('.prices__group[data-price]');
    return name ? [{ ...direct, name, price: first ? +first.getAttribute('data-price') / 100 : null, hay: bare(finalUrl) }] : [];
  }

  const out = new Map();
  const add = (href, name, price, hay) => {
    const it = itemUrl(href);
    if (it && name && !out.has(it.id)) out.set(it.id, { ...it, name: clean(name), price: Number.isFinite(price) ? price : null, hay });
  };
  for (const card of doc.querySelectorAll('.p[data-id]')) {
    const link = card.querySelector('a[href*="/item/"]');
    if (!link) continue; // single-merchant listing, not a comparable product
    const img = card.querySelector('img[data-product-image], img');
    const hay = bare(link.getAttribute('href')) + ' ' + bare(img?.getAttribute('src'));
    const title = card.querySelector('.p__title a')?.getAttribute('title') || img?.getAttribute('alt') || link.getAttribute('title');
    add(link.getAttribute('href'), title, +card.getAttribute('data-price') / 100, hay);
    // colour / size variants are folded into one card
    try {
      const vars = JSON.parse(card.querySelector('[data-variations]')?.getAttribute('data-variations') || '[]');
      for (const v of vars) add(v.link, v.title, v.price / 100, bare(v.link) + ' ' + bare(v.image?.src));
    } catch { /* no variations */ }
  }
  return [...out.values()];
}

/**
 * Merchant offers from a BestPrice price list (full page or the "all prices"
 * fragment), shaped like the Skroutz offers so the same optimizer can use them.
 *
 * Extra fields: stock / immediate (BestPrice's own flags: "Άμεσα διαθέσιμο" is
 * immediate, that and "Σε 1 - 3 ημέρες" are in stock), days (days until it can
 * ship, plus 2 in transit), eta (the text shown) and url (link to the merchant).
 *
 * A merchant can list the product more than once (another price, shipping or
 * delivery time). A listing is left out only when another one of the same
 * merchant is at least as good on all of these, so a dearer listing with free
 * shipping, or the only one fast enough for the availability settings, stays.
 */
export function parseOffers(doc) {
  const all = [];
  for (const group of doc.querySelectorAll('.prices__group[data-mid]')) {
    const shopId = group.getAttribute('data-mid');
    const shopName = group.querySelector('.prices__merchant-logo')?.getAttribute('aria-label')
      || clean(group.querySelector('.prices__merchant-link')?.textContent)
      || group.getAttribute('data-domain') || 'Merchant ' + shopId;
    for (const p of group.querySelectorAll('.prices__product[data-price]')) {
      const price = +p.getAttribute('data-price') / 100;
      if (!(price > 0)) continue;
      const ship = p.getAttribute('data-shipping-cost');
      const homeFee = ship != null && ship !== '' && Number.isFinite(+ship) ? +ship / 100 : null;
      const known = p.hasAttribute('data-av'); // older fragments carry no availability
      const av = +p.getAttribute('data-av');
      const stock = known ? p.hasAttribute('data-in-stock') : null; // null: not stated
      const immediate = known && stock && av === 0;
      const href = p.querySelector('.prices__title a[href], a[href*="/to/"]')?.getAttribute('href') || '';
      const from = (href.match(/[?&]from=(\d+)/) || [])[1];
      const offer = {
        shopId, shopName, price, pointFee: null, homeFee, hub: false, plus: null,
        stock, immediate,
        days: known && Number.isFinite(av) ? av + 2 : null,
        eta: clean(p.querySelector('.av')?.textContent),
        url: href.startsWith('/to/') ? BP_ORIGIN + bare(href) + (from ? '?from=' + from : '') : null,
      };
      all.push(offer);
    }
  }
  // shipping as the calculation counts it (3,50 € when the merchant states none)
  const fee = (o) => (o.homeFee == null ? 3.5 : o.homeFee);
  const stockRank = (o) => (o.stock === true ? 2 : o.stock == null ? 1 : 0);
  const days = (o) => (o.days == null ? Infinity : o.days);
  const beats = (b, a, earlier) => b.shopId === a.shopId
    && b.price <= a.price && fee(b) <= fee(a) && stockRank(b) >= stockRank(a)
    && (b.immediate || !a.immediate) && days(b) <= days(a)
    && (earlier || b.price < a.price || fee(b) < fee(a) || stockRank(b) > stockRank(a)
      || (b.immediate && !a.immediate) || days(b) < days(a));
  return all.filter((a, i) => !all.some((b, j) => j !== i && beats(b, a, j < i)));
}

/** The merchants' own titles for the product, from a BestPrice price list. */
export function parseTitles(doc) {
  const out = new Set();
  for (const a of doc.querySelectorAll('.prices__title a[title]')) {
    const t = clean(a.getAttribute('title'));
    if (t) out.add(t);
  }
  return [...out].slice(0, 80);
}

// ---------- network (extension pages only) ----------

async function getDoc(url, init) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { credentials: 'omit', ...init });
    // 429 = too many requests in a short time: wait a little and try again.
    if (res.status !== 429 || attempt >= 2) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`BestPrice answered ${res.status}`);
  return { doc: new DOMParser().parseFromString(await res.text(), 'text/html'), url: res.url };
}

async function searchBp(query) {
  const { doc, url } = await getDoc(`${BP_ORIGIN}/search?q=${encodeURIComponent(query)}`);
  return parseSearch(doc, url);
}

/** Every merchant's offer (and listing title) for a BestPrice product page URL. */
export async function fetchOffers(url) {
  // The page itself only carries the first ~15 merchants; this is the request
  // the site's own "All prices" button makes.
  const body = new FormData();
  body.append('pl', 'pl');
  const { doc } = await getDoc(url, { method: 'POST', body });
  return { offers: parseOffers(doc), titles: parseTitles(doc), name: clean(doc.querySelector('h1')?.textContent) || null };
}

/**
 * Title and picture of a BestPrice product page. Needed because the full
 * price list (fetchOffers) is a fragment without the product title.
 */
export async function fetchItemMeta(url) {
  const { doc } = await getDoc(url);
  const og = (p) => doc.querySelector(`meta[property="og:${p}"]`)?.getAttribute('content') || null;
  return { name: clean(doc.querySelector('h1')?.textContent) || clean(og('title')) || null, image: og('image') };
}

/** Model codes (part numbers) that several merchants repeat in their titles. */
export const titleCodes = (titles) => codes(titles);

/**
 * Find the BestPrice product for a Skroutz product {name, mpn, brand, titles}.
 *
 * The best-looking candidates are opened one by one and checked against the
 * shops' listing titles (see `evidence`). The first one that passes is THE
 * match. If none passes, a candidate is only accepted on its name when it is
 * nearly identical, clearly ahead of the rest, and the same model by
 * `sameModel`; otherwise the caller gets a short list to let the user decide.
 *
 * @returns {{item, confident, candidates, offers?}}
 */
export async function findMatch(product, io = { search: searchBp, offers: fetchOffers }) {
  const found = new Map();
  const add = (list, mark) => list.forEach((c, i) => {
    const prev = found.get(c.id);
    found.set(c.id, { ...(prev || c), mpnTop: (prev && prev.mpnTop) || (mark && i === 0) });
  });

  add(await io.search(product.name));
  if (product.mpn) add(await io.search([product.brand, product.mpn].filter(Boolean).join(' ')), true);
  if (!rank(product, [...found.values()]).some((c) => c.base >= 0.5)) {
    // Long names can return nothing useful: retry with the leading words only.
    const short = product.name.split(/\s+/).slice(0, 4).join(' ');
    if (short && short !== product.name) add(await io.search(short));
  }

  const ranked = rank(product, [...found.values()]).filter((c) => c.score >= 0.3).slice(0, 4);
  const slim = ({ id, url, name, price, score }) => ({ id, url, name, price, score });

  for (const c of ranked.slice(0, 3)) {
    let page;
    try { page = await io.offers(c.url); } catch { continue; }
    if (!page.offers.length) continue;
    const ev = evidence(product, { name: page.name || c.name, titles: page.titles });
    if (ev.strong) {
      return { item: { id: c.id, url: c.url, name: page.name || c.name }, confident: true, candidates: [], offers: page.offers };
    }
  }

  const [top, next] = ranked;
  if (top && top.base >= 0.75 && (!next || top.base - next.base >= 0.15) && sameModel(product.name, top.name)) {
    return { item: { id: top.id, url: top.url, name: top.name }, confident: true, candidates: [] };
  }
  // Not sure: no automatic pick, the user chooses.
  return { item: null, confident: false, candidates: ranked.filter((c) => c.base >= 0.45).map(slim) };
}
