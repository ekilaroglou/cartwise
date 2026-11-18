// Adds a floating "Add to CartWise" button on skroutz.gr and bestprice.gr product pages.
(() => {
  const BP = location.hostname.endsWith('bestprice.gr');
  const PRODUCT_PATH = BP ? /^\/item\/(\d+)\// : /^\/s\/(\d+)\//;
  let button = null;
  let lastKey = '';
  let timer = null;
  let waits = 0; // looks while a product page is still behind "checking your browser"

  // A "checking your browser" page has the product's address but not the product:
  // wait for the real page (it has a title for sharing) before offering the button.
  const currentId = () => (document.querySelector('meta[property="og:title"]') ? (location.pathname.match(PRODUCT_PATH) || [])[1] || null : null);
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
      // a product address without the product yet: look again for a short while
      if (PRODUCT_PATH.test(location.pathname) && waits < 15) { waits++; setTimeout(update, 2000); }
      return;
    }
    waits = 0;
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
  // The popup saves the chosen offers as `cartJob` ({items, empty}) and opens
  // skroutz.gr/cart#cartwise. Here, on that page, the cart is changed with the
  // same requests the site's own buttons make, so it is the visitor's own cart.
  // The Skroutz cart holds one line per product: adding a product that is
  // already there from another shop moves that line to the new shop.
  const CART_TEXT = {
    en: {
      adding: (a, b) => `CartWise: adding to your cart… ${a} / ${b}`,
      emptying: (a, b) => `CartWise: removing the other products… ${a} / ${b}`,
      done: (n) => `CartWise added ${n} ${n === 1 ? 'product' : 'products'} to your cart.`,
      removed: (n) => `Removed ${n} other ${n === 1 ? 'product' : 'products'}:`,
      more: (n) => `• and ${n} more`,
      notRemoved: (n) => `${n} other ${n === 1 ? 'product' : 'products'} could not be removed.`,
      emptyFailed: 'The rest of your cart could not be emptied.',
      nothingElse: 'There was nothing else in your cart to remove.',
      emptyingAll: 'CartWise: emptying your cart…',
      emptied: 'Your cart was emptied first.',
      failed: 'Could not be added (add them from their pages):',
      fewer: (name, n) => `${name}: only ${n} available`,
      inCart: (name, n) => `${name}: ${n} in your cart`,
      otherShop: (name) => `${name}: in your cart from another shop`,
      close: 'Close',
    },
    el: {
      adding: (a, b) => `CartWise: προσθήκη στο καλάθι σου… ${a} / ${b}`,
      emptying: (a, b) => `CartWise: αφαίρεση των άλλων προϊόντων… ${a} / ${b}`,
      done: (n) => `Το CartWise πρόσθεσε ${n} ${n === 1 ? 'προϊόν' : 'προϊόντα'} στο καλάθι σου.`,
      removed: (n) => (n === 1 ? 'Αφαιρέθηκε 1 άλλο προϊόν:' : `Αφαιρέθηκαν ${n} άλλα προϊόντα:`),
      more: (n) => `• και ${n} ακόμη`,
      notRemoved: (n) => (n === 1 ? '1 άλλο προϊόν δεν αφαιρέθηκε.' : `${n} άλλα προϊόντα δεν αφαιρέθηκαν.`),
      emptyFailed: 'Το υπόλοιπο καλάθι σου δεν άδειασε.',
      nothingElse: 'Δεν υπήρχε τίποτε άλλο στο καλάθι σου για αφαίρεση.',
      emptyingAll: 'CartWise: άδειασμα του καλαθιού σου…',
      emptied: 'Το καλάθι σου άδειασε πρώτα.',
      failed: 'Δεν προστέθηκαν (πρόσθεσέ τα από τη σελίδα τους):',
      fewer: (name, n) => `${name}: διαθέσιμα μόνο ${n}`,
      inCart: (name, n) => `${name}: ${n} στο καλάθι σου`,
      otherShop: (name) => `${name}: στο καλάθι σου από άλλο κατάστημα`,
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

  /** A request to the cart, as the site's own scripts make it. */
  const cartApi = (token) => async (url, body, method = 'POST') => {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${url}: status ${res.status}`);
    return res.json().catch(() => ({}));
  };

  /** The cart's lines, one per product: [{id, sku, card, pid, qty, max, selected}]. */
  async function cartLines(call) {
    const data = await call('/cart/line_items.json', null, 'GET');
    const lines = data && data.cart && data.cart.line_items;
    if (!lines || typeof lines !== 'object') throw new Error('unexpected cart');
    return Object.entries(lines).map(([id, l]) => ({
      id: +id, sku: String(l.sku_id), card: String(l.product_id), pid: l.product_id,
      qty: l.quantity, max: l.max_quantity, selected: l.selected !== false,
    }));
  }

  /** Puts one offer in the cart with the asked quantity; `line`: its product's line already there. */
  async function putInCart(call, item, line) {
    if (!line || line.card !== item.card) {
      // a new line, or the line moves to this shop (it then keeps its old quantity)
      const body = { product_id: +item.card, from: 'sku_product_cards' };
      if (item.qty > 1) { body.with_qty_from_sku = true; body.quantity = item.qty; }
      const data = await call(`/cart/add/${encodeURIComponent(item.sku)}.json`, body);
      const l = (data.line_items_info || []).map((x) => x.line_item).find((x) => x && String(x.product_id) === item.card);
      if (!l) throw new Error('not in the cart');
      line = { id: l.id, qty: l.quantity, max: l.max_quantity };
    }
    // the same offer is only set to the asked quantity (adding it again would add to it),
    // never above what the shop has: Skroutz would then move the line to another shop
    const want = line.max > 0 ? Math.min(item.qty, line.max) : item.qty;
    if (line.qty !== want) await call('/cart/change_line_item_quantity.json', { line_item_id: line.id, quantity: want });
  }

  /** A product's name as the cart page shows it. */
  function nameOnPage(sku) {
    for (const a of document.querySelectorAll(`a[href*="/s/${sku}/"]`)) {
      const name = (a.textContent || a.title || '').replace(/\s+/g, ' ').trim();
      if (name.length > 3) return name;
    }
    return '';
  }

  function showResult(last, T) {
    const lines = [T.done(last.ok)];
    const removed = last.removed || [];
    if (removed.length) {
      const named = removed.filter(Boolean);
      lines.push(T.removed(removed.length), ...named.slice(0, 5).map((n) => '• ' + n));
      if (named.length > 5) lines.push(T.more(named.length - 5));
    }
    if (last.notRemoved) lines.push(T.notRemoved(last.notRemoved));
    if (last.emptyFailed) lines.push(T.emptyFailed);
    if (last.nothingElse) lines.push(T.nothingElse);
    if (last.emptied) lines.push(T.emptied);
    lines.push(...last.fewer.map((f) => T.fewer(f.name, f.n)));
    lines.push(...(last.more || []).map((f) => T.inCart(f.name, f.n)));
    lines.push(...(last.otherShop || []).map((n) => T.otherShop(n)));
    if (last.failed.length) lines.push(T.failed, ...last.failed.map((n) => '• ' + n));
    const box = cartBox(lines, T.close);
    // all done as asked: the note goes away by itself
    if (lines.length === 1) setTimeout(() => box.remove(), 8000);
  }

  async function runCartJob() {
    if (BP || location.pathname !== '/cart' || !alive()) return;
    const { text } = await read();
    const T = CART_TEXT[text === TEXT.el ? 'el' : 'en'];

    // after the reload that follows a finished job: say what happened
    let last = null;
    try { last = JSON.parse(sessionStorage.getItem(RESULT_KEY)); sessionStorage.removeItem(RESULT_KEY); } catch { /* no storage */ }
    if (last) { showResult(last, T); return; }

    if (location.hash !== '#cartwise') return;
    // a "checking your browser" page has no token: wait for the real page
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!token) return;
    const { cartJob } = await chrome.storage.local.get('cartJob');
    history.replaceState(null, '', location.pathname + location.search);
    if (!cartJob || !Array.isArray(cartJob.items) || Date.now() - cartJob.ts > 120000) return;
    await chrome.storage.local.remove('cartJob'); // claimed: never run twice

    const call = cartApi(token);
    const items = cartJob.items;
    const result = { ok: 0, failed: [], fewer: [], more: [], otherShop: [], removed: [], notRemoved: 0, emptyFailed: false };
    let before = null; // what the cart held before
    try { before = await cartLines(call); } catch (e) { console.warn('CartWise: could not read the cart', e); }
    // "empty the rest": the site's own "Remove all" first (the order is put back in
    // right after); if that fails, the other products one by one
    if (cartJob.empty) {
      cartBox([T.emptyingAll]);
      const skus = new Set(items.map((i) => i.sku));
      const rest = before ? before.filter((l) => !skus.has(l.sku)) : [];
      // their names, read from the page before they leave it (it draws them a moment after loading)
      for (let i = 0; i < 15 && rest.some((l) => !nameOnPage(l.sku)); i++) await new Promise((r) => setTimeout(r, 200));
      const names = rest.map((l) => nameOnPage(l.sku)); // '' when not shown
      let cleared = false;
      try {
        const res = await fetch('/cart/clear.html', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': token, Accept: 'text/html' } });
        if (res.ok) {
          let left = null;
          try { left = await cartLines(call); } catch { /* trust the site's answer */ }
          cleared = !left || left.length === 0;
        }
      } catch (e) { console.warn('CartWise: Remove all failed', e); }
      if (cleared) {
        result.removed = names;
        if (!before) result.emptied = true; // what was there is not known, only that it is gone
        else result.nothingElse = !rest.length;
        before = [];
      } else if (!before) result.emptyFailed = true;
      else {
        result.nothingElse = !rest.length;
        for (let i = 0; i < rest.length; i++) {
          cartBox([T.emptying(i + 1, rest.length)]);
          try {
            await call(`/cart/remove_line_item/${rest[i].id}.json`);
            result.removed.push(names[i]);
          } catch (e) {
            result.notRemoved++;
            console.warn('CartWise: could not remove line', rest[i].id, e);
          }
        }
      }
    }

    const errors = new Set();
    for (let i = 0; i < items.length; i++) {
      cartBox([T.adding(i + 1, items.length)]);
      try {
        await putInCart(call, items[i], before && before.find((l) => l.sku === items[i].sku));
      } catch (e) {
        errors.add(items[i].sku);
        console.warn('CartWise:', items[i].name, e);
      }
    }

    // what the cart holds now, product by product
    let after = null;
    try { after = await cartLines(call); } catch (e) { console.warn('CartWise: could not read the cart', e); }
    const unticked = [];
    for (const item of items) {
      const l = after && after.find((x) => x.sku === item.sku);
      if (!after) { if (errors.has(item.sku)) result.failed.push(item.name); else result.ok++; continue; }
      if (!l) { result.failed.push(item.name); continue; }
      if (l.card !== item.card) { result.otherShop.push(item.name); continue; }
      result.ok++;
      if (l.qty < item.qty) result.fewer.push({ name: item.name, n: l.qty });
      else if (l.qty > item.qty) result.more.push({ name: item.name, n: l.qty });
      if (!l.selected) unticked.push(l);
    }
    // a line unticked earlier would be left out at checkout: tick it
    if (unticked.length) {
      await call('/cart/toggle_line_item_selection', {
        selected: true, line_item_ids: unticked.map((l) => l.id), proposal_product_ids: Object.fromEntries(after.map((l) => [l.id, l.pid])),
      }, 'PATCH').catch((e) => console.warn('CartWise: could not tick', e));
    }
    try { sessionStorage.setItem(RESULT_KEY, JSON.stringify(result)); } catch { /* no storage */ }
    location.reload(); // show the cart as it is now
  }
  runCartJob().catch((e) => console.warn('CartWise:', e));

  // Both sites can change page without a full load. Rather than checking all the
  // time, look when the browser says the address changed (and a few times just
  // after, while the new page is drawn), and when the tab is shown again.
  let pending = [];
  function soon() {
    for (const t of pending) clearTimeout(t);
    pending = [0, 300, 1000, 2500].map((ms) => setTimeout(update, ms));
  }
  if (window.navigation) navigation.addEventListener('currententrychange', soon);
  else timer = setInterval(update, 1000); // browsers without these notices: check every second
  addEventListener('popstate', soon);
  addEventListener('pageshow', soon);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.cart || changes.settings || (BP && changes.bp))) return;
    mem = null;
    update(true);
  });
  update();
})();
