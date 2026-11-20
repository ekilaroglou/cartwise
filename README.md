# Eksipno Kalathi

A Chrome extension that finds the cheapest way to buy a list of skroutz.gr products.

For the products in your list it reads the price of every store on Skroutz (including offers shipped from Skroutz Hub, and offers you buy on the shop's site, «Δες το στο κατάστημα») and shows three results as tabs, each with its total:

1. **Single delivery** – the cheapest way to get everything in one shipment through the Skroutz cart: from one store, or from Skroutz Hub (which can combine several stores).
2. **Skroutz only** – the cheapest combination across any number of stores through the Skroutz cart, shipping included.
3. **Cheapest overall** – the cheapest way when Skroutz offers you buy on the shop's site (see below) and BestPrice.gr merchants may be used too, and how much it saves over Skroutz only. When nothing lowers the total, the tab says **Nothing cheaper**; with BestPrice on, opening it shows what buying on BestPrice would cost (products BestPrice does not have are taken from Skroutz and marked "not found" or "not sure"), to compare.

Everything in the first two results can go into the Skroutz cart. When buying some products outside the Skroutz cart (on a shop's site, or via BestPrice) makes the order cheaper, those two results say by how much, with a link to **Cheapest overall**: a cheaper price is never left out silently.

**Add to Skroutz cart** under a result asks first: it shows how many products from how many stores, and how many other products your Skroutz cart already holds, with the choice to **empty the rest of the cart**. On confirming, it opens your Skroutz cart and puts that result's Skroutz cart offers in it (from the chosen stores, in the chosen quantities), then shows what it did. Products bought on a shop's site or via BestPrice have their own links; the question says how many.

- The Skroutz cart holds one line per product. A product already in it is moved to the chosen store and set to the chosen quantity, so pressing the button twice does not double anything.
- Each offer goes in as one piece and then gets its quantity, never above what the store has (the note on the cart page then says "only N available"; the results already use only stores that sell the whole quantity, so this happens only when a store's limit dropped since the prices were read). Asking Skroutz for more than a store has would make it pick another store.
- With **empty the rest** ticked, the other products are removed one by one after the order has gone in, including ones that this result buys on a shop's site or via BestPrice. The order's own products stay. If the order did not go in exactly as confirmed (each product from its shop, in its full quantity, ticked for checkout), or the cart cannot be read, nothing is removed. The note lists what was removed.
- A product moved to another shop gets its quantity back if the move does not happen.
- The order runs on the cart page the popup opens. If Skroutz first shows its "checking your browser" page and the address loses its #eksipno-kalathi on the way, it runs on the next cart page within 3 minutes. While Skroutz is slow to open the cart, a note says Eksipno Kalathi is waiting; if the cart does not open, the note says so (reloading the page within a few minutes tries again). An order confirmed longer ago is not run, and the note says so.
- While a result is being recalculated (the list just changed), its button waits for the new result. Pressing **Add to cart** in the question checks once more that the result for the list, its prices and the settings as they are now is still the same (every product, quantity, shop and offer, every price and shipping fee, BestPrice ones included, and the total, compared in whole cents). If not, nothing is sent: the question shows the updated order and its amount instead, and nothing is added until you confirm that one.
- Products whose store asks for a size or option first (clothes, shoes...) are not added: the window and the note list them, to add from their page, and the window leaves them out of its count and amount. One already in the cart keeps the size chosen for it.
- A product you had unticked in the Skroutz cart is ticked again, so it is part of the checkout. If it stays unticked, it is not counted as added, and the note asks you to tick it.

## Install

Install **Eksipno Kalathi** from the Chrome Web Store: open its page there and press **Add to Chrome**. It works in Google Chrome and in Microsoft Edge, which installs extensions from the Chrome Web Store too.

## Use

- Open a product page on skroutz.gr or bestprice.gr, open the popup and press **Add this page's product**.
  Both sites also get a floating **+ Add to Eksipno Kalathi** button at the bottom left of product pages.
- A product added with the page button is priced and looked up on BestPrice right away in the background, so the totals are ready when you open the popup.
- A product added from BestPrice is looked up on Skroutz; if the extension is not sure which Skroutz product it is, it asks you to choose. When it picks one by itself, **Undo** brings the BestPrice product back, with the Skroutz products found as the ones to choose from.
- The sliders button opens the settings: **I have Skroutz Plus**, **Check BestPrice**, **Also Skroutz offers you buy on the shop's site** (on by default), **Skroutz Point / Home** delivery and **Language** (English / Ελληνικά; the default follows the browser).
- **Availability** and **Delivery within** (settings) leave out offers that are not in stock, not immediately available, or too slow, and offers whose availability is not shown. Result lines show a note such as "in ~12 days" when the chosen offer is not in stock.
- Each Skroutz store sells up to a set number of pieces (Skroutz's price list shows it), and the Skroutz cart takes each product from one store. So for a quantity above 1, a store is used only when it sells the whole quantity. When no store sells that many, the results say so instead of a total, and the product line shows "at most N per store" with **set to N** (counted, like the results, among the stores that fit the availability settings).
- A product whose prices could not be read again shows "not updated" with Retry; the totals keep using the prices read before.
- Product names in the results link straight to the chosen shop's offer.
- A product that no shop sells through the Skroutz cart is priced from a Skroutz offer you buy on the shop's site, or else from BestPrice, and marked so.
- Clicking **Products** folds the product list away (and back) to save space.
- Every product takes one line. When two products start with the same words (e.g. two lengths of the same cable), the shared part is cut so the difference shows: "Anker 322 … 0.9m A81H5G11". The full name is in the tooltip.
- **Matched products** (Cheapest overall tab, when BestPrice is on) lists each product's cheapest BestPrice price, or "not found". If BestPrice could not be read at that moment, the tab says "Not checked", with **Retry**, instead of claiming the products are not there.
- If the browser's site access for skroutz.gr is turned off (the extensions menu allows that), the popup says so at the top, with **Allow access**: without it no prices can be read and the page button does not show.
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

## Skroutz offers you buy on the shop's site

Some shops on Skroutz sell a product only on their own website: Skroutz shows **Δες το στο κατάστημα** ("See it in the shop") instead of **Add to cart**, and sends you to the shop. These offers are often the cheapest, so they are read too (setting **Also Skroutz offers you buy on the shop's site**, on by default). They are shops listed on Skroutz, with Skroutz's own link to their page; no other website is searched.

- They are used only in **Cheapest overall**. **Single delivery** and **Skroutz only** stay within the Skroutz cart, and say when buying outside the Skroutz cart would make the order cheaper.
- An order on a shop's own website is separate from anything bought from the same shop through the Skroutz cart: its own shipment, with its own fee.
- Shipping: one fee per shop, the one Skroutz shows for the offer (the highest among the items taken from it), delivered to your address. No Skroutz Hub, Skroutz Plus or Skroutz Point there. A shop's own free-shipping threshold is not known, so its site may turn out cheaper at checkout, never dearer than counted.
- The **Availability** and **Delivery within** settings apply to them as to any Skroutz offer ("ready to ship in 6 days" counts as 8 days, so "In stock only" leaves it out).
- In the result they are marked **Shop's site**, and the title counts them "via shop's site"; the product name links straight to the shop's page, through Skroutz's own link. **Add to Skroutz cart** leaves them out, and its question says so.
- The same shop may also be on BestPrice. Buying from it through Skroutz's link and through BestPrice is counted as two orders, each with its shipping, since the two sites cannot be matched shop by shop reliably.
- A product that no shop sells through the Skroutz cart is priced from a shop's own website in **Skroutz only** (or from BestPrice), and marked so.

## BestPrice comparison

- Each Skroutz product is searched on BestPrice by name and manufacturer part number. Names that disagree on capacity, wattage, length, colour or model code (Galaxy A55 / A56) are never the same product. A candidate is accepted when it is verified: the part number, or identical shop listing titles, appear on both sites. Without that, only a name that is nearly identical and the same model is accepted: every number and code of one name is in the other, and the same variant words (Pro, Plus, Ultra...). The same rules apply the other way round, for products added from BestPrice.
- Matches found automatically by versions before 1.13.2 are looked for again once, with these rules. A match chosen by you, or a Skroutz product that an older version found for a product added from BestPrice, is kept unless these rules call the two different products; then you are asked again ("not sure"), with that match as the one to choose. A Skroutz product that an older version may have put in place of a product you added from BestPrice, which these rules call a different model, is marked **Match needs review** on its line: keep it, or use the BestPrice product (which is then matched with Skroutz again, and priced from BestPrice meanwhile). Until you choose, it is not sent to the Skroutz cart.
- A Skroutz product found for one added from BestPrice remembers that product, and whether it was found automatically or picked by you. If later rules call an automatic one a different model, the BestPrice product comes back by itself (a message says so, and Undo reverses it); one you picked is only marked for review.
- When nothing can be verified the product is left unmatched and you choose it yourself under **Matched products** in the Cheapest overall tab (or paste a BestPrice link). **change** next to a match lets you replace it.
- One shipping fee per merchant (the highest among the items taken from it). Merchants that state no shipping cost are assumed to charge 3,50 €.
- You buy on each merchant's own site, so there is no Skroutz Hub or Plus, and payment extras such as cash on delivery are not included.

## Files

- `lib/bestprice.js` – BestPrice search, product matching and merchant price list.
- `lib/parser.js` – turns Skroutz's store list (`/s/<id>/shops_list`) into offers: those bought through the Skroutz cart, and those sold on the shop's own website (`site`, with Skroutz's link to it).
- `lib/optimizer.js` – the search for the cheapest single delivery and the cheapest overall split. `lib/worker.js` runs it in the background.
- `lib/i18n.js` – English and Greek text. `_locales/` – the extension name and description for the browser.
- `background.js`, `offscreen.*` – the background lookup for products added with the page button (`lib/skroutz.js` reads Skroutz pages for it and for the popup).
- `popup.*` – the popup. `content.*` – the button on product pages, and the step that puts the chosen offers in the Skroutz cart.
- `pack.ps1` – makes `dist/eksipno-kalathi-<version>.zip`, the file to upload to the Chrome Web Store and Edge Add-ons. `store/` – store logos and what to fill in when publishing (`store/STORE.md`).
- `icon-source.png` – the icon at full size (612 px, transparent outside its rounded square); the PNGs in `icons/` and `store/` are made from it. Not part of the extension package.
