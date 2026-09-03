/**
 * Standalone page icon initializer.
 *
 * attendance-report.html / edit-student.html / verify-receipt.html are
 * separate HTML files that do not load js/app.js, so they need a tiny
 * bootstrap that:
 *   1. injects the shared SVG sprite,
 *   2. runs the icon pass,
 *   3. keeps it applied for any dynamic content.
 */
import { injectIconSprite, injectAppIcons } from './modules/icons.js';

function init() {
  injectIconSprite();
  injectAppIcons();

  // Keep icons applied when dynamic content renders.
  if (typeof MutationObserver === 'undefined') return;
  let timer = null;
  const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(injectAppIcons, 60);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}