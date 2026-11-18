// Runs before popup.js: shows the window as it looked when it was last
// closed (a copy popup.js keeps in localStorage), so the popup opens at its
// final size and content instead of growing while the saved data is read.
// popup.js then draws the real content over it, normally identical.
(() => {
  try {
    const snap = JSON.parse(localStorage.getItem('cartwise-snapshot') || 'null');
    // a copy from another version may not match this page
    if (!snap || snap.v !== chrome.runtime.getManifest().version || typeof snap.html !== 'string') return;
    document.getElementById('app').innerHTML = snap.html;
    if (snap.lang) document.documentElement.lang = snap.lang;
  } catch { /* first run, or storage not available */ }
})();
