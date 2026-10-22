// The extension API: Firefox's promise-based `browser`, or `chrome` in Chromium browsers.
// Undefined when a page is opened outside the extension (e.g. a local dev preview).
export const ext = globalThis.browser ?? globalThis.chrome;
