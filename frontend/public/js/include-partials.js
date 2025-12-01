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

  await inject('/public/partials/header.html', '#sidebar-placeholder');
  await inject('/public/partials/footer.html', '#footer-placeholder');

  highlightActiveNav();
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
      const matchDetail = href === '/proxies.html' && /^\/proxies\//.test(path);
      if (view && (view === current || matchDetail)) link.classList.add('active');
      else link.classList.remove('active');
    });
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
