# CartWise – Privacy Policy

_Last updated: 18 November 2026_

CartWise is a browser extension that finds the cheapest way to buy a list of products on skroutz.gr, and checks whether bestprice.gr merchants make it cheaper. This policy explains what the extension does with data.

## Summary

CartWise does not collect, transmit, sell or share any personal data. It has no servers, no accounts, no analytics and no advertising. Everything it stores stays in your browser.

## What is stored, and where

The extension keeps the following in your browser, on your own device, in its own extension storage (`chrome.storage.local`, unless noted):

- your product list (product ids, names, picture addresses, quantities);
- your settings (Skroutz Plus on/off, delivery type, availability filters, language, whether you have seen the quick guide);
- prices and shop lists it has read from skroutz.gr and bestprice.gr, kept briefly so they do not have to be re-read every time;
- which BestPrice product corresponds to each Skroutz product;
- earlier versions of your list, for the Undo button;
- the last calculated totals, and a copy of how the CartWise window last looked (in the extension page's own `localStorage`), so it opens straight away without flickering;
- while a product you just added is being looked up in the background, its Skroutz product number (in `chrome.storage.session`, which the browser clears when it closes), so that an opened CartWise window waits for that lookup instead of repeating it;
- after **Add to Skroutz cart**, a short summary of what was done (the names of products added, removed or not added), until the Skroutz cart page has shown it to you a few seconds later; it is then deleted.

None of this is sent to the developer or to any third party, and none of it is written into the websites' own storage. It is deleted when you remove the extension, and you can empty the list at any time with **Empty cart**.

## Network requests

To read prices, the extension requests public pages from two websites, directly from your browser:

- `https://www.skroutz.gr`
- `https://www.bestprice.gr`

These are the same pages you would see by visiting the sites yourself, requested only for the products in your list. Prices are read without your Skroutz or BestPrice login cookies (the only exception is your own Skroutz cart, described below). As with any visit, those sites receive your IP address and may log the request under their own privacy policies. The extension contacts no other server.

## Adding to your Skroutz cart

When you press **Add to Skroutz cart**, the extension first asks you to confirm, and asks whether to empty the rest of your Skroutz cart. To tell you how many other products that cart holds, it reads the list of products in it from skroutz.gr, with your normal Skroutz session (this is the only request made with your Skroutz cookies, and it starts when you point at or press the button).

When you confirm, it opens your Skroutz cart page in a new tab and, from that page, puts in the offers of the result you chose, using the same requests the site's own buttons make: it adds them, sets their quantities (so pressing twice does not double them), and only if you ticked the box, removes the other products. It never places an order or pays. What it reads about your cart is used only on your device, for that task: it is not sent to the developer or anyone else, and it is not kept, apart from the short summary described above, which is deleted once shown. The extension does not read your Skroutz account details.

## Permissions

- **storage** – to keep your list and settings in your browser, as described above.
- **offscreen** – to read the price pages of a product you just added with the page button in the background, so the popup opens with the totals ready. It reads only skroutz.gr and bestprice.gr, like the popup.
- **Access to skroutz.gr and bestprice.gr** – to read product prices and shipping costs from those sites, to see which of their product pages you are on when you open the extension (so it can offer "Add this page's product"), to show the "Add to CartWise" button on their product pages, and to put the offers you chose in your Skroutz cart when you ask for it.

The extension does not read or change any other website, and does not read your browsing history.

## What CartWise does not do

- It does not collect names, email addresses, payment details, passwords or location.
- It does not track which pages you visit.
- It does not place orders or pay, and it changes nothing on your Skroutz or BestPrice account other than your Skroutz cart when you confirm it: adding the chosen products, and removing the others only if you tick that box.
- It does not use remote code: all of its code is in the extension package.

## Children

CartWise is a general-purpose shopping tool and does not knowingly collect data from anyone, including children.

## Changes

If this policy changes, the new version will be published at this address with a new date.

## Contact

Questions or requests: open an issue at <https://github.com/ekilaroglou/cartwise/issues>.

CartWise is an independent project and is not affiliated with, endorsed by or sponsored by Skroutz or BestPrice.

---

# CartWise – Πολιτική Απορρήτου

_Τελευταία ενημέρωση: 18 Νοεμβρίου 2026_

Το CartWise είναι μια επέκταση browser που βρίσκει τον φθηνότερο τρόπο να αγοράσεις μια λίστα προϊόντων στο skroutz.gr και στο bestprice.gr.

**Με λίγα λόγια:** το CartWise δεν συλλέγει, δεν μεταδίδει, δεν πουλάει και δεν μοιράζεται προσωπικά δεδομένα. Δεν έχει διακομιστές, λογαριασμούς, στατιστικά χρήσης ή διαφημίσεις. Ό,τι αποθηκεύει μένει στον browser σου.

- **Τι αποθηκεύεται τοπικά:** η λίστα προϊόντων σου, οι ρυθμίσεις σου, οι τιμές και τα καταστήματα που διάβασε από τα δύο sites (για λίγο, ώστε να μη διαβάζονται ξανά κάθε φορά), η αντιστοίχιση προϊόντων Skroutz–BestPrice, οι προηγούμενες εκδόσεις της λίστας για την Αναίρεση, καθώς και τα τελευταία σύνολα και ένα αντίγραφο της τελευταίας εμφάνισης του παραθύρου (στο `localStorage` της σελίδας της επέκτασης), ώστε να ανοίγει αμέσως χωρίς τρεμόπαιγμα. Όσο ένα προϊόν που μόλις πρόσθεσες αναζητείται στο παρασκήνιο, κρατιέται ο αριθμός του στο `chrome.storage.session` (σβήνει όταν κλείσει ο browser). Μετά την «Προσθήκη στο καλάθι του Skroutz» κρατιέται μια σύντομη σύνοψη (ονόματα προϊόντων που προστέθηκαν, αφαιρέθηκαν ή δεν προστέθηκαν) μέχρι να σου τη δείξει η σελίδα του καλαθιού λίγα δευτερόλεπτα μετά, και μετά σβήνεται. Τίποτα δεν γράφεται στον αποθηκευτικό χώρο των ίδιων των sites. Όλα διαγράφονται όταν αφαιρέσεις την επέκταση.
- **Αιτήματα δικτύου:** η επέκταση ζητά δημόσιες σελίδες μόνο από το `www.skroutz.gr` και το `www.bestprice.gr`, απευθείας από τον browser σου και χωρίς τα cookies σύνδεσής σου για την ανάγνωση τιμών (εξαίρεση μόνο το καλάθι σου στο Skroutz, παρακάτω). Όπως σε κάθε επίσκεψη, τα sites αυτά βλέπουν τη διεύθυνση IP σου σύμφωνα με τις δικές τους πολιτικές. Δεν γίνεται επικοινωνία με κανέναν άλλο διακομιστή.
- **Προσθήκη στο καλάθι του Skroutz:** όταν πατάς «Προσθήκη στο καλάθι του Skroutz», η επέκταση ζητά πρώτα επιβεβαίωση και ρωτά αν θέλεις να αφαιρεθούν τα υπόλοιπα προϊόντα του καλαθιού σου. Για να σου πει πόσα άλλα προϊόντα έχει, διαβάζει τη λίστα του καλαθιού σου από το skroutz.gr με την κανονική σύνδεσή σου (μόνο αυτό το αίτημα γίνεται με τα cookies σου στο Skroutz, όταν δείχνεις ή πατάς το κουμπί). Αν επιβεβαιώσεις, ανοίγει τη σελίδα του καλαθιού σου σε νέα καρτέλα και από εκεί, με τα ίδια αιτήματα που κάνουν τα κουμπιά του site, προσθέτει τις προσφορές του αποτελέσματος που διάλεξες, ορίζει τις ποσότητες (ώστε ένα δεύτερο πάτημα να μην τις διπλασιάζει) και, μόνο αν το επέλεξες, αφαιρεί τα άλλα προϊόντα. Δεν κάνει παραγγελία και δεν πληρώνει. Ό,τι διαβάζει για το καλάθι σου χρησιμοποιείται μόνο στη συσκευή σου, για αυτή τη δουλειά: δεν στέλνεται πουθενά και δεν κρατιέται, εκτός από τη σύντομη σύνοψη που αναφέρεται παραπάνω, η οποία σβήνεται μόλις εμφανιστεί. Η επέκταση δεν διαβάζει τα στοιχεία του λογαριασμού σου.
- **Άδειες:** *storage* για τη λίστα και τις ρυθμίσεις· *offscreen* για να διαβάζει στο παρασκήνιο τις τιμές ενός προϊόντος που μόλις πρόσθεσες με το κουμπί της σελίδας (μόνο από τα δύο sites)· πρόσβαση στο skroutz.gr και στο bestprice.gr για να διαβάζει τιμές και μεταφορικά, να βλέπει σε ποια σελίδα προϊόντος τους βρίσκεσαι όταν ανοίγεις την επέκταση, να εμφανίζει το κουμπί «Προσθήκη στο CartWise» και να βάζει στο καλάθι του Skroutz τις προσφορές που διάλεξες όταν το ζητήσεις.
- **Τι δεν κάνει:** δεν συλλέγει ονόματα, email, στοιχεία πληρωμής, κωδικούς ή τοποθεσία· δεν παρακολουθεί ποιες σελίδες επισκέπτεσαι· δεν κάνει παραγγελίες ούτε πληρωμές· δεν αλλάζει τίποτα στον λογαριασμό σου στο Skroutz ή στο BestPrice εκτός από το καλάθι του Skroutz όταν το επιβεβαιώσεις· δεν φορτώνει κώδικα από το διαδίκτυο.

Επικοινωνία: <https://github.com/ekilaroglou/cartwise/issues>.

Το CartWise είναι ανεξάρτητο έργο και δεν συνδέεται με το Skroutz ή το BestPrice ούτε έχει την έγκρισή τους.
