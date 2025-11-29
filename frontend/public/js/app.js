// Minimal SPA app glue for Nebula (new frontend)
(function(){
  async function loadProxies(){
    const out = await window.api.requestJson('/api/proxies');
    const tbody = document.querySelector('#proxiesTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!out || out.status!==200){ tbody.innerHTML = '<tr><td colspan="4" class="muted">Failed to load</td></tr>'; return }
    const rows = out.body || [];
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="muted">No proxies</td></tr>'; return }
    for (const p of rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><a href='/proxies/${p.id}'>${escapeHtml(p.name)}</a></td><td>${escapeHtml(p.listen_host)}:${p.listen_port}</td><td>${escapeHtml(p.target_host)}:${p.target_port}</td><td>${p.enabled?'<span class="muted">Active</span>':'<span class="muted">Disabled</span>'}</td><td><button data-id="${p.id}" class="btn small edit-proxy">Edit</button></td>`;
      tbody.appendChild(tr);
    }
  }

  async function createProxyFromForm(ev){
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    const payload = {};
    for (const [k,v] of data.entries()) payload[k] = v;
    try {
      const res = await window.api.requestJson('/api/proxies', { method:'POST', body: payload });
      if (!res || (res.status!==200 && res.status!==201)) return alert('Create failed: '+(res && res.status));
      alert('Proxy created');
      form.reset();
      await loadProxies();
    } catch (e) { console.error(e); alert('Create failed'); }
  }

  async function initProxiesPage(){
    // wire save/delete for inline editor if present
    try { await loadProxies(); } catch(e){ console.error(e) }
    // wire create form
    const createForm = document.getElementById('createProxyForm');
    if (createForm) createForm.addEventListener('submit', createProxyFromForm);
    // delegate edit buttons
    document.addEventListener('click', (ev)=>{
      const btn = ev.target.closest && ev.target.closest('.edit-proxy');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) return;
      location.href = `/proxies/${id}`;
    });
  }

  async function initProxyDetail(){
    // parse id
    const m = location.pathname.match(/\/proxies\/(\d+)/);
    if (!m) return;
    const id = m[1];
    const out = await window.api.requestJson('/api/proxies');
    if (!out || out.status!==200) return;
    const p = (out.body||[]).find(x=>String(x.id)===String(id));
    if (!p) return;
    document.getElementById('editProxyName').value = p.name || '';
    document.getElementById('editProxyListenHost').value = p.listen_host || '';
    document.getElementById('editProxyListenPort').value = p.listen_port || '';
    document.getElementById('editProxyProtocol').value = p.protocol || 'tcp';
    document.getElementById('btnSaveProxy').addEventListener('click', async ()=>{
      // submit via form
      const form = document.getElementById('editProxyForm');
      const data = new FormData(form);
      const payload = {};
      for (const [k,v] of data.entries()) payload[k] = v;
      const res = await window.api.requestJson(`/api/proxies/${id}`, { method:'PUT', body: payload });
      if (res && res.status===200) { alert('Saved'); location.href = '/proxies.html'; } else alert('Save failed');
    });
    // delete
    const del = document.getElementById('btnDeleteProxy');
    if (del) del.addEventListener('click', async ()=>{
      if (!confirm('Delete this proxy?')) return;
      const res = await window.api.requestJson(`/api/proxies/${id}`, { method:'DELETE' });
      if (res && (res.status===204 || res.status===200)) { alert('Deleted'); location.href = '/proxies.html'; } else alert('Delete failed');
    });
  }

  function escapeHtml(s){ if (s===undefined||s===null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // on DOM ready, dispatch by pathname or element presence
  document.addEventListener('DOMContentLoaded', ()=>{
    if (location.pathname.match(/^\/proxies\/\d+$/)) { initProxyDetail(); return }
    if (document.getElementById('proxiesTable')) { initProxiesPage(); return }
    if (document.getElementById('backendsTable')) { initBackendsPage(); return }
    if (document.getElementById('domainsTable')) { initDomainsPage(); return }
    if (document.getElementById('certsTable')) { initCertsPage(); return }
  });

  // Backends
  async function loadBackends(){
    const out = await window.api.requestJson('/api/backends');
    const tbody = document.querySelector('#backendsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!out || out.status!==200){ tbody.innerHTML = '<tr><td colspan="4" class="muted">Failed to load</td></tr>'; return }
    const rows = out.body || [];
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="muted">No backends</td></tr>'; return }
    for (const b of rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(b.name)}</td><td>${escapeHtml(b.targetHost)}:${b.targetPort}</td><td>${escapeHtml(b.targetProtocol||'')}</td><td><button data-id="${b.id}" class="btn small delete-backend">Delete</button></td>`;
      tbody.appendChild(tr);
    }
  }

  async function createBackendFromForm(ev){
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    const payload = {};
    for (const [k,v] of data.entries()) payload[k] = v;
    const res = await window.api.requestJson('/api/backends', { method:'POST', body: payload });
    if (!res || (res.status!==200 && res.status!==201)) return alert('Create backend failed');
    alert('Backend created'); form.reset(); await loadBackends();
  }

  async function initBackendsPage(){
    try { await loadBackends(); } catch(e){ console.error(e) }
    const form = document.getElementById('createBackendForm'); if (form) form.addEventListener('submit', createBackendFromForm);
    document.addEventListener('click', async (ev)=>{
      const btn = ev.target.closest && ev.target.closest('.delete-backend'); if (!btn) return;
      const id = btn.dataset.id; if (!id) return;
      if (!confirm('Delete backend?')) return;
      const res = await window.api.requestJson(`/api/backends/${id}`, { method:'DELETE' });
      if (res && (res.status===204||res.status===200)) { await loadBackends(); alert('Deleted'); } else alert('Delete failed');
    });
  }

  // Domains
  async function loadDomains(){
    const out = await window.api.requestJson('/api/domains');
    const tbody = document.querySelector('#domainsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!out || out.status!==200){ tbody.innerHTML = '<tr><td colspan="4" class="muted">Failed to load</td></tr>'; return }
    const rows = out.body || [];
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="muted">No domains</td></tr>'; return }
    for (const d of rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(d.hostname)}</td><td>${escapeHtml(d.proxyName||d.proxy_id||'')}</td><td>${escapeHtml(d.backendName||d.backend_id||'')}</td><td><button data-id="${d.id}" class="btn small delete-domain">Delete</button></td>`;
      tbody.appendChild(tr);
    }
  }

  async function createDomainFromForm(ev){
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    const payload = {};
    for (const [k,v] of data.entries()) payload[k] = v;
    payload.useProxyTarget = !!payload.useProxyTarget; // checkbox
    const res = await window.api.requestJson('/api/domains', { method:'POST', body: payload });
    if (!res || (res.status!==200 && res.status!==201)) return alert('Create domain failed');
    alert('Domain created'); form.reset(); await loadDomains();
  }

  async function initDomainsPage(){
    try { await loadDomains(); } catch(e){ console.error(e) }
    const form = document.getElementById('createDomainForm'); if (form) form.addEventListener('submit', createDomainFromForm);
    // populate selects
    try {
      const ps = await window.api.requestJson('/api/proxies');
      const bs = await window.api.requestJson('/api/backends');
      const pSel = document.getElementById('createDomainProxySelect');
      const bSel = document.getElementById('createDomainBackendSelect');
      if (pSel && ps && ps.status===200) { pSel.innerHTML = ''; for (const p of ps.body||[]) { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; pSel.appendChild(opt); } }
      if (bSel && bs && bs.status===200) { bSel.innerHTML = '<option value="">(select backend)</option>'; for (const b of bs.body||[]) { const opt = document.createElement('option'); opt.value = b.id; opt.textContent = `${b.name} (${b.targetHost}:${b.targetPort})`; bSel.appendChild(opt); } }
    } catch (e) { console.error('populate domain selects failed', e); }
    document.addEventListener('click', async (ev)=>{
      const btn = ev.target.closest && ev.target.closest('.delete-domain'); if (!btn) return;
      const id = btn.dataset.id; if (!id) return;
      if (!confirm('Delete domain?')) return;
      const res = await window.api.requestJson(`/api/domains/${id}`, { method:'DELETE' });
      if (res && (res.status===204||res.status===200)) { await loadDomains(); alert('Deleted'); } else alert('Delete failed');
    });
  }

  // Certificates
  async function loadCerts(){
    const out = await window.api.requestJson('/api/certificates');
    const tbody = document.querySelector('#certsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!out || out.status!==200){ tbody.innerHTML = '<tr><td colspan="4" class="muted">Failed to load</td></tr>'; return }
    const rows = out.body || [];
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="muted">No certificates</td></tr>'; return }
    for (const c of rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(c.hostname)}</td><td>${escapeHtml(c.status||'')}</td><td>${escapeHtml(c.valid_until||'')}</td><td><button data-domain="${escapeHtml(c.hostname)}" class="btn small renew-cert">Renew</button></td>`;
      tbody.appendChild(tr);
    }
  }

  async function initCertsPage(){
    try { await loadCerts(); } catch(e){ console.error(e) }
    const form = document.getElementById('requestCertForm'); if (form) form.addEventListener('submit', async (ev)=>{
      ev.preventDefault(); const data = new FormData(form); const payload = {}; for (const [k,v] of data.entries()) payload[k]=v; const res = await window.api.requestJson('/api/certificates/generate', { method:'POST', body: payload}); if (!res || (res.status!==200 && res.status!==201)) return alert('Request failed'); alert('Requested'); form.reset(); await loadCerts();
    });
    document.addEventListener('click', async (ev)=>{
      const btn = ev.target.closest && ev.target.closest('.renew-cert'); if (!btn) return; const domain = btn.dataset.domain; if (!confirm('Renew cert for '+domain+'?')) return; const res = await window.api.requestJson('/api/certificates/generate', { method:'POST', body:{ domain }}); if (!res || (res.status!==200 && res.status!==201)) return alert('Renew failed'); alert('Renew requested'); await loadCerts();
    });
  }

})();
