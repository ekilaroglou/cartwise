// Reading Skroutz pages, shared by the popup and the background lookup (offscreen.js).
import { parseShopsList } from './parser.js';

export const ORIGIN = 'https://www.skroutz.gr';
export const PRODUCT_URL = /^https?:\/\/(?:www\.)?skroutz\.gr\/s\/(\d+)(\/[^?#\s]*)?/i;
export const BP_VER = 4;     // BestPrice records: bump when their shape changes
export const OFFERS_VER = 2; // cached Skroutz price lists: bump when their shape changes

/** Every store's offer for a product. */
export async function fetchShopsList(id) {
  // credentials are omitted on purpose: we always read the public price list,
  // and apply Skroutz Plus ourselves from the setting.
  const res = await fetch(`${ORIGIN}/s/${id}/shops_list`, { credentials: 'omit', headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'Product not found' : `Skroutz answered ${res.status}`);
  return parseShopsList(new DOMParser().parseFromString(await res.text(), 'text/html'));
}

/** Name, picture, manufacturer part number and brand from a Skroutz product page. */
export async function getMeta(id, url) {
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
