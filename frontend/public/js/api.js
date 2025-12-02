// Lightweight API helpers attached to window to ease incremental migration
window.api = (function () {
  const loginPaths = new Set(['/login', '/login']);
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
      params.set('next', '/dashboard');
    }
    params.set('reason', reason);
    window.location.href = `/login?${params.toString()}`;
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

  // Helper methods for common HTTP verbs
  async function get(url, options = {}) {
    const res = await requestJson(url, { ...options, method: 'GET' });
    if (res.status >= 200 && res.status < 300) {
      return res.body;
    }
    throw new Error(res.body?.error || `HTTP ${res.status}`);
  }

  async function post(url, data, options = {}) {
    const res = await requestJson(url, { ...options, method: 'POST', body: data });
    if (res.status >= 200 && res.status < 300) {
      return res.body;
    }
    throw new Error(res.body?.error || `HTTP ${res.status}`);
  }

  async function put(url, data, options = {}) {
    const res = await requestJson(url, { ...options, method: 'PUT', body: data });
    if (res.status >= 200 && res.status < 300) {
      return res.body;
    }
    throw new Error(res.body?.error || `HTTP ${res.status}`);
  }

  async function del(url, options = {}) {
    const res = await requestJson(url, { ...options, method: 'DELETE' });
    if (res.status >= 200 && res.status < 300) {
      return res.body;
    }
    throw new Error(res.body?.error || `HTTP ${res.status}`);
  }

  return { 
    requestJson, 
    ensureAuthenticated, 
    redirectToLogin, 
    isNetworkError, 
    isLoginPage,
    get,
    post,
    put,
    delete: del
  };
})();
