# CartWise for Skroutz

A Chrome / Edge extension that finds the cheapest way to buy a list of skroutz.gr products.

For the products in your list it reads the price of every store (including offers shipped from Skroutz Hub) and shows three results as tabs, each with its total:

1. **Single delivery** – the cheapest way to get everything in one shipment: from one store, or from Skroutz Hub (which can combine several stores).
2. **Skroutz** – the cheapest combination across any number of Skroutz stores, shipping included.
3. **With BestPrice** – shows a total only when buying one or more products at a BestPrice.gr merchant makes the order cheaper than Skroutz alone; otherwise it says that no BestPrice offer lowers the total.

**Add to Skroutz cart** under a result opens your Skroutz cart and adds that result's Skroutz offers to it (from the chosen stores, in the chosen quantities). Products that the result takes from BestPrice are bought through their links.

## Install

1. Open `edge://extensions` (Edge) or `chrome://extensions` (Chrome).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.

## Use

- Open a product page on skroutz.gr or bestprice.gr, open the popup and press **Add this page's product**.
  Both sites also get a floating **+ Add to CartWise** button at the bottom left of product pages.
- A product added from BestPrice is looked up on Skroutz; if the extension is not sure which Skroutz product it is, it asks you to choose.
- The sliders button opens the settings: **I have Skroutz Plus**, **Compare with BestPrice**, **Skroutz Point / Home** delivery and **Language** (English / Ελληνικά; the default follows the browser).
- **Availability** and **Delivery within** (settings) leave out offers that are not in stock, not immediately available, or too slow. Result lines show a note such as "in ~12 days" when the chosen offer is not in stock.
- Product names in the results link straight to the chosen shop's offer.
- A product that Skroutz does not sell is priced from BestPrice, and its line is marked BestPrice.
- **Hide** / **Show** next to the product count folds the product list away to save space.
- **Undo** takes back the last change to the list (add, remove, quantity, empty); **Empty cart** removes everything.
- The round arrow re-reads prices (they are cached for 15 minutes).

## How shipping is calculated

- One fee per store, however many items you take from it (the highest fee among those items).
- All Skroutz Hub items share one fee, even when different stores sell them.
- A shipment is free when one of its items already ships free.
- With Skroutz Plus, a shipment made only of Plus-eligible items is free from 15 € to a Skroutz Point and from 25 € to your home.

Large lists are calculated in the background for up to 5 seconds per tab; if the search is stopped, the result is marked as the best found and **Search longer** lets it run for up to 45 seconds.

These are the rules Skroutz shows on its product pages and help centre; the final amount is always confirmed at Skroutz checkout.

## BestPrice comparison

- Each Skroutz product is searched on BestPrice by name and manufacturer part number. A candidate is accepted only when it is verified: the part number, or identical shop listing titles, appear on both sites, and the names do not disagree on capacity, wattage, length or colour.
- When nothing can be verified the product is left unmatched and you choose it yourself under **Matched products** in the With BestPrice tab (or paste a BestPrice link). **change** next to a match lets you replace it.
- One shipping fee per merchant (the highest among the items taken from it). Merchants that state no shipping cost are assumed to charge 3,50 €.
- You buy on each merchant's own site, so there is no Skroutz Hub or Plus, and payment extras such as cash on delivery are not included.

## Files

- `lib/bestprice.js` – BestPrice search, product matching and merchant price list.

- `lib/parser.js` – turns Skroutz's store list (`/s/<id>/shops_list`) into offers.
- `lib/optimizer.js` – the search for the cheapest single delivery and the cheapest overall split. `lib/worker.js` runs it in the background.
- `lib/i18n.js` – English and Greek text. `_locales/` – the extension name and description for the browser.
- `popup.*` – the popup. `content.*` – the button on product pages, and the step that adds the chosen offers to the Skroutz cart.
