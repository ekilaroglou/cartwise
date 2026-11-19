// The background part of CartWise. Only a page's "+ Add to CartWise" button
// wakes it (other changes to the saved data do not):
//   * it makes the change to the list, one change after another (under a lock
//     the popup takes too), so two pages adding at the same moment, or a page
//     and the popup, cannot undo each other;
//   * a product added from a Skroutz page while the popup is closed is priced
//     and found on BestPrice right away (in an offscreen page, which can read
//     HTML), so the popup has everything when it opens. While it is being
//     looked up, its id is in storage.session ("lookups"): a popup opened
//     meanwhile waits for it instead of reading the same pages again.

const HISTORY_MAX = 30;

// ---------- changes to the list, one at a time ----------
let chain = Promise.resolve();
/** Runs `fn` once every change asked before it is done. Never call it from inside `fn`. */
function serial(fn) {
  const job = chain.then(fn);
  chain = job.catch(() => {});
  return job;
}
// The popup changes the list too: both take this lock around reading and
// saving it, and count up `cartRev` with every save (see saveCart in popup.js).
const CART_LOCK = 'cartwise-cart';
const withLock = (fn) => (navigator.locks ? navigator.locks.request(CART_LOCK, fn) : serial(fn));

/** The list entry of a page's product, or -1 (the same rule as the page button). */
function indexIn(cart, bp, isBp, id) {
  if (!isBp) return cart.findIndex((p) => p.id === id);
  // added from BestPrice (still looking for its Skroutz twin), or a Skroutz product matched to this page
  return cart.findIndex((p) => p.id === 'bp' + id || (bp[p.id] && bp[p.id].item && bp[p.id].item.id === id));
}

/** Adds the page's product to the list, or removes it when it is there. */
async function toggle({ bp: isBp, id, item }) {
  const data = await chrome.storage.local.get(['cart', 'bp', 'history', 'cartRev']);
  const cart = Array.isArray(data.cart) ? data.cart : [];
  const before = JSON.parse(JSON.stringify(cart)); // for the popup's Undo
  const i = indexIn(cart, data.bp || {}, isBp, id);
  if (i >= 0) cart.splice(i, 1); else cart.push(item);
  const history = (Array.isArray(data.history) ? data.history : []).concat([before]).slice(-HISTORY_MAX);
  await chrome.storage.local.set({ cart, history, cartRev: (data.cartRev || 0) + 1 });
  return { inList: i < 0, count: cart.length, added: i < 0 ? item : null };
}

/** A toggle request as the page script sends it (anything else is ignored). */
function valid(msg) {
  const { id, item } = msg;
  return typeof id === 'string' && /^\d+$/.test(id) && item && typeof item === 'object'
    && item.id === (msg.bp ? 'bp' + id : id) && typeof item.name === 'string';
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target !== 'background' || msg.type !== 'toggle') return false;
  if (!valid(msg)) { reply({ error: 'bad request' }); return false; }
  withLock(() => toggle(msg)).then(async (res) => {
    reply({ inList: res.inList, count: res.count });
    // a Skroutz product added while the popup is closed: look it up now
    // (products added from BestPrice are matched by the popup)
    if (res.added && !msg.bp && !(await popupOpen())) lookUp(res.added);
  }, (e) => reply({ error: String((e && e.message) || e) }));
  return true; // answers asynchronously
});

// ---------- looking up products added from a page ----------
const queue = [];
let running = false;

async function popupOpen() {
  try { return (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length > 0; } catch { return false; }
}

let creating = null;
async function ensureOffscreen() {
  const has = (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  if (has) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Read product prices from skroutz.gr and bestprice.gr pages.',
    }).finally(() => { creating = null; });
  }
  await creating;
}

/** Marks a product as being looked up (or not any more), for a popup opened meanwhile. */
function mark(id, on) {
  return serial(async () => {
    const { lookups = {} } = await chrome.storage.session.get('lookups');
    if (on) lookups[id] = Date.now(); else delete lookups[id];
    await chrome.storage.session.set({ lookups });
  }).catch(() => { /* only a hint for the popup */ });
}

function lookUp(p) {
  if (!queue.some((q) => q.id === p.id)) queue.push(p);
  if (!running) run();
}

async function lookOne(p) {
  const { settings, bp } = await chrome.storage.local.get(['settings', 'bp']);
  const wantBp = !(settings && settings.bestprice === false) && !(bp && bp[p.id] && bp[p.id].item);
  await ensureOffscreen();
  // a site that never answers must not keep the offscreen page open: give up after 90 s
  const res = await Promise.race([
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'lookup', product: { id: p.id, url: p.url, name: p.name, bp: wantBp } }),
    new Promise((_, no) => setTimeout(() => no(new Error('no answer in 90 s')), 90000)),
  ]);
  if (!res || res.error) throw new Error((res && res.error) || 'no answer');

  // save the prices and the match (never the list itself), unless the product
  // was removed meanwhile or the popup already did it; under the lock the popup's
  // saves take too, so neither overwrites the other's (see saveMap in popup.js)
  await withLock(async () => {
    const cur = await chrome.storage.local.get(['cart', 'offers', 'bp']);
    if (!(cur.cart || []).some((x) => x.id === p.id)) return;
    const set = {};
    const offers = cur.offers || {};
    if (res.offers && !(offers[p.id] && offers[p.id].ts > res.offers.ts)) set.offers = { ...offers, [p.id]: res.offers };
    const recs = cur.bp || {};
    if (res.bp && !(recs[p.id] && (recs[p.id].item || recs[p.id].manual))) set.bp = { ...recs, [p.id]: res.bp };
    if (Object.keys(set).length) await chrome.storage.local.set(set);
  });
}

async function run() {
  running = true;
  try {
    while (queue.length) {
      const p = queue.shift();
      await mark(p.id, true);
      try {
        await lookOne(p);
      } catch (e) {
        console.warn('CartWise background lookup:', p.id, e); // the popup reads it when it opens
      } finally {
        await mark(p.id, false);
      }
    }
  } finally {
    try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
    running = false;
    if (queue.length) run(); // added while closing
  }
}
