document.addEventListener('DOMContentLoaded', async () => {
  async function inject(url, selector) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      const el = document.querySelector(selector);
      if (el) {
        el.innerHTML = html;
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          const scripts = tmp.querySelectorAll('script');
          scripts.forEach((s) => {
            const newScript = document.createElement('script');
            if (s.src) {
              newScript.src = s.src;
              newScript.async = false;
            } else {
              newScript.textContent = s.textContent;
            }
            if (s.type) newScript.type = s.type;
            document.body.appendChild(newScript);
            setTimeout(() => newScript.remove(), 0);
          });
        } catch (e) {
          console.error('execute-injected-scripts failed', e);
        }
      }
    } catch (e) {
      console.error('include-partials failed', url, e);
    }
  }

  await inject('/public/partials/sidebar.html', '#sidebar-placeholder');
  await inject('/public/partials/header.html', '#header-placeholder');
  await inject('/public/partials/footer.html', '#footer-placeholder');

  highlightActiveNav();
  initNavGroups();
  enforceAuthGuard();
  
  // Dispatch event to signal that partials are loaded
  document.dispatchEvent(new CustomEvent('partials-loaded'));

  try {
    document.addEventListener('submit', function (ev) {
      try {
        const form = ev.target;
        const id = form && form.id ? form.id : '(no-id)';
        const data = new FormData(form);
        const obj = {};
        for (const [k, v] of data.entries()) obj[k] = v;
        console.debug('Submit capture:', id, obj);
      } catch (e) {
        console.error('submit-capture failed', e);
      }
    }, true);
  } catch (e) {
    console.error('install submit capture failed', e);
  }

  function highlightActiveNav() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    const current = document.body.dataset.page || '';
    const path = window.location.pathname;
    nav.querySelectorAll('a.nav-link').forEach((link) => {
      const view = link.dataset.view;
      const href = link.getAttribute('href') || '';
      const matchDetail = href === '/proxies' && /^\/proxies\//.test(path);
      if (view && (view === current || matchDetail)) link.classList.add('active');
      else link.classList.remove('active');
    });
  }

  function initNavGroups() {
    const navGroups = document.querySelectorAll('.nav-group');
    if (!navGroups.length) return;

    // Load saved expanded state from localStorage
    const savedState = JSON.parse(localStorage.getItem('navGroupsState') || '{}');

    // Find which group contains the active page
    const currentPage = document.body.dataset.page || '';
    let activeGroupName = null;

    navGroups.forEach(group => {
      const header = group.querySelector('.nav-group-header');
      const groupName = header?.dataset.group;
      if (!groupName) return;

      // Check if this group contains the active page
      const activeLink = group.querySelector('.nav-sublink.active');
      if (activeLink) {
        activeGroupName = groupName;
      }

      // Expand group if it was previously expanded or contains active page
      if (savedState[groupName] || activeLink) {
        group.classList.add('expanded');
      }

      // Add click handler
      header.addEventListener('click', (e) => {
        e.preventDefault();
        toggleNavGroup(group, groupName);
      });
    });
  }

  function toggleNavGroup(group, groupName) {
    const isExpanded = group.classList.contains('expanded');

    // Toggle the group
    group.classList.toggle('expanded');

    // Save state to localStorage
    const savedState = JSON.parse(localStorage.getItem('navGroupsState') || '{}');
    savedState[groupName] = !isExpanded;
    localStorage.setItem('navGroupsState', JSON.stringify(savedState));
  }

  function enforceAuthGuard() {
    if (!window.api || typeof window.api.ensureAuthenticated !== 'function') return;
    if (window.api.isLoginPage && window.api.isLoginPage()) return;
    try {
      window.api.ensureAuthenticated().catch(() => {});
    } catch (e) {
      console.warn('auth guard failed', e);
    }
  }
});
