// Thin wrapper: use browser.* (Firefox) with chrome.* fallback
const browserAPI = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : undefined;

// Promisify chrome.* callback APIs if needed
function promisify(fn) {
  return (...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
}

// Storage wrapper, always returns promises
const storage = {
  async get(keys) {
    if (
      browserAPI.storage.local.get.constructor.name === "AsyncFunction" ||
      typeof browser !== "undefined"
    ) {
      return browserAPI.storage.local.get(keys);
    }
    return promisify(chrome.storage.local.get)(keys);
  },
  async set(items) {
    if (typeof browser !== "undefined") {
      return browserAPI.storage.local.set(items);
    }
    return promisify(chrome.storage.local.set)(items);
  },
};

export { browserAPI, storage };
