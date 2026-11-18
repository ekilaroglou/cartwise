// Background lookup for a product just added from a Skroutz page (see background.js).
// It runs in an offscreen document because reading the pages needs DOMParser,
// which the service worker does not have. It only fetches and parses; the
// service worker saves the results.
import { fetchShopsList, getMeta, OFFERS_VER, BP_VER } from './lib/skroutz.js';
import { findMatch, fetchOffers as fetchBpOffers } from './lib/bestprice.js';

async function lookup({ id, url, name, bp }) {
  const out = {};
  const [sl, meta] = await Promise.all([fetchShopsList(id), getMeta(id, url).catch(() => null)]);
  // Skroutz's product name first (the price list only has the shops' own titles)
  const productName = (meta && meta.name) || sl.name || name;
  out.offers = { v: OFFERS_VER, ts: Date.now(), name: productName, image: (meta && meta.image) || null, offers: sl.offers, titles: sl.titles };
  if (!bp) return out;

  // the same steps as the popup's loadBp
  const m = await findMatch({ name: productName, mpn: (meta && meta.mpn) || '', brand: (meta && meta.brand) || '', titles: sl.titles || [] });
  const rec = { v: BP_VER, ...m, searched: true, offersTs: m.offers ? Date.now() : 0 };
  if (rec.item && !rec.offers) {
    const page = await fetchBpOffers(rec.item.url);
    rec.offers = page.offers;
    rec.offersTs = Date.now();
    if (!rec.item.name) rec.item.name = page.name || '';
  }
  out.bp = rec;
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'lookup') return false;
  lookup(msg.product).then(reply, (e) => reply({ error: String((e && e.message) || e) }));
  return true; // answers asynchronously
});
