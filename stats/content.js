/**
 * Content script for Min bildeling.
 *
 * Runs on app.dele.no pages (document_idle) and extracts the auth token
 * and membership ID from the app's persisted Redux state in localStorage.
 *
 * NOTE: Content scripts cannot use ES module imports, so we detect the
 * browser API inline instead of importing from browser-polyfill.js.
 */

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

/**
 * Extract auth token and membership ID from dele.no's localStorage.
 *
 * The app persists its Redux store under the key "persist:data".
 * Two of its sub-keys are JSON-encoded strings:
 *   - authentication  → the auth (bearer) token
 *   - selectedMembership → object with an `.id` property
 */
function extractAuth() {
  try {
    const raw = localStorage.getItem("persist:data");
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const authToken = JSON.parse(parsed.authentication);
    const membership = JSON.parse(parsed.selectedMembership);

    return {
      token: authToken,
      membershipId: membership.id,
    };
  } catch (e) {
    console.error("[Min bildeling] Failed to extract auth:", e);
    return null;
  }
}

// Respond to GET_AUTH requests from background/popup scripts.
browserAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_AUTH") {
    const auth = extractAuth();
    sendResponse(auth);
  }
  // Return true to keep the message channel open for sendResponse.
  return true;
});

// Proactively send auth data to the background script on page load.
const auth = extractAuth();
if (auth) {
  browserAPI.runtime.sendMessage({ type: "AUTH_TOKEN", data: auth });
}
