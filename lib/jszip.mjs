// ES Module wrapper for JSZip
// Loads the minified JSZip and exports it as an ES module

const scriptUrl = chrome.runtime.getURL('lib/jszip.min.js');

let JSZip = null;

export async function loadJSZip() {
  if (JSZip) return JSZip;
  
  // For service worker, we need to use importScripts or fetch + eval
  // But Chrome extension service workers don't support importScripts well with ES modules
  // So we'll use a different approach - inline the JSZip code
  
  // For now, return a placeholder that will be replaced
  throw new Error('JSZip not available in service worker. Please use chrome.downloads API for single file downloads.');
}

// Try to get JSZip from global scope if it was loaded
if (typeof globalThis !== 'undefined' && globalThis.JSZip) {
  JSZip = globalThis.JSZip;
}

export default JSZip;
