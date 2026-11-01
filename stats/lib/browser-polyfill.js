// Thin wrapper: use browser.* (Firefox) with chrome.* fallback.
// globalThis-oppslag kaster ikke når siden lastes uten utvidelses-API
// (demomodus over http), da blir browserAPI bare undefined.
const browserAPI = globalThis.browser ?? globalThis.chrome;

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

// Storage wrapper — always returns promises
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
