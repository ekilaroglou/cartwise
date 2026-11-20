// Reading Skroutz pages, shared by the popup and the background lookup (offscreen.js).
import { parseShopsList } from './parser.js';

export const ORIGIN = 'https://www.skroutz.gr';
export const PRODUCT_URL = /^https?:\/\/(?:www\.)?skroutz\.gr\/s\/(\d+)(\/[^?#\s]*)?/i;
export const BP_VER = 7;     // BestPrice records: bump when their shape or the matching rules change
export const OFFERS_VER = 5; // cached Skroutz price lists: bump when their shape changes (5: shop-site offers)

/**
 * fetch, waiting and trying again (twice) when Skroutz answers 429 "too many
 * requests", which a long list read quickly can cause.
 */
export async function skFetch(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= 2) return res;
    const after = parseInt(res.headers.get('Retry-After'), 10);
    const secs = Math.min(10, after > 0 ? after : 2 * (attempt + 1));
    await new Promise((r) => setTimeout(r, secs * 1000));
  }
}

/** Every store's offer for a product. */
export async function fetchShopsList(id) {
  // credentials are omitted on purpose: we always read the public price list,
  // and apply Skroutz Plus ourselves from the setting.
  const res = await skFetch(`${ORIGIN}/s/${id}/shops_list`, { credentials: 'omit', headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'Product not found' : `Skroutz answered ${res.status}`);
  return parseShopsList(new DOMParser().parseFromString(await res.text(), 'text/html'));
}

/** Name, picture, manufacturer part number and brand from a Skroutz product page. */
export async function getMeta(id, url) {
  const res = await skFetch(url || `${ORIGIN}/s/${id}/p.html`, { credentials: 'omit' });
  if (!res.ok) return null;
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const meta = (prop) => doc.querySelector(`meta[property="og:${prop}"]`)?.getAttribute('content') || null;
  const out = { name: meta('title'), image: meta('image'), mpn: '', brand: '', url: null };
  try {
    const ld = JSON.parse(doc.getElementById('product-schema').textContent);
    out.mpn = typeof ld.mpn === 'string' ? ld.mpn : '';
    out.brand = (ld.brand && ld.brand.name) || '';
  } catch { /* no structured data */ }
  if (res.url && PRODUCT_URL.test(res.url)) out.url = res.url.split(/[?#]/)[0];
  return out;
}
