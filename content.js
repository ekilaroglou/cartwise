// Adds a floating "Add to Eksipno Kalathi" button on skroutz.gr and bestprice.gr product pages.
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
    en: { add: '+ Add to Eksipno Kalathi', inList: (n) => `✓ In Eksipno Kalathi (${n})`, addTitle: 'Add this product to your Eksipno Kalathi list', removeTitle: 'Click to remove from your Eksipno Kalathi list' },
    el: { add: '+ Προσθήκη στο Eksipno Kalathi', inList: (n) => `✓ Στο Eksipno Kalathi (${n})`, addTitle: 'Πρόσθεσε αυτό το προϊόν στη λίστα του Eksipno Kalathi', removeTitle: 'Πάτησε για αφαίρεση από τη λίστα του Eksipno Kalathi' },
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

  /** This page's product as a list entry (used if it is added). */
  function pageItem(id) {
    const url = location.origin + location.pathname;
    if (BP) {
      // The popup finds the matching Skroutz product the next time it opens.
      const name = pageName();
      return { id: 'bp' + id, name: name || 'BestPrice product', bpItem: { id, url, name }, image: og('image'), qty: 1 };
    }
    return { id, url, name: og('title') || pageName() || `Product ${id}`, image: og('image'), qty: 1 };
  }

  /** The same change, made here: only when the background cannot be reached. */
  async function toggleHere(id, item) {
    const { cart: saved, bp, history, cartRev } = await chrome.storage.local.get(['cart', 'bp', 'history', 'cartRev']);
    const cart = Array.isArray(saved) ? saved : [];
    const before = JSON.parse(JSON.stringify(cart)); // for the popup's Undo button
    const i = indexIn(cart, bp || {}, id);
    if (i >= 0) cart.splice(i, 1); else cart.push(item);
    const past = (Array.isArray(history) ? history : []).concat([before]).slice(-30);
    // counted like every save of the list, so an open popup takes the change in
    await chrome.storage.local.set({ cart, history: past, cartRev: (cartRev || 0) + 1 });
  }

  async function toggle() {
    const id = currentId();
    if (!id || !alive()) return;
    const item = pageItem(id);
    try {
      // The background makes every change to the list, one after another, so
      // two pages adding at the same moment cannot undo each other.
      const res = await chrome.runtime.sendMessage({ target: 'background', type: 'toggle', bp: BP, id, item });
      if (!res || res.error) throw new Error((res && res.error) || 'no answer');
    } catch (e) {
      // the background did not get the request: make the change here
      if (/Receiving end does not exist|Could not establish connection/i.test(String(e && e.message))) await toggleHere(id, item);
      else console.warn('Eksipno Kalathi:', e);
    }
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
  // skroutz.gr/cart#eksipno-kalathi. Here, on that page, the cart is changed with the
  // same requests the site's own buttons make, so it is the visitor's own cart.
  // The Skroutz cart holds one line per product: adding a product that is
  // already there from another shop moves that line to the new shop.
  const CART_TEXT = {
    en: {
      adding: (a, b) => `Eksipno Kalathi: adding to your cart… ${a} / ${b}`,
      emptying: (a, b) => `Eksipno Kalathi: removing the other products… ${a} / ${b}`,
      done: (n) => `Eksipno Kalathi added ${n} ${n === 1 ? 'product' : 'products'} to your cart.`,
      removed: (n, list) => `Removed ${n} other ${n === 1 ? 'product' : 'products'}${list ? ':' : '.'}`,
      more: (n) => `• and ${n} more`,
      notRemoved: (n) => `${n} other ${n === 1 ? 'product' : 'products'} could not be removed.`,
      notRead: 'Your cart could not be read, so nothing else was removed from it.',
      nothingElse: 'There was nothing else in your cart to remove.',
      choice: 'Choose a size or option on their page, then add them:',
      failed: 'Could not be added (add them from their pages):',
      fewer: (name, n) => `${name}: only ${n} available`,
      inCart: (name, n) => `${name}: ${n} in your cart`,
      otherShop: (name) => `${name}: in your cart from another shop`,
      unticked: 'In your cart but not ticked, so left out at checkout. Tick them in the cart:',
      waiting: 'Eksipno Kalathi: waiting for Skroutz to open your cart…',
      notLoaded: 'Eksipno Kalathi could not add your order: Skroutz did not open your cart in time. Reload this page within a few minutes to try again.',
      tooOld: 'Eksipno Kalathi did not add the order: it was confirmed more than 3 minutes ago, and prices may have changed since. Press “Add to Skroutz cart” in Eksipno Kalathi again.',
      close: 'Close',
    },
    el: {
      adding: (a, b) => `Eksipno Kalathi: προσθήκη στο καλάθι σου… ${a} / ${b}`,
      emptying: (a, b) => `Eksipno Kalathi: αφαίρεση των άλλων προϊόντων… ${a} / ${b}`,
      done: (n) => `Το Eksipno Kalathi πρόσθεσε ${n} ${n === 1 ? 'προϊόν' : 'προϊόντα'} στο καλάθι σου.`,
      removed: (n, list) => (n === 1 ? 'Αφαιρέθηκε 1 άλλο προϊόν' : `Αφαιρέθηκαν ${n} άλλα προϊόντα`) + (list ? ':' : '.'),
      more: (n) => `• και ${n} ακόμη`,
      notRemoved: (n) => (n === 1 ? '1 άλλο προϊόν δεν αφαιρέθηκε.' : `${n} άλλα προϊόντα δεν αφαιρέθηκαν.`),
      notRead: 'Το καλάθι σου δεν διαβάστηκε, οπότε δεν αφαιρέθηκε τίποτε άλλο από αυτό.',
      nothingElse: 'Δεν υπήρχε τίποτε άλλο στο καλάθι σου για αφαίρεση.',
      choice: 'Διάλεξε μέγεθος ή επιλογή στη σελίδα τους και πρόσθεσέ τα:',
      failed: 'Δεν προστέθηκαν (πρόσθεσέ τα από τη σελίδα τους):',
      fewer: (name, n) => `${name}: διαθέσιμα μόνο ${n}`,
      inCart: (name, n) => `${name}: ${n} στο καλάθι σου`,
      otherShop: (name) => `${name}: στο καλάθι σου από άλλο κατάστημα`,
      unticked: 'Στο καλάθι σου αλλά χωρίς τικ, οπότε μένουν έξω από την παραγγελία. Τσέκαρέ τα στο καλάθι:',
      waiting: 'Eksipno Kalathi: περιμένω να ανοίξει το καλάθι σου στο Skroutz…',
      notLoaded: 'Το Eksipno Kalathi δεν πρόσθεσε την παραγγελία σου: το Skroutz δεν άνοιξε το καλάθι σου εγκαίρως. Ανανέωσε αυτή τη σελίδα μέσα στα επόμενα λεπτά για να ξαναδοκιμάσει.',
      tooOld: 'Το Eksipno Kalathi δεν πρόσθεσε την παραγγελία: επιβεβαιώθηκε πριν από πάνω από 3 λεπτά και οι τιμές μπορεί να άλλαξαν. Πάτησε ξανά «Προσθήκη στο καλάθι του Skroutz» στο Eksipno Kalathi.',
      close: 'Κλείσιμο',
    },
  };
  // What a finished job did: kept in the extension's own storage (not the
  // site's) until the reloaded cart page, marked with DONE_HASH, shows it.
  const RESULT_KEY = 'cartResult';
  const DONE_HASH = '#eksipno-kalathi-done';
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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

  /** The cart's lines, one per product: [{id, sku, card, pid, qty, max, selected, sized}]. */
  async function cartLines(call) {
    const data = await call('/cart/line_items.json', null, 'GET');
    const lines = data && data.cart && data.cart.line_items;
    if (!lines || typeof lines !== 'object') throw new Error('unexpected cart');
    return Object.entries(lines).map(([id, l]) => ({
      id: +id, sku: String(l.sku_id), card: String(l.product_id), pid: l.product_id,
      qty: l.quantity, max: l.max_quantity, selected: l.selected !== false,
      sized: !!(l.size || l.merchant_size), // a size was chosen for it
    }));
  }

  const setQty = (call, line, quantity) => call('/cart/change_line_item_quantity.json', { line_item_id: line.id, quantity });

  /**
   * Puts one offer in the cart with the asked quantity; `line`: its product's
   * line already there. Returns false when it is left to the user: the shop
   * asks for a size or option first, which is chosen on the product page.
   */
  async function putInCart(call, item, line) {
    if (!line || line.card !== item.card) {
      // a line already there keeps the size chosen for it
      if (item.choice || (line && line.sized)) return false;
      // The line moves to the new shop with its quantity: one piece first, so
      // it is never above what the new shop has (Skroutz would then pick yet
      // another shop). It gets its quantity back if the move does not happen.
      const oldQty = line ? line.qty : 0;
      if (oldQty > 1) await setQty(call, line, 1);
      let added = null, error = null, now = null;
      try {
        // one piece, for the same reason: the quantity is set below
        const data = await call(`/cart/add/${encodeURIComponent(item.sku)}.json`, { product_id: +item.card, from: 'sku_product_cards' });
        const l = (data.line_items_info || []).map((x) => x.line_item).find((x) => x && String(x.product_id) === item.card);
        if (l) added = { id: l.id, qty: l.quantity, max: l.max_quantity };
      } catch (e) { error = e; }
      if (!added) {
        // the answer did not show it: look in the cart itself
        now = await cartLines(call).catch(() => null);
        added = (now && now.find((x) => x.card === item.card)) || null;
      }
      if (!added) {
        // still at the old shop: back to its quantity
        const cur = now ? now.find((x) => x.sku === item.sku) : line;
        if (oldQty > 1 && cur && cur.card === line.card) await setQty(call, cur, oldQty).catch(() => {});
        throw error || new Error('not in the cart');
      }
      line = added;
    }
    // the quantity is set, not added to, and never above what the shop has
    const want = line.max > 0 ? Math.min(item.qty, line.max) : item.qty;
    if (line.qty !== want) await setQty(call, line, want);
    return true;
  }

  /** The site's own "Remove all": true when the cart is empty after it. */
  async function removeAll(token, call) {
    try {
      const res = await fetch('/cart/clear.html', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': token, Accept: 'text/html' } });
      if (!res.ok) return false;
      try { return (await cartLines(call)).length === 0; } catch { return true; } // trust the site's answer
    } catch (e) {
      console.warn('Eksipno Kalathi: Remove all failed', e);
      return false;
    }
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
      lines.push(T.removed(removed.length, named.length > 0), ...named.slice(0, 5).map((n) => '• ' + n));
      if (named.length > 5) lines.push(T.more(named.length - 5));
    }
    if (last.notRemoved) lines.push(T.notRemoved(last.notRemoved));
    if (last.notRead) lines.push(T.notRead);
    if (last.nothingElse) lines.push(T.nothingElse);
    lines.push(...last.fewer.map((f) => T.fewer(f.name, f.n)));
    lines.push(...(last.more || []).map((f) => T.inCart(f.name, f.n)));
    lines.push(...(last.otherShop || []).map((n) => T.otherShop(n)));
    if ((last.unticked || []).length) lines.push(T.unticked, ...last.unticked.map((n) => '• ' + n));
    if ((last.choice || []).length) lines.push(T.choice, ...last.choice.map((n) => '• ' + n));
    if (last.failed.length) lines.push(T.failed, ...last.failed.map((n) => '• ' + n));
    const box = cartBox(lines, T.close);
    // all done as asked: the note goes away by itself
    if (lines.length === 1) setTimeout(() => box.remove(), 8000);
  }

  // An order confirmed in the popup runs on the cart page the popup opens
  // (#eksipno-kalathi), or on the next cart page within a few minutes: Skroutz's
  // "checking your browser" page can lose the #eksipno-kalathi on its way to the cart.
  const JOB_FRESH = 3 * 60000;

  /**
   * Takes the order for this page: "ok"; "gone" when another cart tab has taken
   * it already; "old" when it has run out while the page was waited for.
   */
  async function claimJob(ts) {
    const take = async () => {
      const { cartJob } = await chrome.storage.local.get('cartJob');
      if (!cartJob || cartJob.ts !== ts) return 'gone';
      await chrome.storage.local.remove('cartJob');
      return Date.now() - cartJob.ts > JOB_FRESH ? 'old' : 'ok';
    };
    // cart tabs share this lock (the same site), so two of them cannot both take it
    return navigator.locks ? navigator.locks.request('cartwise-cart-job', take) : take();
  }

  async function runCartJob() {
    if (BP || location.pathname !== '/cart' || !alive()) return;
    const { text } = await read();
    const T = CART_TEXT[text === TEXT.el ? 'el' : 'en'];
    const asked = location.hash === '#eksipno-kalathi'; // the page the popup opened
    if (asked || location.hash === DONE_HASH) history.replaceState(null, '', location.pathname + location.search);

    // After the reload that follows a finished order: say what happened, once
    // (also when that reload went through the browser check and lost DONE_HASH).
    const { [RESULT_KEY]: done, cartJob } = await chrome.storage.local.get([RESULT_KEY, 'cartJob']);
    if (done) {
      await chrome.storage.local.remove(RESULT_KEY);
      if (Date.now() - done.ts < 120000) showResult(done.result, T);
    }
    if (!cartJob || !Array.isArray(cartJob.items)) return;
    if (Date.now() - cartJob.ts > JOB_FRESH) {
      // confirmed too long ago (prices may have changed since): not done, and said so where it was meant to run
      await chrome.storage.local.remove('cartJob');
      if (asked) cartBox([T.tooOld], T.close);
      return;
    }
    // A "checking your browser" page has no token yet: wait for the real page,
    // saying so after a moment. If it does not come, say that too; the order
    // stays, so reloading the page within a few minutes tries again.
    let token = null;
    for (let i = 0; i < 60 && !(token = document.querySelector('meta[name="csrf-token"]')?.content); i++) {
      if (i === 3) cartBox([T.waiting]);
      await pause(1000);
    }
    if (!token) { cartBox([T.notLoaded], T.close); return; }
    // never run twice, and never once it has run out (checked again: the wait above can take a minute)
    const claim = await claimJob(cartJob.ts);
    if (claim === 'old') { cartBox([T.tooOld], T.close); return; }
    if (claim !== 'ok') return;

    const call = cartApi(token);
    const items = cartJob.items;
    const skus = new Set(items.map((i) => i.sku));
    const result = { ok: 0, failed: [], fewer: [], more: [], otherShop: [], choice: [], removed: [], notRemoved: 0, unticked: [] };
    let before = null; // what the cart held before
    for (let i = 0; i < 3 && !before; i++) {
      try { before = await cartLines(call); } catch (e) { console.warn('Eksipno Kalathi: could not read the cart', e); if (i < 2) await pause(1500); }
    }

    // "Empty the rest", before the order goes in: the other products one by
    // one, so this order's products already in the cart stay as they are.
    if (cartJob.empty) {
      if (!before) {
        // What else is in the cart is not known, so nothing is removed: the
        // site's own "Remove all" would take this order's products with it.
        result.notRead = true;
      } else {
        const rest = before.filter((l) => !skus.has(l.sku));
        result.nothingElse = !rest.length;
        // their names, read from the page before they leave it (it draws them a moment after loading)
        for (let i = 0; i < 15 && rest.some((l) => !nameOnPage(l.sku)); i++) await pause(200);
        const names = rest.map((l) => nameOnPage(l.sku)); // '' when not shown
        const left = [];
        for (let i = 0; i < rest.length; i++) {
          cartBox([T.emptying(i + 1, rest.length)]);
          try {
            await call(`/cart/remove_line_item/${rest[i].id}.json`);
            result.removed.push(names[i]);
          } catch (e) {
            left.push(i);
            console.warn('Eksipno Kalathi: could not remove line', rest[i].id, e);
          }
        }
        if (left.length) {
          // Some would not go. The site's own "Remove all" takes everything, so
          // it is used only when none of this order's products is in the cart.
          if (!before.some((l) => skus.has(l.sku)) && await removeAll(token, call)) {
            for (const i of left) result.removed.push(names[i]);
            before = [];
          } else result.notRemoved = left.length;
        }
      }
    }

    const errors = new Set();
    const skipped = new Set(); // left for a size or option to be chosen on Skroutz
    for (let i = 0; i < items.length; i++) {
      cartBox([T.adding(i + 1, items.length)]);
      try {
        const done = await putInCart(call, items[i], before && before.find((l) => l.sku === items[i].sku));
        if (!done) skipped.add(items[i].sku);
      } catch (e) {
        errors.add(items[i].sku);
        console.warn('Eksipno Kalathi:', items[i].name, e);
      }
    }

    // what the cart holds now, product by product
    let after = null;
    try { after = await cartLines(call); } catch (e) { console.warn('Eksipno Kalathi: could not read the cart', e); }
    const unticked = [];
    for (const item of items) {
      const l = after && after.find((x) => x.sku === item.sku);
      const right = !!l && l.card === item.card;
      if (skipped.has(item.sku) && !right) { result.choice.push(item.name); continue; }
      if (!after) { if (errors.has(item.sku)) result.failed.push(item.name); else result.ok++; continue; }
      if (!l) { result.failed.push(item.name); continue; }
      if (!right) { result.otherShop.push(item.name); continue; }
      if (l.qty < item.qty) result.fewer.push({ name: item.name, n: l.qty });
      else if (l.qty > item.qty) result.more.push({ name: item.name, n: l.qty });
      if (l.selected) result.ok++; else unticked.push({ l, item });
    }
    // A line unticked earlier would be left out at checkout: tick it, then look
    // again. One that stays unticked is not counted as done, and the note says so.
    if (unticked.length) {
      let ticked = false;
      try {
        await call('/cart/toggle_line_item_selection', {
          selected: true, line_item_ids: unticked.map((u) => u.l.id), proposal_product_ids: Object.fromEntries(after.map((l) => [l.id, l.pid])),
        }, 'PATCH');
        ticked = true;
      } catch (e) { console.warn('Eksipno Kalathi: could not tick', e); }
      let now = null;
      try { now = await cartLines(call); } catch (e) { console.warn('Eksipno Kalathi: could not read the cart', e); }
      for (const { l, item } of unticked) {
        // the cart could not be read again: the answer to the request is all there is
        const selected = now ? !!now.find((x) => x.id === l.id && x.selected) : ticked;
        if (selected) result.ok++; else result.unticked.push(item.name);
      }
    }
    await chrome.storage.local.set({ [RESULT_KEY]: { ts: Date.now(), result } });
    // show the cart as it is now; the reloaded page shows the result
    history.replaceState(null, '', location.pathname + location.search + DONE_HASH);
    location.reload();
  }
  runCartJob().catch((e) => console.warn('Eksipno Kalathi:', e));

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
