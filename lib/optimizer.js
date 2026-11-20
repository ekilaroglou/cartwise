// Finds the cheapest way to buy a list of products on Skroutz.
//
// Shipping model (one "shipment" = one shipping fee):
//   * every store is its own shipment;
//   * all items shipped from Skroutz Hub, whatever store sells them, travel
//     together as ONE shipment;
//   * a shipment costs the highest fee of the items in it;
//   * a shipment is free when one of its items already ships for free, or when
//     the user has Skroutz Plus, every item in it is Plus-eligible and the
//     shipment subtotal reaches the Plus minimum.
//
// All money is handled in integer cents.

const HUB = 'hub';
const cents = (eur) => Math.round(eur * 100);

/** Turn raw offers into solver offers for the given settings. */
function prepare(products, settings) {
  const mode = settings.delivery === 'home' ? 'home' : 'point';
  const defaultFee = settings.defaultFee ?? 3.5;
  // Skroutz Plus: free from 15 € to a Skroutz Point, from 25 € to an address
  const minPoint = cents(settings.plusMin ?? 15);
  const minHome = cents(settings.plusMinHome ?? 25);

  // A shop that advertises "free with Plus" on one product is Plus-eligible on
  // all of them (Skroutz only shows the badge when the item alone qualifies).
  const shopPlus = new Map();
  for (const p of products) {
    for (const o of p.offers) {
      if (o.plus === 'any' || (o.plus === 'point' && shopPlus.get(o.shopId) !== 'any')) shopPlus.set(o.shopId, o.plus);
    }
  }

  const lists = products.map((p) => {
    const qty = Math.max(1, p.qty || 1);
    const offers = p.offers.map((o) => {
      // Delivery to a Skroutz Point chosen, but this offer only goes to an
      // address (it shows no Point fee): its shipping and its Plus minimum
      // are those of a home delivery.
      const homeOnly = mode === 'point' && o.pointFee == null && o.homeFee != null;
      // To an address, with only the Point fee known: at least that, and at
      // least the usual fee (the address costs more than a Point).
      const raw = mode === 'point' ? (o.pointFee ?? o.homeFee)
        : (o.homeFee ?? (o.pointFee == null ? null : Math.max(o.pointFee, defaultFee)));
      const scope = o.plus || shopPlus.get(o.shopId) || null;
      // Plus-eligible shops deliver free to a Skroutz Point and to an address;
      // only the minimum differs.
      // (an offer that only goes to an address counts as delivered home, Point mode or not)
      const plusOk = !!settings.hasPlus && !!scope && (mode === 'home' || homeOnly || scope === 'any' || o.pointFee != null);
      return {
        ref: o,
        group: o.hub ? HUB : 's' + o.shopId,
        price: cents(o.price) * qty,
        fee: cents(raw == null ? defaultFee : raw),
        feeEstimated: raw == null || (mode === 'home' && o.homeFee == null),
        plusOk,
        pmin: mode === 'home' || homeOnly ? minHome : minPoint,
      };
    });
    return { product: p, qty, offers };
  });

  // the most a shipment of each group can cost to send
  const groupFee = new Map();
  for (const l of lists) for (const o of l.offers) groupFee.set(o.group, Math.max(groupFee.get(o.group) || 0, o.fee));

  /** b makes a pointless: same shipment group, and at least as good on everything. */
  const beats = (b, a, earlier) => {
    if (b.group !== a.group || b.price > a.price || b.fee > a.fee || (a.plusOk && !b.plusOk) || b.pmin > a.pmin) return false;
    // A dearer Plus-eligible offer can lift its shipment to the Plus minimum
    // and so make it free: it stays while it costs less extra than the
    // shipping it could save.
    if (settings.hasPlus && a.plusOk && b.fee > 0 && a.price > b.price && a.price - b.price < groupFee.get(a.group)) return false;
    return earlier || b.price < a.price || b.fee < a.fee || (b.plusOk && !a.plusOk) || b.pmin < a.pmin;
  };
  return lists.map(({ product, qty, offers }) => {
    const kept = offers.filter((a, i) => !offers.some((b, j) => j !== i && beats(b, a, j < i)));
    kept.sort((a, b) => a.price - b.price || a.fee - b.fee);
    return { product, qty, offers: kept };
  });
}

/** A shipment's cost to send. Its Plus minimum is the highest of its items' (home beats Point). */
function shipmentFee(items) {
  let sub = 0, maxFee = 0, free = false, allPlus = true, min = 0;
  for (const o of items) {
    sub += o.price;
    if (o.fee === 0) free = true;
    if (o.fee > maxFee) maxFee = o.fee;
    if (!o.plusOk) allPlus = false;
    if (o.pmin > min) min = o.pmin;
  }
  if (free) return { fee: 0, reason: 'free', sub };
  if (allPlus && sub >= min) return { fee: 0, reason: 'plus', sub };
  return { fee: maxFee, reason: 'paid', sub };
}

function evaluate(choice) {
  const groups = new Map();
  let total = 0;
  for (const o of choice) {
    total += o.price;
    let g = groups.get(o.group);
    if (!g) groups.set(o.group, (g = []));
    g.push(o);
  }
  for (const items of groups.values()) total += shipmentFee(items).fee;
  return total;
}

/** Hill-climb: move one product at a time to whatever offer lowers the total. */
function localSearch(prods, choice) {
  let cost = evaluate(choice);
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 0; i < prods.length; i++) {
      const keep = choice[i];
      let bestO = keep;
      for (const o of prods[i].offers) {
        if (o === keep) continue;
        choice[i] = o;
        const c = evaluate(choice);
        if (c < cost) { cost = c; bestO = o; improved = true; }
      }
      choice[i] = bestO;
    }
  }
  return cost;
}

/**
 * Shops that sell only ONE of the products can never share a shipment, so for
 * each product only the best of them (item + its own shipping) can matter.
 * They are folded into a single stand-in offer whose price already includes
 * the shipping. This keeps the search exact and makes it far smaller: most
 * shops of a product sell nothing else on the list.
 */
function reduce(prods) {
  const seenIn = new Map(); // group -> number of products that have an offer in it
  for (const p of prods) {
    for (const g of new Set(p.offers.map((o) => o.group))) seenIn.set(g, (seenIn.get(g) || 0) + 1);
  }
  return prods.map((p) => {
    const offers = [];
    let solo = null;
    for (const o of p.offers) {
      if (seenIn.get(o.group) > 1) { offers.push(o); continue; }
      const cost = o.price + shipmentFee([o]).fee;
      if (!solo || cost < solo.price || (cost === solo.price && o.price < solo.orig.price)) {
        solo = { group: o.group, price: cost, fee: 0, plusOk: false, pmin: 0, feeEstimated: false, ref: o.ref, orig: o };
      }
    }
    if (solo) offers.push(solo);
    offers.sort((a, b) => a.price - b.price || a.fee - b.fee);
    return { ...p, offers };
  });
}

/**
 * Exact branch & bound over "which offer for each product".
 * Stops at `until` (a Date.now() value): the answer is then the best found so
 * far and `exact` is false.
 * Returns { choice, cost, exact } or null when some product has no offer.
 */
function solve(input, settings, until = Infinity) {
  const n = input.length;
  if (!n || input.some((p) => !p.offers.length)) return null;
  const hasPlus = !!settings.hasPlus;
  const prods = reduce(input);

  // --- starting solutions: cheapest item prices, and "pull everything into group g" ---
  let best = prods.map((p) => p.offers[0]);
  let bestCost = localSearch(prods, best);
  const coverage = new Map(); // group -> number of products it can carry
  const freeGroups = new Set(); // groups containing some free-shipping offer
  for (const p of prods) for (const o of p.offers) {
    coverage.set(o.group, (coverage.get(o.group) || 0) + 1);
    if (o.fee === 0) freeGroups.add(o.group);
  }
  // Starting points only: the groups that can carry the most products.
  const seeds = [...coverage].filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([g]) => g);
  for (const g of seeds) {
    const cand = prods.map((p) => p.offers.find((o) => o.group === g) || p.offers[0]);
    const c = localSearch(prods, cand);
    if (c < bestCost) { bestCost = c; best = cand; }
  }

  // --- branch & bound ---
  const order = prods.map((_, i) => i).sort((a, b) => prods[a].offers.length - prods[b].offers.length);
  const restMin = new Array(n + 1).fill(0);
  for (let k = n - 1; k >= 0; k--) restMin[k] = restMin[k + 1] + prods[order[k]].offers[0].price;

  const open = new Map(); // group -> {sub, maxFee, free, allPlus, pmin}
  const choice = new Array(n);
  let nodes = 0;
  let exact = true;

  // Fees of open shipments that can no longer drop to zero.
  const firmFees = () => {
    let f = 0;
    for (const [g, s] of open) {
      if (s.free || freeGroups.has(g) || (hasPlus && s.allPlus)) continue;
      f += s.maxFee;
    }
    return f;
  };
  const currentFees = () => {
    let f = 0;
    for (const s of open.values()) {
      if (s.free || (s.allPlus && s.sub >= s.pmin)) continue;
      f += s.maxFee;
    }
    return f;
  };

  const dfs = (k, priceSum) => {
    if (k === n) {
      const cost = priceSum + currentFees();
      if (cost < bestCost) { bestCost = cost; best = choice.slice(); }
      return;
    }
    if ((++nodes & 1023) === 0 && Date.now() > until) { exact = false; return; }
    if (priceSum + restMin[k] + firmFees() >= bestCost) return;
    const i = order[k];
    for (const o of prods[i].offers) {
      if (priceSum + o.price + restMin[k + 1] >= bestCost) break; // offers are price-sorted
      const prev = open.get(o.group);
      open.set(o.group, prev
        ? { sub: prev.sub + o.price, maxFee: Math.max(prev.maxFee, o.fee), free: prev.free || o.fee === 0, allPlus: prev.allPlus && o.plusOk, pmin: Math.max(prev.pmin, o.pmin) }
        : { sub: o.price, maxFee: o.fee, free: o.fee === 0, allPlus: o.plusOk, pmin: o.pmin });
      choice[i] = o;
      dfs(k + 1, priceSum + o.price);
      if (prev) open.set(o.group, prev); else open.delete(o.group);
      if (!exact) return;
    }
  };
  dfs(0, 0);

  // hand back the real offers behind the stand-ins
  return { choice: best.map((o) => o.orig || o), cost: bestCost, exact };
}

/** Human-friendly description of a solution. */
function describe(prods, sol) {
  const groups = new Map();
  sol.choice.forEach((o, i) => {
    let g = groups.get(o.group);
    if (!g) groups.set(o.group, (g = []));
    g.push({ o, p: prods[i] });
  });
  const shipments = [];
  let itemsTotal = 0, shippingTotal = 0;
  for (const [key, list] of groups) {
    const { fee, reason, sub } = shipmentFee(list.map((x) => x.o));
    itemsTotal += sub;
    shippingTotal += fee;
    shipments.push({
      key,
      hub: key === HUB,
      shops: [...new Set(list.map((x) => x.o.ref.shopName))],
      items: list.map(({ o, p }) => ({
        productId: p.product.id,
        name: p.product.name,
        qty: p.qty,
        price: o.price / 100,
        shopId: o.ref.shopId,
        shopName: o.ref.shopName,
        // for links and availability notes
        cardId: o.ref.cardId,
        url: o.ref.url,
        eta: o.ref.eta,
        days: o.ref.days,
        stock: o.ref.stock,
        choice: !!o.ref.choice, // needs a size or option chosen on Skroutz
      })),
      subtotal: sub / 100,
      fee: fee / 100,
      feeReason: reason,
      feeEstimated: reason === 'paid' && list.some((x) => x.o.feeEstimated),
    });
  }
  shipments.sort((a, b) => b.subtotal - a.subtotal);
  return {
    total: (itemsTotal + shippingTotal) / 100,
    itemsTotal: itemsTotal / 100,
    shippingTotal: shippingTotal / 100,
    shipments,
    exact: sol.exact,
  };
}

/**
 * @param products [{id, name, qty, offers: [parser offers]}]
 * @param settings {hasPlus, delivery: 'point'|'home', plusMin, plusMinHome, defaultFee, budgetMs}
 *        budgetMs: how long the overall search may run (default 5000)
 * @returns {{
 *   missing: string[],            ids of products nobody sells
 *   single: Array,                single deliveries (one store, or Skroutz Hub) carrying everything, cheapest first
 *   overall: object|null          cheapest combination across any stores
 * }}
 */
export function optimize(products, settings = {}) {
  const missing = products.filter((p) => !p.offers || !p.offers.length).map((p) => p.id);
  if (!products.length || missing.length) return { missing, single: [], overall: null };

  const prods = prepare(products, settings);

  // 1. Single deliveries: one shipment that carries every product. That is
  //    either one store, or Skroutz Hub (which may combine several stores).
  let common = null;
  for (const p of prods) {
    const keys = new Set(p.offers.map((o) => o.group));
    common = common ? new Set([...common].filter((k) => keys.has(k))) : keys;
  }
  const single = [];
  for (const key of common) {
    const restricted = prods.map((p) => ({ ...p, offers: p.offers.filter((o) => o.group === key) }));
    const sol = solve(restricted, settings, Date.now() + 1000);
    if (!sol) continue;
    const d = describe(restricted, sol, settings);
    const hub = key === HUB;
    single.push({ key, hub, label: hub ? 'Skroutz Hub' : d.shipments[0].shops[0], ...d });
  }
  single.sort((a, b) => a.total - b.total || a.label.localeCompare(b.label));

  // 2. Cheapest overall.
  const sol = solve(prods, settings, Date.now() + (settings.budgetMs ?? 5000));
  const overall = describe(prods, sol, settings);
  // The exact search can only tie or beat a single delivery; guard the time-limit fallback.
  if (single.length && single[0].total < overall.total) {
    const { total, itemsTotal, shippingTotal, shipments } = single[0];
    Object.assign(overall, { total, itemsTotal, shippingTotal, shipments, exact: true });
  }

  return { missing, single, overall };
}
