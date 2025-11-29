document.addEventListener('DOMContentLoaded', async () => {
  async function inject(url, selector) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      const el = document.querySelector(selector);
      if (el) {
        // Insert HTML
        el.innerHTML = html;
        // Execute any scripts contained in the fetched HTML (innerHTML doesn't run them)
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          const scripts = tmp.querySelectorAll('script');
          scripts.forEach(s => {
            const newScript = document.createElement('script');
            if (s.src) {
              newScript.src = s.src;
              newScript.async = false;
            } else {
              newScript.textContent = s.textContent;
            }
            // Copy type if present
            if (s.type) newScript.type = s.type;
            document.body.appendChild(newScript);
            // Remove after execution to keep DOM clean
            setTimeout(() => newScript.remove(), 0);
          });
        } catch (e) { console.error('execute-injected-scripts failed', e); }
      }
    } catch (e) {
      console.error('include-partials failed', url, e);
    }
  }

  await inject('/public/partials/header.html', '#sidebar-placeholder');
  await inject('/public/partials/footer.html', '#footer-placeholder');
  // Global submit capture logger to trace which forms are submitted and what payload is sent
  try {
    document.addEventListener('submit', function(ev){
      try {
        const form = ev.target;
        const id = form && form.id ? form.id : '(no-id)';
        const data = new FormData(form);
        const obj = {};
        for (const [k,v] of data.entries()) obj[k] = v;
        console.debug('Submit capture: form=', id, 'action=', form.action || window.location.href, 'method=', form.method || 'GET', 'data=', obj);
      } catch (e) { console.error('submit-capture failed', e); }
    }, true); // capture phase
  } catch (e) { console.error('install submit capture failed', e); }
  // After injecting header, add data-view attributes to nav links if missing
  try {
    const nav = document.querySelector('.nav-menu');
    if (nav) {
      const mapping = {
        '/dashboard.html': 'dashboard',
        '/proxies.html': 'proxies',
        '/backends.html': 'backends',
        '/domains.html': 'domains',
        '/certificates.html': 'certificates',
        '/settings.html': 'settings'
      };
      nav.querySelectorAll('a.nav-item').forEach(a => {
        const href = a.getAttribute('href');
        if (href && mapping[href]) a.dataset.view = mapping[href];
      });
    }
    // highlight current link
    try {
      const path = window.location.pathname;
      if (nav) {
        nav.querySelectorAll('a.nav-item').forEach(a => {
          a.classList.remove('active');
          const href = a.getAttribute('href');
          if (href === path || (href === '/proxies.html' && path.startsWith('/proxies/'))) a.classList.add('active');
        });
      }
    } catch (e) { console.warn('nav active set failed', e); }
  } catch (e) { console.error('post-inject patch failed', e); }
  
});