/**
 * Navigation Module - Page routing, sidebar, hamburger menu
 */

import { getEl } from './utils.js';

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

  // Define bottom nav items - Home (dashboard), Logout, Sidebar
  const items = [
    { label: 'Home', action: 'home' },
    { label: 'Logout', action: 'logout' },
    { label: 'Sidebar', action: 'sidebar' }
  ];

  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-bottom-nav-item';
    btn.dataset.action = item.action;
    btn.innerHTML = `<span class="bottom-nav-label">${item.label}</span>`;
    btn.addEventListener('click', () => {
      handleBottomNavAction(item.action);
    });
    bottomNav.appendChild(btn);
  });

  document.body.appendChild(bottomNav);
  document.body.classList.add('has-bottom-nav');

  // Update active state based on current page
  const updateBottomNavActive = (pageId) => {
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

/**
 * Toggle the bottom nav between expanded and collapsed states.
 * When collapsed, only the chevron button remains visible.
 */
function toggleBottomNavCollapse() {
  const bottomNav = document.querySelector('.mobile-bottom-nav');
  if (!bottomNav) return;
  const isCollapsed = bottomNav.classList.toggle('collapsed');
  document.body.classList.toggle('bottom-nav-collapsed', isCollapsed);
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