// Lightweight API helpers attached to window to ease incremental migration
// Simple API helper for the new frontend
window.api = (function(){
  async function requestJson(url, opts = {}){
    const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    const fetchOpts = Object.assign({credentials:'same-origin', headers}, opts);
    if (fetchOpts.body && typeof fetchOpts.body !== 'string') fetchOpts.body = JSON.stringify(fetchOpts.body);
    const res = await fetch(url, fetchOpts);
    if (res.status === 401) return { status:401, body:null };
    if (res.status === 204) return { status:204, body:null };
    const text = await res.text();
    let body = null; try { body = text ? JSON.parse(text) : null } catch(e){ body = text }
    return { status: res.status, body };
  }
  return { requestJson };
})();
