// Parses the HTML that skroutz.gr serves at /s/<skuId>/shops_list
// (the "all shops" list of a product page) into plain offer objects.

/** "1.174,01 €" -> 1174.01 ; returns null when there is no number. */
export function parseMoney(text) {
  const m = String(text || '').match(/\d[\d.]*(?:,\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const FREE = /Δωρεάν|Free/i;

function feeValue(text) {
  if (FREE.test(text)) return 0;
  return parseMoney(text);
}

function text(el) {
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
}

const MONTHS = ['ιαν', 'φεβ', 'μαρ', 'απρ', 'μαι', 'ιουν', 'ιουλ', 'αυγ', 'σεπ', 'οκτ', 'νοε', 'δεκ'];
const WEEKDAYS = ['κυρ', 'δευ', 'τρι', 'τετ', 'πεμ', 'παρ', 'σαβ']; // Sunday first, like Date#getDay
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Days until delivery according to a Skroutz delivery estimate, or null.
 *   "έως Παρ, 20 Νοε" / "Πέμ, 19 Νοε - Δευ, 23 Νοε" / "Τρί 17 Νοε" -> days to the (last) date
 *   "Δευτέρα"                                                      -> days to that weekday
 *   "Ετοιμάζεται για αποστολή σε 6 ημέρες"                         -> 6 + 2 (ready to ship, then in transit)
 */
export function etaDays(textValue, now = new Date()) {
  const s = fold(textValue);
  if (!s) return null;
  const prep = s.match(/σε (\d+) ημερ/);
  if (prep && /ετοιμαζεται/.test(s)) return +prep[1] + 2;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let last = null;
  for (const d of s.matchAll(/(\d{1,2})\s+([α-ω]{3,4})/g)) {
    const month = MONTHS.findIndex((m) => d[2].startsWith(m));
    if (month < 0) continue;
    let date = new Date(today.getFullYear(), month, +d[1]);
    if (date - today < -180 * 864e5) date = new Date(today.getFullYear() + 1, month, +d[1]); // December -> January
    last = date;
  }
  if (last) return Math.max(0, Math.round((last - today) / 864e5));
  if (/σημερα/.test(s)) return 0;
  if (/αυριο/.test(s)) return 1;
  const wd = WEEKDAYS.findIndex((w) => new RegExp('(^|[^α-ω])' + w).test(s));
  if (wd >= 0) return ((wd - today.getDay() + 7) % 7) || 7;
  return null;
}

function shopNameOf(card) {
  const logo = card.querySelector('.merchant-logo img[alt]');
  if (logo && logo.getAttribute('alt').trim()) return logo.getAttribute('alt').trim();
  const name = text(card.querySelector('.merchant-box .name'));
  if (name) return name;
  const link = card.querySelector('a.storefront-link, a.shop-reviews-link');
  const m = link && (link.getAttribute('href') || '').match(/\/shop\/\d+\/([^/#?]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]).replace(/-/g, ' '); } catch { return m[1]; }
  }
  return 'Shop ' + card.getAttribute('data-shop-id');
}

/**
 * @param {Document} doc parsed shops_list response
 * @returns {{name: string|null, offers: Array}}
 *
 * Offer fields:
 *   shopId, shopName, price        - shop and item price in EUR
 *   pointFee / homeFee             - shipping to a Skroutz Point / to an address
 *                                    (null = that option is not offered or unknown)
 *   hub                            - shipped from Skroutz Hub
 *   plus                           - 'point' | 'any' | null: free shipping with Skroutz Plus
 *   cardId                         - Skroutz id of this shop's listing (for a direct link)
 *   eta, days                      - delivery estimate as shown, and in days (null = unknown)
 *   stock, immediate               - availability derived from the estimate
 */
export function parseShopsList(doc) {
  const offers = [];
  const seen = new Set();
  let name = null;

  for (const card of doc.querySelectorAll('li[data-shop-id]')) {
    const cardId = card.getAttribute('data-card-id') || '';
    const shopId = card.getAttribute('data-shop-id');
    if (seen.has(cardId || shopId + ':' + card.getAttribute('data-raw-price'))) continue; // sponsored duplicates
    seen.add(cardId || shopId + ':' + card.getAttribute('data-raw-price'));

    if (!name) {
      try {
        name = JSON.parse(card.getAttribute('data-sku-page--shops-list--card-gtag-sku-value')).name || null;
      } catch { /* attribute missing */ }
      if (!name) name = text(card.querySelector('.product-name')) || null;
    }

    let price = parseFloat(card.getAttribute('data-raw-price'));
    if (!Number.isFinite(price)) price = parseMoney(card.getAttribute('data-price') || text(card.querySelector('.final-price')));
    if (!Number.isFinite(price) || price <= 0) continue;

    // Only offers that can be bought through the Skroutz cart.
    if (!card.querySelector('[data-controller~="add-to-cart"], .add-to-cart-btn')) continue;

    let pointFee = null;
    let homeFee = null;
    const fee = card.querySelector('.product-card-fee');
    if (fee) {
      const main = feeValue(text(fee.querySelector('.product-card-fee-value')));
      const suffix = text(fee.querySelector('.product-card-fee-suffix'));
      const sub = feeValue(text(fee.querySelector('.product-card-fee-subtext')));
      if (/Point|Locker/i.test(suffix)) {
        pointFee = main;
        homeFee = sub;
      } else {
        homeFee = main;
        if (main === 0) pointFee = 0;
      }
    }

    let plus = null;
    const promo = text(card.querySelector('.plus-promo-info'));
    if (promo && FREE.test(promo)) plus = /Point|Locker/i.test(promo) ? 'point' : 'any';

    // Skroutz gives no stock flag for these offers, only a delivery estimate.
    // "In stock" = should arrive within a week; "immediately available" = within 4 days.
    const eta = text(card.querySelector('.delivery-estimation-date'));
    const days = etaDays(eta);

    offers.push({
      cardId,
      shopId,
      shopName: shopNameOf(card),
      price,
      pointFee,
      homeFee,
      hub: !!card.querySelector('.skroutz-hub'),
      plus,
      eta,
      days,
      stock: days == null || days <= 7,
      immediate: days != null && days <= 4,
    });
  }

  // Each shop's own title for the product (often carries the part number);
  // used to check that a BestPrice product is really the same one.
  const titles = new Set();
  for (const el of doc.querySelectorAll('li[data-shop-id] .product-name')) {
    const t = text(el);
    if (t) titles.add(t);
  }

  return { name, offers, titles: [...titles].slice(0, 80) };
}

/**
 * Products on a Skroutz search / category page.
 * @returns [{id, url, name}]  (name = the short card title plus the words of the link)
 */
export function parseSkroutzSearch(doc) {
  const out = new Map();
  for (const a of doc.querySelectorAll('li[data-skuid] a.js-sku-link[href], a.sku-card-title-link[href]')) {
    const m = (a.getAttribute('href') || '').match(/^(?:https?:\/\/www\.skroutz\.gr)?(\/s\/(\d+)\/([^?#]*))/);
    if (!m || out.has(m[2])) continue;
    const title = a.getAttribute('title') || text(a);
    if (!title) continue;
    const specs = text(a.closest('li')?.querySelector('.specs'));
    out.set(m[2], {
      id: m[2],
      url: 'https://www.skroutz.gr' + m[1],
      name: title,
      hay: [title, specs, m[3].replace(/\.html$/, '').replace(/-/g, ' ')].join(' '),
    });
  }
  return [...out.values()];
}
