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

  // Both sites can change page without a full load, so keep an eye on the URL.
  const timer = setInterval(update, 1000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.cart || changes.settings || (BP && changes.bp))) return;
    mem = null;
    update(true);
  });
  update();
})();
