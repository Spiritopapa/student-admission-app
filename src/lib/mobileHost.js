/**
 * mobileHost.js - Bridge between the SchoolRunner web app and the native
 * Android shell (Flutter WebView).
 *
 * The Flutter shell injects a JavaScript channel named `flutterHost` into the
 * page. When present, browser features that Android's WebView cannot perform
 * are handed to the native side instead:
 *
 *   - `download`  -> the native app saves the CSV to the device's Documents
 *                    (WebView has no download manager).
 *   - `print`     -> the native app saves the print document as .html on the
 *                    device (WebView has no print dialog on older Android).
 *   - `printPdf`  -> the native app opens the SYSTEM print dialog for the
 *                    document (default destination: "Save as PDF").
 *   - `pickImage` -> the native app opens the device photo picker and returns
 *                    the chosen file's bytes (WebView file inputs are inert).
 *
 * On desktop browsers `isMobileShell()` is false and every function falls
 * back to the normal browser behaviour, so this module is a no-op on the web.
 */

const CHANNEL = 'flutterHost';

export function isMobileShell() {
  return (
    typeof window !== 'undefined' &&
    typeof window[CHANNEL] === 'object' &&
    typeof window[CHANNEL].postMessage === 'function'
  );
}

function post(cmd, payload) {
  if (!isMobileShell()) return false;
  try {
    window[CHANNEL].postMessage(JSON.stringify({ cmd, ...payload }));
  } catch (err) {
    return false;
  }
  return true;
}

/** Hand a CSV/plain-text download to the native app. Returns true if handled. */
export function mobileDownload(filename, content) {
  return post('download', { filename, content });
}

/** Hand a printable document (full standalone <html>) to the native app. */
export function mobilePrint(title, html) {
  return post('print', { title, html });
}

/**
 * Hand a printable document to the native app's SYSTEM print dialog, whose
 * default destination is "Save as PDF" (real printers work too). Returns
 * true if the native shell received the message.
 */
export function mobilePrintPdf(title, html) {
  return post('printPdf', { title, html });
}

/** Ask the native app for an image chosen from the device. Resolves File|null. */
export function mobilePickImage() {
  if (!isMobileShell()) return Promise.resolve(null);
  return new Promise((resolve) => {
    pickResolver = resolve;
    post('pickImage', {});
    // Safety valve in case the native picker never answers (e.g. cancelled).
    setTimeout(() => {
      if (!pickResolver) return;
      const resolve = pickResolver;
      pickResolver = null;
      resolve(null);
    }, 120000);
  });
}

/* ---------------- native -> web callbacks ---------------- */

let pickResolver = null;

// The native shell resolves a picked image by calling this function.
window.__schoolrunnerPickImage = (b64, name, mime) => {
  const resolve = pickResolver;
  pickResolver = null;
  if (!resolve || !b64) {
    resolve?.(null);
    return;
  }
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.codeUnitAt(i);
    resolve(new File([bytes], name || 'photo.jpg', { type: mime || 'image/jpeg' }));
  } catch (err) {
    resolve(null);
  }
};

// The native shell confirms a saved document (e.g. CSV / print document).
window.__schoolrunnerOnAction = (type, result) => {
  const listeners = (window.__schoolrunnerActionListeners ||= {})[type];
  if (listeners) listeners.forEach((cb) => cb(result));
};

export function onNativeAction(type, callback) {
  (window.__schoolrunnerActionListeners ||= {})[type] ||= [];
  window.__schoolrunnerActionListeners[type].push(callback);
}