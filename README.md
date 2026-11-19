# CartWise for Skroutz

A Chrome / Edge extension that finds the cheapest way to buy a list of skroutz.gr products.

For the products in your list it reads the price of every store (including offers shipped from Skroutz Hub) and shows three results as tabs, each with its total:

1. **Single delivery** – the cheapest way to get everything in one shipment: from one store, or from Skroutz Hub (which can combine several stores).
2. **Skroutz only** – the cheapest combination across any number of Skroutz stores, shipping included.
3. **With BestPrice** – the cheapest way when BestPrice.gr merchants may be used too, and how much it saves over Skroutz only. When no BestPrice offer lowers the total, it shows instead what buying on BestPrice would cost (products BestPrice does not have are taken from Skroutz and marked "not found" or "not sure"), so you can see that Skroutz only is cheaper.

**Add to Skroutz cart** under a result asks first: it shows how many products from how many stores, and how many other products your Skroutz cart already holds, with the choice to **empty the rest of the cart**. On confirming, it opens your Skroutz cart and puts that result's Skroutz offers in it (from the chosen stores, in the chosen quantities), then shows what it did. Products that the result takes from BestPrice are bought through their links.

- The Skroutz cart holds one line per product. A product already in it is moved to the chosen store and set to the chosen quantity, so pressing the button twice does not double anything.
- Each offer goes in as one piece and then gets its quantity, never above what the store has (the note on the cart page then says "only N available"; the results already use only stores that sell the whole quantity, so this happens only when a store's limit dropped since the prices were read). Asking Skroutz for more than a store has would make it pick another store.
- With **empty the rest** ticked, the other products are removed one by one before the order goes in, including ones that this result buys on BestPrice. The order's own products already in the cart stay. Skroutz's own "Remove all" is used only if a product cannot be removed and none of the order's products is in the cart. If the cart cannot be read at all, nothing is removed. The note lists what was removed.
- A product moved to another shop gets its quantity back if the move does not happen.
- The order runs on the cart page the popup opens. If Skroutz first shows its "checking your browser" page and the address loses its #cartwise on the way, it runs on the next cart page within 3 minutes. While Skroutz is slow to open the cart, a note says CartWise is waiting; if the cart does not open, the note says so (reloading the page within a few minutes tries again). An order confirmed longer ago is not run, and the note says so.
- While a result is being recalculated (the list just changed), its button waits for the new result. Pressing **Add to cart** in the question checks once more that the result for the list, its prices and the settings as they are now is still the same (every product, quantity, shop and offer, every price and shipping fee, BestPrice ones included, and the total, compared in whole cents). If not, nothing is sent: the question shows the updated order and its amount instead, and nothing is added until you confirm that one.
- Products whose store asks for a size or option first (clothes, shoes...) are not added: the window and the note list them, to add from their page, and the window leaves them out of its count and amount. One already in the cart keeps the size chosen for it.
- A product you had unticked in the Skroutz cart is ticked again, so it is part of the checkout. If it stays unticked, it is not counted as added, and the note asks you to tick it.

## Install

1. Open `edge://extensions` (Edge) or `chrome://extensions` (Chrome).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.

## Use

- Open a product page on skroutz.gr or bestprice.gr, open the popup and press **Add this page's product**.
  Both sites also get a floating **+ Add to CartWise** button at the bottom left of product pages.
- A product added with the page button is priced and looked up on BestPrice right away in the background, so the totals are ready when you open the popup.
- A product added from BestPrice is looked up on Skroutz; if the extension is not sure which Skroutz product it is, it asks you to choose. When it picks one by itself, **Undo** brings the BestPrice product back, with the Skroutz products found as the ones to choose from.
- The sliders button opens the settings: **I have Skroutz Plus**, **Compare with BestPrice**, **Skroutz Point / Home** delivery and **Language** (English / Ελληνικά; the default follows the browser).
- **Availability** and **Delivery within** (settings) leave out offers that are not in stock, not immediately available, or too slow, and offers whose availability is not shown. Result lines show a note such as "in ~12 days" when the chosen offer is not in stock.
- Each Skroutz store sells up to a set number of pieces (Skroutz's price list shows it), and the Skroutz cart takes each product from one store. So for a quantity above 1, a store is used only when it sells the whole quantity. When no store sells that many, the results say so instead of a total, and the product line shows "at most N per store" with **set to N** (counted, like the results, among the stores that fit the availability settings).
- A product whose prices could not be read again shows "not updated" with Retry; the totals keep using the prices read before.
- Product names in the results link straight to the chosen shop's offer.
- A product that Skroutz does not sell is priced from BestPrice, and its line is marked BestPrice.
- Clicking **Products** folds the product list away (and back) to save space.
- Every product takes one line. When two products start with the same words (e.g. two lengths of the same cable), the shared part is cut so the difference shows: "Anker 322 … 0.9m A81H5G11". The full name is in the tooltip.
- **Matched products** (With BestPrice tab) lists each product's cheapest BestPrice price, or "not found".
- The popup opens as it looked last time and keeps the totals on screen while prices are read again, so it does not flicker.
- **Undo** takes back the last change to the list (add, remove, quantity, empty); **Empty cart** removes everything.
- The round arrow re-reads prices (they are cached for 15 minutes).

## How shipping is calculated

- One fee per store, however many items you take from it (the highest fee among those items).
- A store that does not deliver to a Skroutz Point is counted as delivering to your address, with its fee and, with Plus, the 25 € minimum.
- All Skroutz Hub items share one fee, even when different stores sell them.
- A shipment is free when one of its items already ships free.
- With Skroutz Plus, a shipment made only of Plus-eligible items is free from 15 € to a Skroutz Point and from 25 € to your home.

Large lists are calculated in the background for up to 5 seconds per tab; if the search is stopped, the result is marked as the best found and **Search longer** lets it run for up to 45 seconds.

These are the rules Skroutz shows on its product pages and help centre; the final amount is always confirmed at Skroutz checkout.

## BestPrice comparison

- Each Skroutz product is searched on BestPrice by name and manufacturer part number. Names that disagree on capacity, wattage, length, colour or model code (Galaxy A55 / A56) are never the same product. A candidate is accepted when it is verified: the part number, or identical shop listing titles, appear on both sites. Without that, only a name that is nearly identical and the same model is accepted: every number and code of one name is in the other, and the same variant words (Pro, Plus, Ultra...). The same rules apply the other way round, for products added from BestPrice.
- Matches found automatically by versions before 1.13.2 are looked for again once, with these rules. A match chosen by you, or a Skroutz product that an older version found for a product added from BestPrice, is kept unless these rules call the two different products; then you are asked again ("not sure"), with that match as the one to choose. A Skroutz product that an older version may have put in place of a product you added from BestPrice, which these rules call a different model, is marked **Match needs review** on its line: keep it, or use the BestPrice product (which is then matched with Skroutz again, and priced from BestPrice meanwhile). Until you choose, it is not sent to the Skroutz cart.
- A Skroutz product found for one added from BestPrice remembers that product, and whether it was found automatically or picked by you. If later rules call an automatic one a different model, the BestPrice product comes back by itself (a message says so, and Undo reverses it); one you picked is only marked for review.
- When nothing can be verified the product is left unmatched and you choose it yourself under **Matched products** in the With BestPrice tab (or paste a BestPrice link). **change** next to a match lets you replace it.
- One shipping fee per merchant (the highest among the items taken from it). Merchants that state no shipping cost are assumed to charge 3,50 €.
- You buy on each merchant's own site, so there is no Skroutz Hub or Plus, and payment extras such as cash on delivery are not included.

## Files

- `lib/bestprice.js` – BestPrice search, product matching and merchant price list.

- `lib/parser.js` – turns Skroutz's store list (`/s/<id>/shops_list`) into offers.
- `lib/optimizer.js` – the search for the cheapest single delivery and the cheapest overall split. `lib/worker.js` runs it in the background.
- `lib/i18n.js` – English and Greek text. `_locales/` – the extension name and description for the browser.
- `background.js`, `offscreen.*` – the background lookup for products added with the page button (`lib/skroutz.js` reads Skroutz pages for it and for the popup).
- `popup.*` – the popup. `content.*` – the button on product pages, and the step that puts the chosen offers in the Skroutz cart.
- `pack.ps1` – makes `dist/cartwise-<version>.zip`, the file to upload to the Chrome Web Store and Edge Add-ons. `store/` – store logos and what to fill in when publishing (`store/STORE.md`).
- `icon.svg`, `icon-16.svg` – the icon's source; the PNGs in `icons/` and `store/` are made from them (`icon-16.svg` is the 16 px toolbar size, without the arrow).
