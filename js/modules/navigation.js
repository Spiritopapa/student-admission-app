/**
 * Navigation Module - Page routing, sidebar, hamburger menu
 */

import { getEl } from './utils.js';
import { svgIcon } from './icons.js';

// ================================================================
// State
// ================================================================

const navLinks = document.querySelectorAll('.nav-links a[data-page]');
export const pages = document.querySelectorAll('.page');
const logoutBtn = getEl('logoutBtn');

// Hamburger menu
const hamburgerBtn = getEl('hamburgerBtn');
const mobileNav = getEl('navLinks');

// ================================================================
// Init Navigation
// ================================================================

export function initNavigation() {
  // Must run first: in WebView (APK) make every scroll instant so
  // navigation moves feel responsive instead of stuttering on the
  // expensive smooth-scroll animations.
  patchWebViewScroll();
  setupHamburgerMenu();
  setupNavLinkClicks();
  setupLogoutBtn();
  setupRoleTabs();
  setupSidebarDrawers();
  setupMobileModuleTapZoom();
  setupMobileNavCap();
  setupNavbarScroll();
  setupMobileBottomNav();
}

// ================================================================
// WebView Motion Patches
// `behavior: 'smooth'` scrolls are costly inside Android WebView and
// make navigation feel laggy. When the app is running wrapped in an
// APK (html has .webview-mode), force every programmatic scroll /
// scrollIntoView to instant so movement is always smooth and quick.
// Outside WebView the native smooth behavior is untouched.
// ================================================================

function patchWebViewScroll() {
  if (!document.documentElement || !document.documentElement.classList.contains('webview-mode')) return;
  try {
    const nativeScrollTo = window.scrollTo.bind(window);
    window.scrollTo = function (options) {
      if (typeof options === 'object' && options !== null) {
        options.behavior = 'auto';
      }
      return nativeScrollTo.apply(window, arguments);
    };

    const nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg) {
      if (typeof arg === 'object' && arg !== null) {
        arg.behavior = 'auto';
      }
      return nativeScrollIntoView.call(this, arg);
    };
  } catch (err) {
    // Never let the patch itself break navigation.
  }
}

// ================================================================
// Mobile Sidebar Drawer - iOS 26 Glassy Overlay
// ================================================================

function setupSidebarDrawers() {
  buildSidebarUI();

  // Open sidebar: clicking any .sidebar-toggle-btn
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.sidebar-toggle-btn');
    if (toggleBtn) {
      const dashboard = toggleBtn.closest('.dashboard-layout');
      openSidebarDrawer(dashboard);
    }
  });

  // Close buttons inside sidebar
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.sidebar-close-btn');
    if (closeBtn) {
      const dashboard = closeBtn.closest('.dashboard-layout');
      closeSidebarDrawer(dashboard);
    }
  });

  // Backdrop click closes
  document.addEventListener('click', (e) => {
    const backdrop = e.target.closest('.sidebar-backdrop');
    if (backdrop && backdrop.classList.contains('active')) {
      closeAllSidebarDrawers();
    }
  });

  // Escape key closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllSidebarDrawers();
  });

  // Close when a sidebar nav link is clicked
  document.addEventListener('click', (e) => {
    if (e.target.closest('.dash-sidebar .dash-nav-link')) {
      closeAllSidebarDrawers();
    }
  });

  // Handle swipe-to-close on the sidebar edge
  let touchStartX = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const swipeDistance = touchEndX - touchStartX;
    // Swipe left to close if open
    if (swipeDistance < -60) {
      closeAllSidebarDrawers();
    }
  }, { passive: true });
}

// ================================================================
// Mobile Two-Tap Module Selector
// Tap a sidebar module once to "zoom" it (preview highlight),
// then tap the SAME module again to actually open it. This avoids
// accidentally opening heavy modules with a single careless tap.
// ================================================================

const isMobileModuleTapZoom = window.matchMedia('(max-width: 768px)');

function setupMobileModuleTapZoom() {
  // Capture phase: for the FIRST tap we stop the event before it reaches the
  // module button's navigation handlers, so only the zoom effect happens.
  // The SECOND tap on the same module clears the zoom and lets the event
  // propagate normally (module opens + drawer closes).
  document.addEventListener('click', (e) => {
    if (!isMobileModuleTapZoom.matches) return;

    const link = e.target.closest('.dash-sidebar .dash-nav-link');
    // Ignore taps outside module tabs (e.g. the Logout action)
    if (!link || link.closest('.sidebar-logout')) return;

    // Second tap on the already-zoomed module -> allow it to open.
    if (link.classList.contains('tap-zoomed')) {
      clearMobileModuleZoom();
      return; // do NOT stop propagation: normal open flow continues
    }

    // First tap -> zoom preview instead of opening immediately.
    e.stopPropagation();
    e.preventDefault();
    clearMobileModuleZoom();
    link.classList.add('tap-zoomed');
  }, true);
}

function clearMobileModuleZoom() {
  document.querySelectorAll('.dash-sidebar .dash-nav-link.tap-zoomed').forEach((l) => {
    l.classList.remove('tap-zoomed');
  });
}

// ================================================================
// Mobile Module List Cap - only the modules scroll
// On mobile the sidebar drawer pins brand/profile/logout while the
// module list is the only scroll region. The list is capped so the
// first 15 modules are visible at a time and the rest scroll inside
// the nav. The cap is measured against the 15th module, so it stays
// exact regardless of font size, device or browser zoom.
// ================================================================

const MOBILE_MAX_MODULES = 15;
const mobileNavCapMatcher = window.matchMedia('(max-width: 768px)');
let mobileNavCapTimer = null;

function applyMobileNavModuleCap() {
  const navs = document.querySelectorAll('.dashboard-layout .dash-nav');
  if (!mobileNavCapMatcher.matches) {
    navs.forEach((nav) => { nav.style.maxHeight = ''; });
    return;
  }
  navs.forEach((nav) => {
    // Hidden pages (display:none) report zero rects - only measure a
    // dashboard that is actually mounted/active so the cap stays valid.
    const page = nav.closest('.page');
    if (page && !page.classList.contains('active-page')) return;
    const links = nav.querySelectorAll('.dash-nav-link');
    if (!links.length) return;
    const rows = Math.min(MOBILE_MAX_MODULES, links.length);
    const anchor = links[rows - 1];
    if (!anchor) return;
    const navRect = nav.getBoundingClientRect();
    if (!navRect.height) return;
    const anchorBottom = anchor.getBoundingClientRect().bottom;
    const padBottom = parseFloat(window.getComputedStyle(nav).paddingBottom) || 0;
    nav.style.maxHeight = `${(anchorBottom - navRect.top) + padBottom}px`;
  });
}

function scheduleMobileNavCap() {
  clearTimeout(mobileNavCapTimer);
  mobileNavCapTimer = setTimeout(applyMobileNavModuleCap, 120);
}

function setupMobileNavCap() {
  window.addEventListener('resize', scheduleMobileNavCap, { passive: true });
  window.addEventListener('orientationchange', scheduleMobileNavCap);
  window.addEventListener('pageshow', scheduleMobileNavCap);
  // Apply once now in case a dashboard is already the active page
  // (e.g. a restored auth session or WebView cached mount).
  applyMobileNavModuleCap();
}

// Build the toggle button, close button, and backdrop for each dashboard
function buildSidebarUI() {
  document.querySelectorAll('.dashboard-layout').forEach((dashboard) => {
    const sidebar = dashboard.querySelector('.dash-sidebar');
    const main = dashboard.querySelector('.dash-main');
    if (!sidebar || !main) return;

    // Create backdrop if not present
    if (!dashboard.querySelector('.sidebar-backdrop')) {
      const backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      dashboard.insertBefore(backdrop, sidebar.nextSibling);
    }

    // Create close button if not present
    if (!sidebar.querySelector('.sidebar-close-btn')) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'sidebar-close-btn';
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close navigation');
      closeBtn.innerHTML = '×';
      sidebar.prepend(closeBtn);
    }

    // Create a mobile header row with hamburger toggle if not present
    if (!main.querySelector('.sidebar-toggle-btn')) {
      const toggleRow = document.createElement('div');
      toggleRow.className = 'sidebar-mobile-header';
      toggleRow.innerHTML = `
        <button type="button" class="sidebar-toggle-btn" aria-label="Open navigation menu">☰</button>
      `;
      main.prepend(toggleRow);
    }
  });
}

function openSidebarDrawer(dashboard) {
  if (!dashboard) return;
  const sidebar = dashboard.querySelector('.dash-sidebar');
  const backdrop = dashboard.querySelector('.sidebar-backdrop');
  if (sidebar) sidebar.classList.add('mobile-sidebar-open');
  if (backdrop) backdrop.classList.add('active');
  /* Do NOT lock body/background scrolling here: the drawer is its own
     scroll region and the content area behind keeps scrolling independently. */
  clearMobileModuleZoom();
  applyMobileNavModuleCap();
}

function closeSidebarDrawer(dashboard) {
  if (!dashboard) return;
  const sidebar = dashboard.querySelector('.dash-sidebar');
  const backdrop = dashboard.querySelector('.sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('mobile-sidebar-open');
  if (backdrop) backdrop.classList.remove('active');
  clearMobileModuleZoom();
}

function closeAllSidebarDrawers() {
  document.querySelectorAll('.dash-sidebar.mobile-sidebar-open').forEach((s) => {
    s.classList.remove('mobile-sidebar-open');
  });
  document.querySelectorAll('.sidebar-backdrop.active').forEach((b) => {
    b.classList.remove('active');
  });
  clearMobileModuleZoom();
}

// ================================================================
// Hamburger Menu
// ================================================================

function setupHamburgerMenu() {
  // Build animated hamburger icon (3 bars) if not already present
  if (hamburgerBtn && !hamburgerBtn.querySelector('.hamburger-icon')) {
    hamburgerBtn.innerHTML = `
      <span class="hamburger-icon" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
    `;
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mobileNav.classList.toggle('mobile-open');
      hamburgerBtn.classList.toggle('mobile-open', mobileNav.classList.contains('mobile-open'));
    });
  }

  // Close mobile nav when a link is clicked
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
      if (mobileNav) mobileNav.classList.remove('mobile-open');
      if (hamburgerBtn) hamburgerBtn.classList.remove('mobile-open');
    });
  });

  // Close mobile nav when clicking outside
  document.addEventListener('click', (e) => {
    if (mobileNav && mobileNav.classList.contains('mobile-open')) {
      if (!e.target.closest('.navbar')) {
        mobileNav.classList.remove('mobile-open');
        if (hamburgerBtn) hamburgerBtn.classList.remove('mobile-open');
      }
    }
  });
}

// ================================================================
// Navbar Scroll Effect
// ================================================================

function setupNavbarScroll() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        navbar.classList.toggle('scrolled', window.scrollY > 10);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

// ================================================================
// Mobile Bottom Navigation Bar (App-like, collapsible, auth-aware)
// ================================================================

function setupMobileBottomNav() {
  // Only build on mobile viewport
  if (window.innerWidth > 768) return;

  // Don't build if already exists
  if (document.querySelector('.mobile-bottom-nav')) return;

  const bottomNav = document.createElement('nav');
  bottomNav.className = 'mobile-bottom-nav';
  bottomNav.setAttribute('aria-label', 'Mobile navigation');

  // Collapse toggle button (chevron) - always visible
  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'bottom-nav-collapse-btn';
  collapseBtn.setAttribute('aria-label', 'Collapse navigation');
  collapseBtn.innerHTML = '▾';
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBottomNavCollapse();
  });
  bottomNav.appendChild(collapseBtn);

  // Define bottom nav items - Sidebar (left), Home (middle), Logout (right)
  const items = [
    { label: 'Sidebar', action: 'sidebar', icon: 'menu' },
    { label: 'Home', action: 'home', icon: 'home' },
    { label: 'Logout', action: 'logout', icon: 'logout' }
  ];

  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-bottom-nav-item';
    btn.dataset.action = item.action;
    btn.innerHTML = `<span class="bottom-nav-icon">${svgIcon(item.icon)}</span><span class="bottom-nav-label">${item.label}</span>`;
    btn.addEventListener('click', () => {
      handleBottomNavAction(item.action);
    });
    bottomNav.appendChild(btn);
  });

  // Mobile admin module dock — icon-only category launcher (replaces the
  // generic items while an admin / sub-admin is signed in).
  buildAdminModuleDock(bottomNav);

  document.body.appendChild(bottomNav);
  document.body.classList.add('has-bottom-nav');

  // Update active state based on current page
  const updateBottomNavActive = (pageId) => {
    if (adminDockModeActive) {
      // Admin dock: keep the active category pill in sync with the module
      // currently open in the sidebar (dashboard home → Home chip).
      syncAdminDockCategory();
      return;
    }
    bottomNav.querySelectorAll('.mobile-bottom-nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.action === 'home' && isDashboardPage(pageId));
    });
  };

  // Expose for showPage to call
  window.__updateBottomNavActive = updateBottomNavActive;

  // Set initial active state
  const currentPage = document.querySelector('.page.active-page');
  if (currentPage) {
    const pageId = currentPage.id.replace('page-', '');
    updateBottomNavActive(pageId);
  }

  // Hide by default until login
  setBottomNavVisible(false);
}
// ================================================================
// Admin Module Dock — mobile category launcher (icon-only)
// Re-categorises the admin modules into four groups (home, academic,
// finance, others) shown as modern icon chips on the fixed bottom dock.
// Tapping a category slides a glassy sheet of module icons up above the
// dock with a spring transition; tapping a module opens it through the
// real sidebar button so module locks, active states and page loading
// stay perfectly in sync with the desktop sidebar.
// ================================================================

const ADMIN_MODULE_CATEGORIES = [
  {
    key: 'home', label: 'Home', icon: 'home',
    modules: [
      { page: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { page: 'admit', label: 'Admit Student', icon: 'user-plus' },
      { action: 'logout', label: 'Log Out', icon: 'logout' },
    ],
  },
  {
    key: 'academic', label: 'Academic', icon: 'book',
    modules: [
      { page: 'students', label: 'Students', icon: 'users' },
      { page: 'classes', label: 'Class', icon: 'school' },
      { page: 'subjects', label: 'Subjects', icon: 'book-open' },
      { page: 'exams', label: 'Exams', icon: 'file-text' },
      { page: 'assessments', label: 'Assessment', icon: 'clipboard-check' },
      { page: 'announcements', label: 'Announcement', icon: 'megaphone' },
      { page: 'teachers', label: 'Add Staff', icon: 'users' },
      { page: 'accountants', label: 'Add Accountant', icon: 'receipt' },
      { page: 'parents', label: 'Parent', icon: 'parents' },
      { page: 'grading', label: 'Grading System', icon: 'chart' },
    ],
  },
  {
    key: 'finance', label: 'Finance', icon: 'coins',
    modules: [
      { page: 'fees', label: 'Fees Management', icon: 'coins' },
      { page: 'transport', label: 'Transport', icon: 'bus' },
      { page: 'income-expenses', label: 'Income & Expenditure', icon: 'trending-up' },
    ],
  },
  {
    key: 'others', label: 'Others', icon: 'menu',
    modules: [
      { page: 'sms-monitoring', label: 'SMS Monitoring', icon: 'message-square' },
      { page: 'settings', label: 'Settings', icon: 'settings' },
      { page: 'profile', label: 'Change Password', icon: 'key' },
    ],
  },
];

let adminDockModeActive = false;
let adminDockOpenCategory = null;
/** Builds the icon-only category dock, the slide-up sheet and its backdrop. */
function buildAdminModuleDock(bottomNav) {
  ADMIN_MODULE_CATEGORIES.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-admin-dock-item';
    btn.dataset.dockCategory = cat.key;
    btn.setAttribute('aria-label', `${cat.label} menu`);
    btn.setAttribute('title', cat.label);
    btn.innerHTML = `<span class="bottom-nav-icon">${svgIcon(cat.icon)}</span><span class="admin-dock-item-label">${cat.label}</span>`;
    // Open the sheet on the FIRST tap. Some mobile browsers / the Android
    // WebView consume the synthesized `click` (tap-highlight, focus,
    // double-tap detection), which made the chips feel like they needed two
    // taps. Opening on pointerdown responds instantly; calling preventDefault
    // also suppresses the follow-up `click` so the same tap cannot immediately
    // toggle the sheet closed again.
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.dataset.dockTapHandled = '1';
      toggleAdminDockCategory(cat.key);
    });
    // Keyboard activation (Enter/Space) has no pointerdown — open on click.
    // The guard swallows a stray click on browsers that still fire one after
    // a pointerdown that already opened the sheet.
    btn.addEventListener('click', () => {
      if (btn.dataset.dockTapHandled === '1') {
        delete btn.dataset.dockTapHandled;
        return;
      }
      toggleAdminDockCategory(cat.key);
    });
    btn.addEventListener('pointercancel', () => { delete btn.dataset.dockTapHandled; });
    btn.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') delete btn.dataset.dockTapHandled;
    });
    bottomNav.appendChild(btn);
  });

  const sheet = document.createElement('div');
  sheet.className = 'mobile-admin-dock-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Admin modules menu');
  sheet.innerHTML =
    '<div class="admin-dock-sheet-header">' +
      '<span class="admin-dock-sheet-title" id="adminDockSheetTitle"></span>' +
      '<button type="button" class="admin-dock-sheet-close" aria-label="Close menu">' + svgIcon('x') + '</button>' +
    '</div>' +
    '<div class="admin-dock-sheet-grid" id="adminDockSheetGrid"></div>';
  sheet.querySelector('.admin-dock-sheet-close').addEventListener('click', closeAdminDockSheet);
  sheet.querySelector('.admin-dock-sheet-grid').addEventListener('click', handleAdminDockModuleClick);
  document.body.appendChild(sheet);
  window.__adminDockSheet = sheet;

  const backdrop = document.createElement('div');
  backdrop.className = 'admin-dock-backdrop';
  backdrop.addEventListener('click', closeAdminDockSheet);
  document.body.appendChild(backdrop);
  window.__adminDockBackdrop = backdrop;

  positionAdminDockSheet();
}

/** Anchors the sheet just above the dock and keeps it off-screen when closed. */
function positionAdminDockSheet() {
  const sheet = window.__adminDockSheet;
  const bottomNav = document.querySelector('.mobile-bottom-nav');
  if (!sheet || !bottomNav) return;
  const off = bottomNav.offsetHeight;
  sheet.style.bottom = `${off}px`;
  sheet.style.setProperty('--dock-hide-offset', `${off}px`);
}

function toggleAdminDockCategory(key) {
  const sheet = window.__adminDockSheet;
  if (!sheet) return;
  if (sheet.classList.contains('open') && adminDockOpenCategory === key) {
    closeAdminDockSheet();
    return;
  }
  renderAdminDockSheet(key);
  adminDockOpenCategory = key;
  positionAdminDockSheet();
  sheet.classList.add('open');
  if (window.__adminDockBackdrop) window.__adminDockBackdrop.classList.add('active');
  syncAdminDockCategory();
}

function closeAdminDockSheet() {
  const sheet = window.__adminDockSheet;
  if (sheet) sheet.classList.remove('open');
  if (window.__adminDockBackdrop) window.__adminDockBackdrop.classList.remove('active');
  adminDockOpenCategory = null;
}

/** Fills the sheet with the category's module icon buttons (staggered pop-in). */
function renderAdminDockSheet(key) {
  const cat = ADMIN_MODULE_CATEGORIES.find((c) => c.key === key);
  const sheet = window.__adminDockSheet;
  if (!cat || !sheet) return;
  const titleEl = sheet.querySelector('.admin-dock-sheet-title');
  const grid = sheet.querySelector('.admin-dock-sheet-grid');
  if (titleEl) titleEl.innerHTML = `${svgIcon(cat.icon)}${cat.label}`;

  const visible = cat.modules.filter((mod) => {
    if (mod.action) return true;
    const sidebarBtn = document.querySelector(`#adminSidebar .dash-nav-link[data-admin-page="${mod.page}"]`);
    return !sidebarBtn || sidebarBtn.style.display !== 'none';
  });

  if (!visible.length) {
    grid.innerHTML = `<div class="admin-dock-sheet-empty">All ${cat.label.toLowerCase()} modules are locked.</div>`;
    return;
  }

  grid.innerHTML = visible.map((mod, i) => {
    const pageAttr = mod.page ? ` data-admin-page="${mod.page}"` : '';
    const actionAttr = mod.action ? ` data-dock-action="${mod.action}"` : '';
    const delay = Math.min(i * 42, 380);
    return (
      `<button type="button" class="admin-dock-module"${pageAttr}${actionAttr} style="animation-delay:${delay}ms">` +
        `<span class="admin-dock-module-icon">${svgIcon(mod.icon)}</span>` +
        `<span class="admin-dock-module-label">${mod.label}</span>` +
      `</button>`
    );
  }).join('');
}
/** Clicking a module chip opens the module (or logs out) on the FIRST tap. */
function handleAdminDockModuleClick(e) {
  const btn = e.target.closest('.admin-dock-module');
  if (!btn) return;
  e.preventDefault();
  const action = btn.getAttribute('data-dock-action');
  const page = btn.getAttribute('data-admin-page');
  if (action === 'logout') {
    closeAdminDockSheet();
    if (typeof window.handleLogout === 'function') {
      window.handleLogout();
    } else {
      import('./auth.js').then((m) => { if (m.handleLogout) m.handleLogout(); });
    }
    return;
  }
  if (!page) return;
  openAdminModuleFromDock(page);
}

/**
 * Opens an admin module straight from the dock.
 *
 * We deliberately do NOT simulate a click on the sidebar button here: the
 * sidebar drawer's "two-tap module selector" intercepts the FIRST synthetic
 * click (capture phase) to show a zoom preview, so tapping a module icon
 * felt like it needed two taps. Calling loadAdminSubPage directly opens the
 * module on the very first tap while keeping the same sidebar highlight,
 * lock checks and page loading as the sidebar button.
 */
function openAdminModuleFromDock(page) {
  closeAdminDockSheet();
  // Drop any leftover "tap-zoom" preview so drawer taps stay normal.
  clearMobileModuleZoom();
  // Mirror what the sidebar button click does: highlight it first.
  const dashBtn = document.querySelector(`#adminSidebar .dash-nav-link[data-admin-page="${page}"]`);
  if (dashBtn) {
    document.querySelectorAll('#adminSidebar .dash-nav-link').forEach((b) => b.classList.remove('active'));
    dashBtn.classList.add('active');
  }
  if (typeof window.loadAdminSubPage === 'function') {
    window.loadAdminSubPage(page);
  }
  syncAdminDockCategory();
}

/** Highlights the dock category that contains the currently active admin module. */
function syncAdminDockCategory() {
  if (!adminDockModeActive) return;
  const activeSidebarBtn = document.querySelector('#adminSidebar .dash-nav-link.active[data-admin-page]');
  const activePage = activeSidebarBtn ? activeSidebarBtn.getAttribute('data-admin-page') : 'dashboard';
  let key = 'home';
  if (activePage && activePage !== 'dashboard') {
    const cat = ADMIN_MODULE_CATEGORIES.find((c) => c.modules.some((mod) => mod.page === activePage));
    if (cat) key = cat.key;
  }
  document.querySelectorAll('.mobile-admin-dock-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.dockCategory === key);
  });
}

/** Hides dock chips whose module is locked in the real sidebar. */
function refreshAdminDockLocks() {
  document.querySelectorAll('.admin-dock-module[data-admin-page]').forEach((btn) => {
    const page = btn.getAttribute('data-admin-page');
    const sidebarBtn = document.querySelector(`#adminSidebar .dash-nav-link[data-admin-page="${page}"]`);
    btn.classList.toggle('is-locked', !!sidebarBtn && sidebarBtn.style.display === 'none');
  });
  if (adminDockOpenCategory) renderAdminDockSheet(adminDockOpenCategory);
}

/** Switches the bottom dock between the generic items and the admin category dock. */
function setAdminDockMode(isAdmin) {
  const bottomNav = document.querySelector('.mobile-bottom-nav');
  adminDockModeActive = !!isAdmin;
  if (!bottomNav) return;
  bottomNav.classList.toggle('admin-dock-mode', adminDockModeActive);
  if (!adminDockModeActive) {
    closeAdminDockSheet();
    document.querySelectorAll('.mobile-admin-dock-item').forEach((item) => item.classList.remove('active'));
  } else {
    syncAdminDockCategory();
  }
}

// Exposed so auth.js can flip the dock after login/logout, app.js can sync
// locked modules, and sidebar navigation can keep the active category in sync.
window.__setAdminDockActive = setAdminDockMode;
window.__refreshAdminDock = refreshAdminDockLocks;
window.__syncAdminDockCategory = syncAdminDockCategory;

/**
 * Toggle the bottom nav between expanded and collapsed states.
 * When collapsed, only the chevron button remains visible.
 */
function toggleBottomNavCollapse() {
  const bottomNav = document.querySelector('.mobile-bottom-nav');
  if (!bottomNav) return;
  const isCollapsed = bottomNav.classList.toggle('collapsed');
  document.body.classList.toggle('bottom-nav-collapsed', isCollapsed);
  // If the admin sheet is open, tuck it away with the dock.
  if (isCollapsed) closeAdminDockSheet();
  const collapseBtn = bottomNav.querySelector('.bottom-nav-collapse-btn');
  if (collapseBtn) {
    collapseBtn.innerHTML = isCollapsed ? '▴' : '▾';
    collapseBtn.setAttribute('aria-label', isCollapsed ? 'Expand navigation' : 'Collapse navigation');
  }
  // Persist collapse state
  try {
    localStorage.setItem('_bottomNavCollapsed', isCollapsed ? '1' : '0');
  } catch (e) { /* ignore */ }
}

/**
 * Show or hide the mobile bottom nav based on auth state.
 * @param {boolean} isLoggedIn - Whether the user is authenticated
 */
function setBottomNavVisible(isLoggedIn) {
  const bottomNav = document.querySelector('.mobile-bottom-nav');
  if (!bottomNav) return;
  if (isLoggedIn) {
    bottomNav.classList.add('visible');
    document.body.classList.add('has-bottom-nav');
    // Restore collapsed state from localStorage
    try {
      const collapsed = localStorage.getItem('_bottomNavCollapsed') === '1';
      if (collapsed) {
        bottomNav.classList.add('collapsed');
        document.body.classList.add('bottom-nav-collapsed');
        const collapseBtn = bottomNav.querySelector('.bottom-nav-collapse-btn');
        if (collapseBtn) collapseBtn.innerHTML = '▴';
      } else {
        bottomNav.classList.remove('collapsed');
        document.body.classList.remove('bottom-nav-collapsed');
        const collapseBtn = bottomNav.querySelector('.bottom-nav-collapse-btn');
        if (collapseBtn) collapseBtn.innerHTML = '▾';
      }
    } catch (e) { /* ignore */ }
  } else {
    bottomNav.classList.remove('visible', 'collapsed');
    document.body.classList.remove('has-bottom-nav', 'bottom-nav-collapsed');
    const collapseBtn = bottomNav.querySelector('.bottom-nav-collapse-btn');
    if (collapseBtn) collapseBtn.innerHTML = '▾';
  }
}

// Expose for auth module to call on login/logout
window.__setBottomNavVisible = setBottomNavVisible;
window.__toggleBottomNavCollapse = toggleBottomNavCollapse;

/**
 * Handle mobile bottom nav button actions.
 * - home: Navigate to the user's dashboard based on their role
 * - logout: Sign out the current user
 * - sidebar: Open the sidebar drawer for the active dashboard
 */
async function handleBottomNavAction(action) {
  if (action === 'home') {
    // Determine user's role and navigate to their dashboard
    try {
      const supabase = window.supabaseClient;
      if (!supabase) { showPage('home'); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { showPage('home'); return; }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
      const role = profile?.role || 'student';
      const dashboardMap = {
        super_admin: 'super-admin-dashboard',
        admin: 'admin-dashboard',
        sub_admin: 'admin-dashboard',
        student: 'student-dashboard',
        parent: 'parent-dashboard',
        teacher: 'teacher-dashboard',
        accountant: 'accountant-dashboard'
      };
      const targetPage = dashboardMap[role] || 'home';
      showPage(targetPage);
      // Trigger dashboard data load using dynamic imports
      if (role === 'admin' || role === 'sub_admin') {
        if (window.loadAdminDashboard) {
          window.loadAdminDashboard();
        } else {
          const { loadAdminDashboardHome } = await import('./admin-dashboard.js');
          await loadAdminDashboardHome();
        }
      } else if (role === 'super_admin') {
        const { loadSuperAdminDashboard } = await import('./super-admin.js');
        await loadSuperAdminDashboard();
      } else if (role === 'student') {
        const { loadStudentDashboard } = await import('./student-dashboard.js');
        await loadStudentDashboard(session.user);
      } else if (role === 'parent') {
        const { loadParentDashboard } = await import('./parent-dashboard.js');
        await loadParentDashboard(session.user);
      } else if (role === 'teacher') {
        const { loadTeacherDashboard } = await import('./teacher-dashboard.js');
        await loadTeacherDashboard(session.user);
      } else if (role === 'accountant') {
        const { loadAccountantDashboard } = await import('./accountant-dashboard.js');
        await loadAccountantDashboard();
      }
    } catch (err) {
      console.error('Bottom nav home error:', err);
      showPage('home');
    }
  } else if (action === 'logout') {
    // Call the logout handler from auth module
    const { handleLogout: authLogout } = await import('./auth.js');
    authLogout();
  } else if (action === 'sidebar') {
    // Open the sidebar drawer for the active dashboard
    const activePage = document.querySelector('.page.active-page');
    const activeDashboard = activePage?.querySelector('.dashboard-layout') || document.querySelector('.dashboard-layout');
    if (activeDashboard) {
      const sidebar = activeDashboard.querySelector('.dash-sidebar');
      const backdrop = activeDashboard.querySelector('.sidebar-backdrop');
      if (sidebar) sidebar.classList.add('mobile-sidebar-open');
      if (backdrop) backdrop.classList.add('active');
      /* Background content keeps its own independent scroll behind the drawer. */
      applyMobileNavModuleCap();
    }
  }
}

/**
 * Check if a page ID corresponds to a dashboard page.
 */
function isDashboardPage(pageId) {
  return ['super-admin-dashboard', 'admin-dashboard', 'student-dashboard', 'parent-dashboard', 'teacher-dashboard', 'accountant-dashboard'].includes(pageId);
}

// ================================================================
// Show Page
// ================================================================

export function showPage(pageId) {
  pages.forEach((p) => p.classList.remove('active-page'));
  const target = getEl(`page-${pageId}`);
  if (target) target.classList.add('active-page');
  navLinks.forEach((link) => link.classList.remove('active'));
  const activeLink = document.querySelector(`.nav-links a[data-page="${pageId}"]`);
  if (activeLink) activeLink.classList.add('active');
  // Sync mobile bottom nav active state
  if (window.__updateBottomNavActive) {
    window.__updateBottomNavActive(pageId);
  }
  // Admin dashboard shell: admin module pages are nested inside
  // #page-admin-dashboard, so keep the shell (sticky sidebar) visible
  // whenever the user returns to the dashboard or opens a module page.
  if (pageId === 'admin-dashboard') {
    const homeContent = getEl('adminDashboardContent');
    if (homeContent) homeContent.style.display = '';
    const dashHeader = getEl('adminDashHeader');
    if (dashHeader) dashHeader.style.display = '';
    const dashBtn = document.querySelector('#adminSidebar .dash-nav-link[data-admin-page="dashboard"]');
    if (dashBtn) {
      document.querySelectorAll('#adminSidebar .dash-nav-link').forEach((b) => b.classList.remove('active'));
      dashBtn.classList.add('active');
    }
    document.querySelectorAll('#page-admin-dashboard .admin-module-panel').forEach((p) => p.classList.remove('active-page'));
  } else if (
    pageId.startsWith('admin-') &&
    target &&
    target.id !== 'page-admin-dashboard' &&
    target.closest('#page-admin-dashboard') &&
    typeof window.loadAdminSubPage === 'function'
  ) {
    const shell = getEl('page-admin-dashboard');
    if (shell) shell.classList.add('active-page');
    window.loadAdminSubPage(pageId.replace('admin-', ''));
  }
  // Instant top-of-page on navigation: avoids a long smooth-scroll
  // animation that makes page-switching feel slow (especially in WebView).
  try { window.scrollTo(0, 0); } catch (e) { window.scrollTo({ top: 0 }); }
}

// ================================================================
// Nav Link Clicks
// ================================================================

function setupNavLinkClicks() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-page]');
    if (link) {
      e.preventDefault();
      const page = link.getAttribute('data-page');
      // If the Home link is clicked and the user is logged in,
      // redirect them to their role-based dashboard instead of the landing page.
      if (page === 'home') {
        navigateHome();
      } else {
        showPage(page);
      }
    }
  });
}

/**
 * Navigate to the user's dashboard based on their role.
 * If not logged in, show the home landing page.
 */
async function navigateHome() {
  try {
    const supabase = window.supabaseClient;
    if (!supabase) { showPage('home'); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { showPage('home'); return; }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    const role = profile?.role || 'student';
    const dashboardMap = {
      super_admin: 'super-admin-dashboard',
      admin: 'admin-dashboard',
      sub_admin: 'admin-dashboard',
      student: 'student-dashboard',
      parent: 'parent-dashboard',
      teacher: 'teacher-dashboard',
      accountant: 'accountant-dashboard'
    };
    const targetPage = dashboardMap[role] || 'home';
    showPage(targetPage);
    // Trigger dashboard data load using dynamic imports
    if (role === 'admin' || role === 'sub_admin') {
      if (window.loadAdminDashboard) {
        window.loadAdminDashboard();
      } else {
        const { loadAdminDashboardHome } = await import('./admin-dashboard.js');
        await loadAdminDashboardHome();
      }
    } else if (role === 'super_admin') {
      const { loadSuperAdminDashboard } = await import('./super-admin.js');
      await loadSuperAdminDashboard();
    } else if (role === 'student') {
      const { loadStudentDashboard } = await import('./student-dashboard.js');
      await loadStudentDashboard(session.user);
    } else if (role === 'parent') {
      const { loadParentDashboard } = await import('./parent-dashboard.js');
      await loadParentDashboard(session.user);
    } else if (role === 'teacher') {
      const { loadTeacherDashboard } = await import('./teacher-dashboard.js');
      await loadTeacherDashboard(session.user);
    } else if (role === 'accountant') {
      const { loadAccountantDashboard } = await import('./accountant-dashboard.js');
      await loadAccountantDashboard();
    }
  } catch (err) {
    console.error('Home navigation error:', err);
    showPage('home');
  }
}

// ================================================================
// Logout Button
// ================================================================

function setupLogoutBtn() {
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });
  }
}

// Dynamic import to avoid circular dependency
async function handleLogout() {
  const { handleLogout: authLogout } = await import('./auth.js');
  authLogout();
}

// ================================================================
// Role Tab Switching (Register)
// ================================================================

function setupRoleTabs() {
  document.querySelectorAll('.role-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.role-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.register-form').forEach((f) => f.classList.remove('active-form'));
      const role = tab.getAttribute('data-role');
      const forms = { super_admin: 'registerSuperAdminForm', school: 'registerSchoolForm', sub_admin: 'registerSubAdminForm', teacher: 'registerTeacherForm', student: 'registerStudentForm', parent: 'registerParentForm', accountant: 'registerAccountantForm' };
      const target = getEl(forms[role]);
      if (target) target.classList.add('active-form');
    });
  });
}