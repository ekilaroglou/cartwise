// Runs the search off the popup's main thread, so the popup stays responsive
// while a large list is being calculated.
import { optimize } from './optimizer.js';

self.onmessage = (e) => {
  const { tab, key, products, settings } = e.data;
  let result;
  try {
    result = optimize(products, settings);
  } catch (err) {
    result = { error: String(err && err.message ? err.message : err) };
  }
  self.postMessage({ tab, key, result });
};
