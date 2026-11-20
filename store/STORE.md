# Publishing Eksipno Kalathi: what to upload and what to fill in

The same zip goes to both stores. Make it with `.\pack.ps1` (in PowerShell, from the project folder): it writes `dist/eksipno-kalathi-<version>.zip` with only the files the extension runs. Raise `version` in `manifest.json` before each new upload; both stores refuse a version they already have.

**Before each submission:** commit and push, so that the privacy policy link (`https://github.com/ekilaroglou/cartwise/blob/main/PRIVACY.md`) shows the text of the version you upload (the link always shows the `main` branch on GitHub). The link opens without logging in to GitHub; keep the repository public, or it stops working for the reviewers.

---

## Chrome Web Store (chrome.google.com/webstore/devconsole)

A developer account costs a one-time 5 USD fee.

### Package
Upload `dist/eksipno-kalathi-<version>.zip`.

### Store listing
- **Name and summary:** come from the package (`Eksipno Kalathi`; the 128-character summary).
- **Category:** Shopping.
- **Language:** English, then add Greek (the listing text can differ per language).
- **Description (English):**

> Eksipno Kalathi finds the cheapest way to buy a whole list of products on Skroutz.
>
> Add products from any skroutz.gr product page with the "+ Add to Eksipno Kalathi" button. Eksipno Kalathi reads every store's price and shipping cost and shows three totals:
> • Single delivery: everything in one shipment, from one store or from Skroutz Hub.
> • Skroutz only: the cheapest mix of Skroutz stores, shipping included.
> • With BestPrice: whether buying some products from BestPrice.gr merchants makes the order cheaper.
>
> It follows Skroutz's shipping rules (one fee per store, Skroutz Hub items share one fee, free shipping thresholds, Skroutz Plus), and can leave out offers that are not in stock or would arrive too late.
>
> When you have chosen, "Add to Skroutz cart" puts the chosen offers in your own Skroutz cart, after asking you, and can empty the rest of that cart first.
>
> Your list stays in your browser. Eksipno Kalathi has no servers, no accounts and no tracking.
>
> Eksipno Kalathi is an independent project and is not affiliated with Skroutz or BestPrice.

- **Description (Greek):**

> Το Eksipno Kalathi βρίσκει τον φθηνότερο τρόπο να αγοράσεις όλη μια λίστα προϊόντων στο Skroutz.
>
> Πρόσθεσε προϊόντα από οποιαδήποτε σελίδα προϊόντος του skroutz.gr με το κουμπί «+ Προσθήκη στο Eksipno Kalathi». Το Eksipno Kalathi διαβάζει την τιμή και τα μεταφορικά κάθε καταστήματος και δείχνει τρία σύνολα:
> • Μία παράδοση: όλα σε μία αποστολή, από ένα κατάστημα ή από το Skroutz Hub.
> • Μόνο Skroutz: ο φθηνότερος συνδυασμός καταστημάτων του Skroutz, με τα μεταφορικά.
> • Με BestPrice: αν η αγορά κάποιων προϊόντων από καταστήματα του BestPrice.gr φθηναίνει την παραγγελία.
>
> Ακολουθεί τους κανόνες αποστολής του Skroutz (ένα κόστος ανά κατάστημα, κοινό κόστος για τα προϊόντα του Skroutz Hub, δωρεάν μεταφορικά, Skroutz Plus) και μπορεί να αφήσει έξω προσφορές που δεν είναι διαθέσιμες ή θα αργούσαν.
>
> Όταν διαλέξεις, η «Προσθήκη στο καλάθι του Skroutz» βάζει τις επιλεγμένες προσφορές στο δικό σου καλάθι, αφού σε ρωτήσει, και μπορεί πρώτα να αδειάσει το υπόλοιπο καλάθι.
>
> Η λίστα σου μένει στον browser σου. Το Eksipno Kalathi δεν έχει διακομιστές, λογαριασμούς ή παρακολούθηση.
>
> Το Eksipno Kalathi είναι ανεξάρτητο έργο και δεν συνδέεται με το Skroutz ή το BestPrice.

### Graphics
- **Store icon, 128×128:** `store/logo-128.png` (a 96 px icon with 16 px of transparent margin, as the store asks). The icon's source is `icon-source.png`.
- **Screenshots:** at least one, 1280×800 or 640×400; upload all three, in this order: `store/screenshot-1-en.png` (the cheapest Skroutz result), `store/screenshot-2-en.png` (the BestPrice comparison), `store/screenshot-3-en.png` (the settings). They show the real popup in English; use the same ones for the Greek listing.
- **Small promo tile, 440×280:** `store/promo-440x280.png`. The dashboard says whether it is required for your listing.

### Privacy practices tab
- **Single purpose:**
  > Find the cheapest way to buy a list of Skroutz products (across Skroutz stores, Skroutz Hub and BestPrice.gr merchants), and put the chosen offers in the user's Skroutz cart.
- **Justification for `storage`:**
  > Keeps the user's product list, settings and recently read prices in the browser.
- **Justification for `offscreen`:**
  > When the user adds a product from a skroutz.gr page, its price pages are read and parsed in the background (DOMParser, which the service worker lacks), so the totals are ready when the popup opens. Only skroutz.gr and bestprice.gr are read.
- **Justification for host permissions (skroutz.gr, bestprice.gr):**
  > To read product prices and shipping costs from these two sites, to show the "Add to Eksipno Kalathi" button on their product pages, to see which of their product pages is open when the popup opens, and, only when the user confirms, to put the chosen offers in the user's Skroutz cart. No other site is accessed.
- **Remote code:** No.
- **Data usage:** tick **Website content**. Google's user data FAQ says data handled only on the device must be declared too, and reading content from websites counts as handling it. Eksipno Kalathi reads product pages, price lists and, when you add to it, your own Skroutz cart. No other category applies: Eksipno Kalathi does not read personal or payment details, passwords, location, browsing history or what you type or click.
  Nothing is sent to the developer or anyone else; say so where the form asks how the data is used.
- Tick the three certifications: no selling, no use unrelated to the single purpose, no use for credit.
- **Privacy policy URL:** `https://github.com/ekilaroglou/cartwise/blob/main/PRIVACY.md`

### Expected review
Access to two specific sites shows the install warning "Read and change your data on www.skroutz.gr and www.bestprice.gr". This usually means a longer review (days rather than hours). It is normal and does not need anything else.

---

## Microsoft Edge Add-ons (partner.microsoft.com/dashboard/microsoftedge)

Registration is free.

### Package
Upload the same zip.

### Availability
Choose public, and all markets or only Greece and nearby.

### Properties
- **Category:** Shopping.
- **Privacy policy:** required here because the extension accesses the user's data on the two sites. Use the same URL as for Chrome.
- **Website:** `https://github.com/ekilaroglou/cartwise`
- **Support contact:** the GitHub issues page.

### Store listings (English and Greek)
- **Description:** the same texts as above. Edge needs a description of at least about 250 characters, and both are longer.
- **Extension logo:** `store/logo-300.png` (300×300).
- **Screenshots and small promo tile (440×280):** optional; the same files as for Chrome.

### Notes for certification
Paste this into the notes field:

> To test: open https://www.skroutz.gr/s/21861596/p.html and press "+ Add to Eksipno Kalathi" at the bottom left of the page; add one or two more products the same way. Open the Eksipno Kalathi popup from the toolbar and press any of the three totals to see where to buy each product. "Add to Skroutz cart" asks for confirmation, then opens the Skroutz cart and adds the chosen offers. No account is needed: a guest Skroutz cart works. The sites are Greek; the popup's language can be switched to English in its settings (the sliders button).

---

## Risks to know about
- **Skroutz's and BestPrice's brands.** The name, Eksipno Kalathi, uses no other company's brand. The descriptions and images name Skroutz and BestPrice only to say what the extension works with, and say that it is not affiliated with them; the icon is the extension's own (a cart with a brain), though orange like Skroutz.
- **The extension depends on the sites' own pages and requests.** If Skroutz or BestPrice change them, parts can stop working until updated. They could also object to automated reading of their pages. Neither store checks this, but it can lead to a takedown request.
