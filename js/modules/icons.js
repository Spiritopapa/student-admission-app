/**
 * App Icon System
 *
 * Re-introduces modern inline SVG icons everywhere the old emoji
 * glyphs used to live (they were stripped out of the UI, leaving
 * empty circles/boxes). Icons are drawn from a single inline SVG
 * sprite at the top of <body> and applied via:
 *   1) sidebar nav links      (data-*-page → icon map)
 *   2) fixed icon containers  (.dash-welcome-icon, .home-glass-icon, …)
 *   3) headings / summaries / buttons matched by a keyword map
 * A MutationObserver re-applies the pass after dynamic content
 * (dashboards, subpages, modals, tables) is rendered.
 */

const ICON_IDS = [
  'dashboard', 'users', 'user', 'user-plus', 'user-check', 'graduation',
  'school', 'book', 'book-open', 'receipt', 'parents', 'megaphone',
  'clipboard', 'clipboard-check', 'file-text', 'file', 'chart', 'chart-column',
  'trending-up', 'trending-down', 'coins', 'wallet', 'credit-card', 'pie-chart',
  'message-square', 'archive', 'download', 'upload', 'printer', 'trash',
  'eye', 'refresh', 'key', 'settings', 'shield', 'logout', 'search',
  'bell', 'calendar', 'clock', 'crown', 'smile', 'lock', 'id-card',
  'list-checks', 'smartphone', 'check-circle', 'alert', 'plus', 'edit',
  'x', 'menu', 'home', 'trophy', 'mail', 'phone', 'share', 'save', 'sun',
  'star', 'lightbulb', 'camera', 'flag', 'heart', 'help', 'briefcase',
  'sparkles',
];

/** Returns the <svg><use/></svg> markup for a named sprite icon. */
export function svgIcon(name) {
  if (!name || !ICON_IDS.includes(name)) return '';
  return `<svg class="app-icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

/** Sidebar page key (the data-*-page attribute) → sprite icon id. */
const NAV_ICONS = {
  dashboard: 'dashboard',
  students: 'users',
  classes: 'school',
  subjects: 'book-open',
  teachers: 'users',
  accountants: 'receipt',
  parents: 'parents',
  admit: 'user-plus',
  announcements: 'megaphone',
  attendance: 'clipboard',
  exams: 'file-text',
  assessments: 'clipboard-check',
  grading: 'chart',
  fees: 'coins',
  'income-expenses': 'trending-up',
  'sms-monitoring': 'message-square',
  backup: 'archive',
  profile: 'key',
  settings: 'settings',
  'sub-admins': 'shield',
  schools: 'school',
  'my-ward': 'parents',
  receipts: 'receipt',
  debtors: 'alert',
};
/**
 * Inline SVG sprite source (Lucide-style, stroke-based, 24x24). Only
 * injected once per document — index.html already carries the sprite
 * inline, and standalone pages (attendance-report / edit-student /
 * verify-receipt) get it injected by js/icons-init.js.
 */
const SPRITE_CHUNK_1 = '<svg id="app-icon-sprite" xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">'
  + '<symbol id="i-dashboard" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></symbol>'
  + '<symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol>'
  + '<symbol id="i-user" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol>'
  + '<symbol id="i-user-plus" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></symbol>'
  + '<symbol id="i-user-check" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></symbol>'
  + '<symbol id="i-graduation" viewBox="0 0 24 24"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12.5V17c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><line x1="22" y1="10" x2="22" y2="15"/></symbol>'
  + '<symbol id="i-school" viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><path d="M12 10h.01"/></symbol>'
  + '<symbol id="i-book" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></symbol>'
  + '<symbol id="i-book-open" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></symbol>'
  + '<symbol id="i-receipt" viewBox="0 0 24 24"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></symbol>'
  + '<symbol id="i-parents" viewBox="0 0 24 24"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M13.5 13.5a5 5 0 0 1 3 4.6V21"/></symbol>'
  + '<symbol id="i-megaphone" viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></symbol>'
  + '<symbol id="i-clipboard" viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M8 9h2"/></symbol>'
  + '<symbol id="i-clipboard-check" viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></symbol>'
  + '<symbol id="i-file-text" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a1 1 0 0 0 1 1h4"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M8 9h2"/></symbol>'
  + '<symbol id="i-file" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v4a1 1 0 0 0 1 1h4"/></symbol>'
  + '<symbol id="i-chart" viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></symbol>'
  + '<symbol id="i-chart-column" viewBox="0 0 24 24"><path d="M3 3v18h18"/><rect x="7" y="10" width="2.5" height="7" rx="0.5"/><rect x="11.5" y="6" width="2.5" height="11" rx="0.5"/><rect x="16" y="12" width="2.5" height="5" rx="0.5"/></symbol>'
  + '<symbol id="i-trending-up" viewBox="0 0 24 24"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></symbol>'
  + '<symbol id="i-trending-down" viewBox="0 0 24 24"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></symbol>'
  + '<symbol id="i-coins" viewBox="0 0 24 24"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></symbol>'
  + '<symbol id="i-wallet" viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></symbol>'
  + '<symbol id="i-credit-card" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></symbol>'
  + '<symbol id="i-pie-chart" viewBox="0 0 24 24"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></symbol>';
const SPRITE_CHUNK_2 = ''
  + '<symbol id="i-message-square" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>'
  + '<symbol id="i-archive" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/></symbol>'
  + '<symbol id="i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></symbol>'
  + '<symbol id="i-upload" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></symbol>'
  + '<symbol id="i-printer" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></symbol>'
  + '<symbol id="i-trash" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></symbol>'
  + '<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></symbol>'
  + '<symbol id="i-refresh" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></symbol>'
  + '<symbol id="i-key" viewBox="0 0 24 24"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><polyline points="21 2 11.4 11.6"/><circle cx="7.5" cy="15.5" r="5.5"/></symbol>'
  + '<symbol id="i-settings" viewBox="0 0 24 24"><line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/></symbol>'
  + '<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol>'
  + '<symbol id="i-logout" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></symbol>'
  + '<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></symbol>'
  + '<symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></symbol>'
  + '<symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></symbol>'
  + '<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></symbol>'
  + '<symbol id="i-crown" viewBox="0 0 24 24"><path d="M11.56 3.27a.5.5 0 0 1 .88 0L15.4 8.87a1 1 0 0 0 1.51.29l4.18-3.61a.5.5 0 0 1 .8.52l-2.83 10.23a2 2 0 0 1-1.95 1.46H6.89a2 2 0 0 1-1.95-1.46L2.1 6.07a.5.5 0 0 1 .78-.52l4.18 3.6a1 1 0 0 0 1.51-.29z"/></symbol>'
  + '<symbol id="i-smile" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></symbol>'
  + '<symbol id="i-lock" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></symbol>'
  + '<symbol id="i-id-card" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5.5 16c.5-1.2 1.4-2 2.5-2s2 .8 2.5 2"/><line x1="14" y1="10" x2="19" y2="10"/><line x1="14" y1="14" x2="17" y2="14"/></symbol>'
  + '<symbol id="i-list-checks" viewBox="0 0 24 24"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="m3 6 1 1 2-2"/><path d="m3 12 1 1 2-2"/><path d="m3 18 1 1 2-2"/></symbol>'
  + '<symbol id="i-smartphone" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></symbol>'
  + '<symbol id="i-check-circle" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></symbol>'
  + '<symbol id="i-alert" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></symbol>'
+ '<symbol id="i-plus" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></symbol>'
  + '<symbol id="i-edit" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></symbol>'
  + '<symbol id="i-x" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></symbol>'
  + '<symbol id="i-menu" viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></symbol>'
  + '<symbol id="i-home" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></symbol>'
  + '<symbol id="i-trophy" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></symbol>'
  + '<symbol id="i-mail" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></symbol>'
  + '<symbol id="i-phone" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></symbol>'
  + '<symbol id="i-share" viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></symbol>'
  + '<symbol id="i-save" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></symbol>'
  + '<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.05" y2="7.05"/><line x1="16.95" y1="16.95" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.05" y2="16.95"/><line x1="16.95" y1="7.05" x2="19.07" y2="4.93"/></symbol>'
  + '<symbol id="i-star" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></symbol>'
  + '<symbol id="i-lightbulb" viewBox="0 0 24 24"><path d="M15 14c.2-1 .7-1.7 1.5-2.5A7 7 0 0 0 4.5 11c0 3 3 3 3 3v2a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1.5"/><path d="M9 19h6"/><path d="M10 22h4"/></symbol>'
  + '<symbol id="i-camera" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></symbol>'
  + '<symbol id="i-flag" viewBox="0 0 24 24"><path d="M4 22V4"/><path d="M4 4h13l-2.5 4L17 12H4"/></symbol>'
  + '<symbol id="i-heart" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></symbol>'
  + '<symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></symbol>'
  + '<symbol id="i-briefcase" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></symbol>'
  + '<symbol id="i-sparkles" viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></symbol>'
  + '</svg>';

/** Injects the icon sprite into the document once (standalone pages). */
export function injectIconSprite() {
  if (document.getElementById('app-icon-sprite')) return;
  if (!document.getElementById('i-dashboard')) {
    document.body.insertAdjacentHTML('afterbegin', SPRITE_CHUNK_1 + SPRITE_CHUNK_2);
  }
}
const NAV_KEY_ATTRS = [
  'data-admin-page', 'data-student-page', 'data-teacher-page',
  'data-super-page', 'data-accountant-page', 'data-parent-page',
];

/**
 * Keyword map for headings / summaries / buttons whose emoji icon
 * was removed. Matched with INCLUDES on the trimmed lowercase text;
 * the array is sorted longest-first so precise phrases win.
 */
const PHRASE_ICONS = [
  ['update student', 'save'],
  ['summary view', 'chart'],
  ['daily view', 'calendar'],
  ['upload logo', 'camera'],
  ['multi-choice assessments', 'clipboard-check'],
  ['today\'s receipts & transactions', 'receipt'],
  ['today\'s receipts processed by you', 'clipboard'],
  ['income & expenditure tracking', 'trending-up'],
  ['holiday fee statements preview', 'sun'],
  ['fee summary by class', 'trending-up'],
  ['create staff with registration id', 'plus'],
  ['attendance management', 'clipboard'],
  ['exam results summary', 'file-text'],
  ['grading system', 'chart'],
  ['backup & restore', 'archive'],
  ['fees management', 'coins'],
  ['fee overview', 'coins'],
  ['fee structure', 'coins'],
  ['fee details', 'coins'],
  ['fees by class', 'chart'],
  ['payment distribution', 'pie-chart'],
  ['recent payments', 'clock'],
  ['student receipts', 'receipt'],
  ['payment receipt', 'receipt'],
  ['debtors list preview', 'print'],
  ['all students', 'users'],
  ['admit student', 'user-plus'],
  ['parents / guardians', 'parents'],
  ['school details', 'school'],
  ['save all changes', 'save'],
  ['save all scores', 'save'],
  ['record payment', 'save'],
  ['record new payment', 'save'],
  ['pay', 'coins'],
  ['preview receipts', 'eye'],
  ['download', 'download'],
  ['delete fee records', 'trash'],
  ['set fee', 'save'],
  ['save attendance', 'save'],
  ['save profile', 'save'],
  ['save changes', 'save'],
  ['admin dashboard', 'crown'],
  ['report card', 'file-text'],
  ['attendance records', 'clipboard'],
  ['my exam report cards', 'file-text'],
  ['generate staff id', 'key'],
  ['generate student id', 'key'],
  ['change password', 'key'],
  ['create backup', 'download'],
  ['download schema', 'download'],
  ['restore backup', 'upload'],
  ['sms monitoring', 'message-square'],
  ['add / edit subject', 'book-open'],
  ['add subject', 'plus'],
  ['add staff', 'plus'],
  ['add student', 'plus'],
  ['create new school', 'plus'],
  ['name locked', 'lock'],
  ['delete fee record', 'trash'],
  ['edit student', 'edit'],
  ['view report card', 'eye'],
  ['print results', 'printer'],
  ['print receipt', 'printer'],
  ['print debtors', 'printer'],
  ['print all', 'printer'],
  ['print / save pdf', 'printer'],
  ['print / save', 'printer'],
  ['print', 'printer'],
  ['export staff csv', 'download'],
  ['export', 'download'],
  ['import staff csv', 'upload'],
  ['import', 'upload'],
  ['refresh', 'refresh'],
  ['preview', 'eye'],
  ['search', 'search'],
  ['debtors', 'alert'],
  ['receipts', 'receipt'],
  ['accountants', 'receipt'],
  ['announcements', 'megaphone'],
  ['attendance', 'clipboard'],
  ['examinations', 'file-text'],
  ['income & expenses', 'trending-up'],
  ['student fees', 'users'],
  ['subjects', 'book-open'],
  ['classes', 'school'],
  ['schools', 'school'],
  ['students', 'users'],
  ['teachers', 'users'],
  ['staff', 'users'],
  ['parents', 'parents'],
  ['settings', 'settings'],
  ['dashboard', 'dashboard'],
  ['profile', 'user'],
  ['backup', 'archive'],
  ['fees', 'coins'],
  ['warning', 'alert'],
];

/** Longest first so specific phrases are matched before generic ones. */
PHRASE_ICONS.sort((a, b) => b[0].length - a[0].length);

function matcherFor(el) {
  const text = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [phrase, icon] of PHRASE_ICONS) {
    if (text.includes(phrase)) return icon;
  }
  return null;
}

/** Applies the keyword map to a single heading / summary / button. */
function iconizeTaggedNode(el) {
  if (el.dataset && el.dataset.appIcon) return;
  // Never double-iconize — headings re-rendered by modules may already
  // contain an icon (e.g. dashboard cards, page titles set via innerHTML).
  if (el.querySelector('.app-icon')) return;
  const icon = matcherFor(el);
  if (!icon) return;
  el.insertAdjacentHTML('afterbegin', svgIcon(icon));
  el.dataset.appIcon = '1';
}

let _iconTimer = null;
/**
 * Runs one full icon pass over the document. Safe to call repeatedly —
 * anything already carrying an icon is skipped, and the pass is
 * idempotent.
 */
export function injectAppIcons() {
  // ----- 1. Sidebar navigation links (all roles) -----
  document.querySelectorAll('.dash-nav-link').forEach((link) => {
    if (link.querySelector('.dash-nav-icon')) return;
    let key = null;
    for (const attr of NAV_KEY_ATTRS) {
      if (link.hasAttribute(attr)) { key = link.getAttribute(attr); break; }
    }
    if (!key && /logout/i.test(link.textContent || '')) key = 'logout';
    if (!key && /my ward|my child/i.test(link.textContent || '')) key = 'my-ward';
    const iconName = key === 'logout' ? 'logout' : NAV_ICONS[key];
    if (!iconName) return;
    link.insertAdjacentHTML('afterbegin', `<span class="dash-nav-icon">${svgIcon(iconName)}</span>`);
  });

  // ----- 2. Fixed icon containers -----
  document.querySelectorAll('.dash-welcome-icon').forEach((el) => {
    if (el.querySelector('.app-icon')) return;
    const dashboard = el.closest('[id^="page-"]')?.id || '';
    const icon = dashboard.includes('accountant') ? 'receipt' : 'smile';
    el.insertAdjacentHTML('afterbegin', svgIcon(icon));
  });

  document.querySelectorAll('.dash-avatar').forEach((el) => {
    if (el.querySelector('.app-icon') || el.querySelector('img') || el.childElementCount) return;
    const cls = el.closest('.dash-sidebar')?.getAttribute('class') || '';
    let icon = 'user';
    if (cls.includes('admin-brand')) icon = 'crown';
    else if (cls.includes('student-brand') || cls.includes('teacher-brand')) icon = 'graduation';
    else if (cls.includes('parent-brand')) icon = 'parents';
    else if (cls.includes('super-admin-brand')) icon = 'star';
    else if (cls.includes('accountant-brand')) icon = 'receipt';
    el.insertAdjacentHTML('afterbegin', svgIcon(icon));
  });

  document.querySelectorAll('.sidebar-logo-circle').forEach((el) => {
    if (el.querySelector('.app-icon') || el.querySelector('img') || el.childElementCount) return;
    const cls = el.closest('.dash-sidebar')?.getAttribute('class') || '';
    let icon = 'school';
    if (cls.includes('student-brand')) icon = 'graduation';
    else if (cls.includes('teacher-brand')) icon = 'book';
    else if (cls.includes('parent-brand')) icon = 'parents';
    else if (cls.includes('super-admin-brand')) icon = 'crown';
    else if (cls.includes('accountant-brand')) icon = 'receipt';
    el.insertAdjacentHTML('afterbegin', svgIcon(icon));
  });

  document.querySelectorAll('.home-glass-icon').forEach((el, i) => {
    if (el.querySelector('.app-icon')) return;
    const icon = i === 0 ? 'chart' : i === 1 ? 'lock' : 'smartphone';
    el.insertAdjacentHTML('afterbegin', svgIcon(icon));
  });

  const homeBadge = document.querySelector('.home-badge');
  if (homeBadge && !homeBadge.querySelector('.app-icon')) {
    homeBadge.insertAdjacentHTML('afterbegin', svgIcon('graduation'));
  }

  document.querySelectorAll('.home-feature-icon').forEach((el, i) => {
    if (el.querySelector('.app-icon')) return;
    const icons = ['lock', 'id-card', 'chart', 'clipboard', 'coins', 'file-text'];
    el.insertAdjacentHTML('afterbegin', svgIcon(icons[i] || 'sparkles'));
  });

  const deepSearch = document.querySelector('.deep-search-icon');
  if (deepSearch && !deepSearch.querySelector('.app-icon')) {
    deepSearch.insertAdjacentHTML('afterbegin', svgIcon('search'));
  }

  document.querySelectorAll('.school-banner-icon').forEach((el) => {
    if (el.querySelector('.app-icon') || el.querySelector('img')) return;
    el.insertAdjacentHTML('afterbegin', svgIcon('school'));
  });

  const loginLogo = document.querySelector('.login-logo-icon');
  if (loginLogo && !loginLogo.querySelector('.app-icon')) {
    loginLogo.insertAdjacentHTML('afterbegin', svgIcon('school'));
  }

  document.querySelectorAll('.login-input-icon').forEach((el, i) => {
    if (el.querySelector('.app-icon')) return;
    el.insertAdjacentHTML('afterbegin', svgIcon(i === 0 ? 'user' : 'lock'));
  });
// ----- 3. Placeholder circles (photos, seals) -----
  document.querySelectorAll('.dash-photo-placeholder, .rc-photo-placeholder, .dash-recent-photo-placeholder').forEach((el) => {
    if (el.querySelector('.app-icon')) return;
    el.insertAdjacentHTML('afterbegin', svgIcon('camera'));
  });

  document.querySelectorAll('.rc-seal').forEach((el) => {
    if (el.querySelector('.app-icon')) return;
    el.insertAdjacentHTML('afterbegin', svgIcon('graduation'));
  });

  // ----- 4. Dashboard overview stat cards (label → icon) -----
  document.querySelectorAll('.dash-overview-card').forEach((card) => {
    const iconEl = card.querySelector('.dash-overview-icon');
    const labelEl = card.querySelector('.dash-overview-label, .acc-stat-label, .acc-stat-title');
    if (!iconEl || iconEl.querySelector('.app-icon')) return;
    const label = (labelEl?.textContent || '').trim().toLowerCase();
    let icon = 'chart';
    if (label.includes('student')) icon = 'users';
    else if (label.includes('admitted')) icon = 'check-circle';
    else if (label.includes('pending') || label.includes('awaiting') || label.includes('portal confirm')) icon = 'clock';
    else if (label.includes('receipt')) icon = 'receipt';
    else if (label.includes('fee') || label.includes('amount') || label.includes('collect')) icon = 'coins';
    else if (label.includes('debt')) icon = 'alert';
    else if (label.includes('teacher') || label.includes('staff')) icon = 'users';
    else if (label.includes('class')) icon = 'school';
    else if (label.includes('exam')) icon = 'file-text';
    else if (label.includes('attendance')) icon = 'clipboard';
    iconEl.insertAdjacentHTML('afterbegin', svgIcon(icon));
  });

  // ----- 5. Headings, summaries & buttons (keyword map) -----
  document.querySelectorAll('h1, h2, h3, h4, summary').forEach((el) => {
    if (el.dataset && el.dataset.appIcon) return;
    iconizeTaggedNode(el);
  });
  document.querySelectorAll('.btn').forEach((el) => {
    if (el.dataset && el.dataset.appIcon) return;
    if (el.querySelector('.app-icon') || el.querySelector('.spinner')) return;
    iconizeTaggedNode(el);
  });

  // ----- 6. Accountant stat chips -----
  document.querySelectorAll('.acc-stat-icon').forEach((el) => {
    if (el.querySelector('.app-icon')) return;
    const cls = el.closest('[class*="acc-stat"]')?.getAttribute('class') || '';
    let icon = 'chart';
    if (/student/i.test(cls)) icon = 'users';
    else if (/fee/i.test(cls) || /amount/i.test(cls)) icon = 'coins';
    else if (/debt/i.test(cls)) icon = 'alert';
    else if (/receipt/i.test(cls)) icon = 'receipt';
    el.insertAdjacentHTML('afterbegin', svgIcon(icon));
  });

  // ----- 7. Icon-only buttons that lost their emoji glyph -----
  document.querySelectorAll('.btn-save-student').forEach((el) => {
    if (el.querySelector('.app-icon')) return;
    el.insertAdjacentHTML('afterbegin', svgIcon('save'));
  });
  document.querySelectorAll('button.action-btn').forEach((el) => {
    if (el.querySelector('.app-icon')) return;
    const txt = (el.textContent || '').trim();
    const onClick = el.getAttribute('onclick') || '';
    if (txt) return; // labelled action buttons are handled by the keyword pass
    if (/reprint|printreceipt/i.test(onClick)) {
      el.insertAdjacentHTML('afterbegin', svgIcon('printer'));
    }
  });

  // ----- 8. Standalone report page toggles -----
  document.querySelectorAll('#btnSummaryView, #btnDailyView').forEach((el) => {
    if (el.querySelector('.app-icon')) return;
    el.insertAdjacentHTML('afterbegin', svgIcon(el.id === 'btnSummaryView' ? 'chart' : 'calendar'));
  });
  const reportTypeEl = document.getElementById('reportType');
  if (reportTypeEl && !reportTypeEl.querySelector('.app-icon')) {
    const chartIcon = reportTypeEl.textContent || '';
    reportTypeEl.insertAdjacentHTML('afterbegin', svgIcon(/daily/i.test(chartIcon) ? 'calendar' : 'chart'));
  }
}

/** Starts a debounced MutationObserver that keeps icons applied. */
export function initIconInjector() {
  injectAppIcons();
  if (typeof MutationObserver === 'undefined') return;
  const observer = new MutationObserver(() => {
    if (_iconTimer) clearTimeout(_iconTimer);
    _iconTimer = setTimeout(injectAppIcons, 60);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}