// Adds a floating "Add to CartWise" button on skroutz.gr and bestprice.gr product pages.
(() => {
  const BP = location.hostname.endsWith('bestprice.gr');
  const PRODUCT_PATH = BP ? /^\/item\/(\d+)\// : /^\/s\/(\d+)\//;
  let button = null;
  let lastKey = '';

  const currentId = () => (location.pathname.match(PRODUCT_PATH) || [])[1] || null;
  const og = (prop) => document.querySelector(`meta[property="og:${prop}"]`)?.content || null;
  const alive = () => !!(chrome.runtime && chrome.runtime.id); // false after the extension is reloaded
  // Same language as the popup (settings.lang), else the browser's.
  const TEXT = {
    en: { add: '+ Add to CartWise', inList: (n) => `✓ In CartWise (${n})`, addTitle: 'Add this product to your CartWise list', removeTitle: 'Click to remove from your CartWise list' },
    el: { add: '+ Προσθήκη στο CartWise', inList: (n) => `✓ Στο CartWise (${n})`, addTitle: 'Πρόσθεσε αυτό το προϊόν στη λίστα του CartWise', removeTitle: 'Πάτησε για αφαίρεση από τη λίστα του CartWise' },
  };
  const pageName = () => (document.querySelector('h1')?.textContent || og('title') || document.title.split('|')[0] || '').replace(/\s+/g, ' ').trim();

  // The list is read from storage once and kept here; it is read again only
  // after storage reports a change (see the listener at the bottom).
  let mem = null;
  async function read(fresh = false) {
    if (mem && !fresh) return mem;
    // the BestPrice matches are only needed on bestprice.gr
    const { cart, bp, settings } = await chrome.storage.local.get(BP ? ['cart', 'bp', 'settings'] : ['cart', 'settings']);
    const lang = (settings && settings.lang) || (/^el\b/i.test(navigator.language || '') ? 'el' : 'en');
    mem = { cart: Array.isArray(cart) ? cart : [], bp: bp || {}, text: TEXT[lang] || TEXT.en, lang };
    return mem;
  }

  /** Index of this page's product in the list, or -1. */
  function indexIn(cart, bp, id) {
    if (!BP) return cart.findIndex((p) => p.id === id);
    // added from BestPrice (still looking for its Skroutz twin), or a Skroutz product matched to this page
    return cart.findIndex((p) => p.id === 'bp' + id || (bp[p.id] && bp[p.id].item && bp[p.id].item.id === id));
  }

  async function toggle() {
    const id = currentId();
    if (!id || !alive()) return;
    const fresh = await read(true);
    const bp = fresh.bp;
    const cart = fresh.cart.slice();
    const before = JSON.parse(JSON.stringify(cart)); // for the popup's Undo button
    const i = indexIn(cart, bp, id);
    if (i >= 0) cart.splice(i, 1);
    else if (BP) {
      // The popup finds the matching Skroutz product the next time it opens.
      const url = location.origin + location.pathname;
      const name = pageName();
      cart.push({ id: 'bp' + id, name: name || 'BestPrice product', bpItem: { id, url, name }, image: og('image'), qty: 1 });
    } else {
      cart.push({
        id,
        url: location.origin + location.pathname,
        name: og('title') || pageName() || `Product ${id}`,
        image: og('image'),
        qty: 1,
      });
    }
    const { history } = await chrome.storage.local.get('history');
    const past = (Array.isArray(history) ? history : []).concat([before]).slice(-30);
    await chrome.storage.local.set({ cart, history: past });
    mem = null;
    update(true);
  }

  async function update(force = false) {
    if (!alive()) { button?.remove(); clearInterval(timer); return; }
    const id = currentId();
    if (!id) {
      if (button) button.hidden = true;
      lastKey = '';
      return;
    }
    const { cart, bp, text, lang } = await read();
    const inCart = indexIn(cart, bp, id) >= 0;
    const key = `${id}:${inCart}:${cart.length}:${lang}`;
    if (!force && key === lastKey && button && !button.hidden) return;
    lastKey = key;
    if (!button) {
      button = document.createElement('button');
      button.id = 'sco-add-button';
      button.type = 'button';
      button.addEventListener('click', toggle);
      document.body.appendChild(button);
    }
    button.hidden = false;
    button.classList.toggle('sco-added', inCart);
    button.textContent = inCart ? text.inList(cart.length) : text.add;
    button.title = inCart ? text.removeTitle : text.addTitle;
  }

  // ---------- "Add to Skroutz cart" (started from the popup) ----------
  // The popup saves the chosen offers as `cartJob` and opens skroutz.gr/cart#cartwise.
  // Here, on that page, each offer is added with the same request the site's own
  // "add to cart" button makes, so it lands in the visitor's own cart.
  const CART_TEXT = {
    en: {
      adding: (a, b) => `CartWise: adding to your cart… ${a} / ${b}`,
      done: (n) => `CartWise added ${n} ${n === 1 ? 'product' : 'products'} to your cart.`,
      failed: 'Could not be added (add them from their pages):',
      fewer: (name, n) => `${name}: only ${n} available`,
      close: 'Close',
    },
    el: {
      adding: (a, b) => `CartWise: προσθήκη στο καλάθι σου… ${a} / ${b}`,
      done: (n) => `Το CartWise πρόσθεσε ${n} ${n === 1 ? 'προϊόν' : 'προϊόντα'} στο καλάθι σου.`,
      failed: 'Δεν προστέθηκαν (πρόσθεσέ τα από τη σελίδα τους):',
      fewer: (name, n) => `${name}: διαθέσιμα μόνο ${n}`,
      close: 'Κλείσιμο',
    },
  };
  const RESULT_KEY = 'cartwise-cart-result';

  function cartBox(lines, closable) {
    let box = document.getElementById('sco-cart-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sco-cart-box';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    box.replaceChildren(...lines.map((text, i) => {
      const p = document.createElement(i ? 'div' : 'strong');
      p.textContent = text;
      return p;
    }));
    if (closable) {
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', closable);
      x.addEventListener('click', () => box.remove());
      box.appendChild(x);
    }
    return box;
  }

  async function addToCart(item, token) {
    const body = { product_id: +item.card, from: 'sku_product_cards' };
    if (item.qty > 1) { body.with_qty_from_sku = true; body.quantity = item.qty; }
    const res = await fetch(`/cart/add/${encodeURIComponent(item.sku)}.json`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('status ' + res.status);
    const data = await res.json();
    const line = (data.line_items_info || []).map((x) => x.line_item).find((l) => l && String(l.product_id) === String(item.card));
    if (!line) throw new Error('not in the cart');
    return line.quantity;
  }

  async function runCartJob() {
    if (BP || location.pathname !== '/cart' || !alive()) return;
    const { text } = await read();
    const T = CART_TEXT[text === TEXT.el ? 'el' : 'en'];

    // after the reload that follows a finished job: say what happened
    let last = null;
    try { last = JSON.parse(sessionStorage.getItem(RESULT_KEY)); sessionStorage.removeItem(RESULT_KEY); } catch { /* no storage */ }
    if (last) {
      const lines = [T.done(last.ok), ...last.fewer.map((f) => T.fewer(f.name, f.n))];
      if (last.failed.length) lines.push(T.failed, ...last.failed.map((n) => '• ' + n));
      const box = cartBox(lines, T.close);
      if (!last.failed.length && !last.fewer.length) setTimeout(() => box.remove(), 8000);
      return;
    }

    if (location.hash !== '#cartwise') return;
    // a "checking your browser" page has no token: wait for the real page
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!token) return;
    const { cartJob } = await chrome.storage.local.get('cartJob');
    history.replaceState(null, '', location.pathname + location.search);
    if (!cartJob || !Array.isArray(cartJob.items) || Date.now() - cartJob.ts > 120000) return;
    await chrome.storage.local.remove('cartJob'); // claimed: never run twice

    const result = { ok: 0, failed: [], fewer: [] };
    const items = cartJob.items;
    for (let i = 0; i < items.length; i++) {
      cartBox([T.adding(i + 1, items.length)]);
      try {
        const got = await addToCart(items[i], token);
        result.ok++;
        if (got < items[i].qty) result.fewer.push({ name: items[i].name, n: got });
      } catch (e) {
        result.failed.push(items[i].name);
        console.warn('CartWise:', items[i].name, e);
      }
    }
    try { sessionStorage.setItem(RESULT_KEY, JSON.stringify(result)); } catch { /* no storage */ }
    location.reload(); // show the cart with the new products
  }
  runCartJob().catch((e) => console.warn('CartWise:', e));

  // Both sites can change page without a full load, so keep an eye on the URL.
  const timer = setInterval(update, 1000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.cart || changes.settings || (BP && changes.bp))) return;
    mem = null;
    update(true);
  });
  update();
})();
