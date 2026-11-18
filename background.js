// When a product is added from a Skroutz page (the "+ Add to CartWise" button),
// read its prices and find it on BestPrice right away, so the popup already has
// everything when it opens. While the popup is open it does this itself.
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

async function run() {
  running = true;
  try {
    while (queue.length) {
      const p = queue.shift();
      const { settings, bp } = await chrome.storage.local.get(['settings', 'bp']);
      const wantBp = !(settings && settings.bestprice === false) && !(bp && bp[p.id] && bp[p.id].item);
      let res;
      try {
        await ensureOffscreen();
        // a site that never answers must not keep the offscreen page open: give up after 90 s
        res = await Promise.race([
          chrome.runtime.sendMessage({ target: 'offscreen', type: 'lookup', product: { id: p.id, url: p.url, name: p.name, bp: wantBp } }),
          new Promise((_, no) => setTimeout(() => no(new Error('no answer in 90 s')), 90000)),
        ]);
      } catch (e) { console.warn('CartWise background lookup:', p.id, e); continue; }
      if (!res || res.error) { console.warn('CartWise background lookup:', p.id, res && res.error); continue; }

      // save, unless the product was removed meanwhile or the popup already did it
      const cur = await chrome.storage.local.get(['cart', 'offers', 'bp']);
      if (!(cur.cart || []).some((x) => x.id === p.id)) continue;
      const set = {};
      const offers = cur.offers || {};
      if (res.offers && !(offers[p.id] && offers[p.id].ts > res.offers.ts)) set.offers = { ...offers, [p.id]: res.offers };
      const recs = cur.bp || {};
      if (res.bp && !(recs[p.id] && (recs[p.id].item || recs[p.id].manual))) set.bp = { ...recs, [p.id]: res.bp };
      if (Object.keys(set).length) await chrome.storage.local.set(set);
    }
  } finally {
    try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
    running = false;
    if (queue.length) run(); // added while closing
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.cart) return;
  const before = new Set((changes.cart.oldValue || []).map((p) => p.id));
  // products added from BestPrice are matched to Skroutz by the popup
  const added = (changes.cart.newValue || []).filter((p) => !before.has(p.id) && !String(p.id).startsWith('bp'));
  if (!added.length || (await popupOpen())) return;
  for (const p of added) if (!queue.some((q) => q.id === p.id)) queue.push(p);
  if (!running) run();
});
