// Lightweight API helpers attached to window to ease incremental migration
window.api = (function () {
  const loginPaths = new Set(['/login', '/login.html']);
  let authChecked = false;

  function isLoginPage() {
    try {
      const path = window.location.pathname.toLowerCase();
      return loginPaths.has(path);
    } catch (e) {
      return false;
    }
  }

  function redirectToLogin(reason = 'session') {
    if (isLoginPage()) return;
    const params = new URLSearchParams();
    try {
      const next = window.location.pathname + window.location.search;
      params.set('next', next);
    } catch (e) {
      params.set('next', '/dashboard.html');
    }
    params.set('reason', reason);
    window.location.href = `/login.html?${params.toString()}`;
  }

  async function requestJson(url, opts = {}) {
    const options = Object.assign({}, opts);
    const skipAuthRedirect = !!options.skipAuthRedirect;
    delete options.skipAuthRedirect;

    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const fetchOpts = Object.assign({ credentials: 'same-origin', method: 'GET' }, options, { headers });
    if (fetchOpts.body && typeof fetchOpts.body !== 'string') {
      fetchOpts.body = JSON.stringify(fetchOpts.body);
    }

    const res = await fetch(url, fetchOpts);
    const status = res.status;
    if (status === 401) {
      if (!skipAuthRedirect && !isLoginPage()) redirectToLogin('session');
      return { status, body: null };
    }
    if (status === 204) return { status, body: null };

    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }

    if (status === 403 && !skipAuthRedirect && !isLoginPage()) {
      redirectToLogin('forbidden');
    }
    return { status, body };
  }

  async function ensureAuthenticated(force = false) {
    if (isLoginPage()) return false;
    if (authChecked && !force) return true;
    const res = await requestJson('/profile', { headers: { Accept: 'application/json' } });
    if (res && res.status === 200) {
      authChecked = true;
      return true;
    }
    return false;
  }

  function isNetworkError(err) {
    if (!err) return false;
    const message = err.message || '';
    return err.name === 'TypeError' && /network|fetch/i.test(message);
  }

  return { requestJson, ensureAuthenticated, redirectToLogin, isNetworkError, isLoginPage };
})();
