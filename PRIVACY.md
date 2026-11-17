# CartWise – Privacy Policy

_Last updated: 17 November 2026_

CartWise is a browser extension that finds the cheapest way to buy a list of products on skroutz.gr, and checks whether bestprice.gr merchants make it cheaper. This policy explains what the extension does with data.

## Summary

CartWise does not collect, transmit, sell or share any personal data. It has no servers, no accounts, no analytics and no advertising. Everything it stores stays in your browser.

## What is stored, and where

The extension keeps the following in your browser's local extension storage (`chrome.storage.local`) on your own device:

- your product list (product ids, names, picture addresses, quantities);
- your settings (Skroutz Plus on/off, delivery type, availability filters, language, whether you have seen the quick guide);
- prices and shop lists it has read from skroutz.gr and bestprice.gr, kept briefly so they do not have to be re-read every time;
- which BestPrice product corresponds to each Skroutz product;
- earlier versions of your list, for the Undo button.

None of this is sent to the developer or to any third party. It is deleted when you remove the extension, and you can empty the list at any time with **Empty cart**.

## Network requests

To read prices, the extension requests public pages from two websites, directly from your browser:

- `https://www.skroutz.gr`
- `https://www.bestprice.gr`

These are the same pages you would see by visiting the sites yourself, requested only for the products in your list. Prices are read without your Skroutz or BestPrice login cookies. As with any visit, those sites receive your IP address and may log the request under their own privacy policies. The extension contacts no other server.

## Adding to your Skroutz cart

When you press **Add to Skroutz cart**, the extension opens your Skroutz cart page in a new tab and, from that page, adds the offers of the result you chose, using the same request the site's own "add to cart" button makes. This happens only when you press the button, it uses your normal Skroutz session in that tab (logged in or not), and it only adds products: it never removes anything, places an order or pays. The extension does not read or store your Skroutz account details or the contents of your cart.

## Permissions

- **storage** – to keep your list and settings in your browser, as described above.
- **activeTab** – to read the address of the tab you are on when you open the extension, so it can offer "Add this page's product".
- **Access to skroutz.gr and bestprice.gr** – to read product prices and shipping costs from those sites, to show the "Add to CartWise" button on their product pages, and to add the offers you chose to your Skroutz cart when you ask for it.

The extension does not read or change any other website, and does not read your browsing history.

## What CartWise does not do

- It does not collect names, email addresses, payment details, passwords or location.
- It does not track which pages you visit.
- It does not place orders or pay, and it changes nothing on your Skroutz or BestPrice account other than adding products to your Skroutz cart when you press the button for it.
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

_Τελευταία ενημέρωση: 17 Νοεμβρίου 2026_

Το CartWise είναι μια επέκταση browser που βρίσκει τον φθηνότερο τρόπο να αγοράσεις μια λίστα προϊόντων στο skroutz.gr και στο bestprice.gr.

**Με λίγα λόγια:** το CartWise δεν συλλέγει, δεν μεταδίδει, δεν πουλάει και δεν μοιράζεται προσωπικά δεδομένα. Δεν έχει διακομιστές, λογαριασμούς, στατιστικά χρήσης ή διαφημίσεις. Ό,τι αποθηκεύει μένει στον browser σου.

- **Τι αποθηκεύεται τοπικά:** η λίστα προϊόντων σου, οι ρυθμίσεις σου, οι τιμές και τα καταστήματα που διάβασε από τα δύο sites (για λίγο, ώστε να μη διαβάζονται ξανά κάθε φορά), η αντιστοίχιση προϊόντων Skroutz–BestPrice και οι προηγούμενες εκδόσεις της λίστας για την Αναίρεση. Διαγράφονται όταν αφαιρέσεις την επέκταση.
- **Αιτήματα δικτύου:** η επέκταση ζητά δημόσιες σελίδες μόνο από το `www.skroutz.gr` και το `www.bestprice.gr`, απευθείας από τον browser σου και χωρίς τα cookies σύνδεσής σου για την ανάγνωση τιμών. Όπως σε κάθε επίσκεψη, τα sites αυτά βλέπουν τη διεύθυνση IP σου σύμφωνα με τις δικές τους πολιτικές. Δεν γίνεται επικοινωνία με κανέναν άλλο διακομιστή.
- **Προσθήκη στο καλάθι του Skroutz:** όταν πατάς «Προσθήκη στο καλάθι του Skroutz», η επέκταση ανοίγει τη σελίδα του καλαθιού σου σε νέα καρτέλα και προσθέτει από εκεί τις προσφορές του αποτελέσματος που διάλεξες, με το ίδιο αίτημα που κάνει το κουμπί του ίδιου του site. Γίνεται μόνο όταν πατήσεις το κουμπί και μόνο προσθέτει προϊόντα: δεν αφαιρεί τίποτα, δεν κάνει παραγγελία και δεν πληρώνει. Η επέκταση δεν διαβάζει ούτε αποθηκεύει τα στοιχεία του λογαριασμού σου ή τα περιεχόμενα του καλαθιού σου.
- **Άδειες:** *storage* για τη λίστα και τις ρυθμίσεις· *activeTab* για να διαβάζει τη διεύθυνση της τρέχουσας καρτέλας όταν ανοίγεις την επέκταση· πρόσβαση στο skroutz.gr και στο bestprice.gr για να διαβάζει τιμές και μεταφορικά, να εμφανίζει το κουμπί «Προσθήκη στο CartWise» και να προσθέτει στο καλάθι του Skroutz όταν το ζητήσεις.
- **Τι δεν κάνει:** δεν συλλέγει ονόματα, email, στοιχεία πληρωμής, κωδικούς ή τοποθεσία· δεν παρακολουθεί ποιες σελίδες επισκέπτεσαι· δεν κάνει παραγγελίες ούτε πληρωμές· δεν φορτώνει κώδικα από το διαδίκτυο.

Επικοινωνία: <https://github.com/ekilaroglou/cartwise/issues>.

Το CartWise είναι ανεξάρτητο έργο και δεν συνδέεται με το Skroutz ή το BestPrice ούτε έχει την έγκρισή τους.
