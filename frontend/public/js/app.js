// Minimal SPA app glue for Nebula (new frontend)
(function () {
  const cache = { proxies: [], backends: [] };
  const dashboardState = {
    viewMode: 'realtime',
    metrics: [],
    timer: null,
    animationId: null,
    canvas: null,
    placeholder: null,
    buttons: {},
    stats: {},
    domainStatsTimer: null,
    timeline: null
  };
  let currentErrorPageProxyId = null;

  // Function to initialize detail pages when DOM is ready
  function initDetailPageWhenReady() {
    const path = window.location.pathname;
    let targetInit = null;
    
    if (/^\/proxies\/\d+$/i.test(path)) {
      targetInit = initProxyDetail;
    } else if (/^\/domain\.html/i.test(path)) {
      targetInit = initDomainDetail;
    } else if (/^\/backend\.html/i.test(path)) {
      targetInit = initBackendDetail;
    }
    
    if (!targetInit) return false;
    
    // Wait for the main content to be available
    const checkInterval = setInterval(() => {
      const hasContent = document.querySelector('.page-content') !== null;
      if (hasContent) {
        clearInterval(checkInterval);
        targetInit();
      }
    }, 50);
    
    // Timeout after 5 seconds
    setTimeout(() => clearInterval(checkInterval), 5000);
    return true;
  }

  // Wait for partials to be loaded before initializing detail pages
  document.addEventListener('partials-loaded', () => {
    initDetailPageWhenReady();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const body = document.body || {};
    const page = body.dataset ? body.dataset.page : '';
    const path = window.location.pathname;

    setupInlineBackendCreator();
    attachProxyBackendChange();
    setupErrorPageEditor();

    // Skip initialization for detail pages, wait for partials-loaded event
    if (/^\/proxies\/\d+$/i.test(path)) {
      return;
    }
    
    if (/^\/domain\.html/i.test(path)) {
      return;
    }
    
    if (/^\/backend\.html/i.test(path)) {
      return;
    }

    switch (page) {
      case 'dashboard':
        initDashboard();
        break;
      case 'proxies':
        initProxiesPage();
        break;
      case 'backends':
        initBackendsPage();
        break;
      case 'domains':
        initDomainsPage();
        break;
      case 'certificates':
        initCertsPage();
        break;
      case 'settings':
        initSettingsPage();
        break;
      case 'security':
        window.initSecurityPage();
        break;
      case 'requests':
        initRequestsPage();
        break;
      default:
        break;
    }
  });

  document.addEventListener('click', async (ev) => {
    const opener = ev.target.closest && ev.target.closest('[data-panel-target]');
    if (opener) {
      ev.preventDefault();
      const panelId = opener.getAttribute('data-panel-target');
      const focusSel = opener.getAttribute('data-panel-focus');
      if (panelId === 'proxyFormPanel') {
        await prepareProxyFormPanel();
      }
      if (panelId === 'domainFormPanel') {
        populateDomainSelects().catch(() => { });
      }
      togglePanel(panelId, true, focusSel);
      return;
    }
    const errorBtn = ev.target.closest && ev.target.closest('.edit-error-page');
    if (errorBtn) {
      ev.preventDefault();
      const id = errorBtn.dataset.id;
      const name = errorBtn.dataset.name || '';
      if (id) await openErrorPageEditor(id, name);
      return;
    }
    const closer = ev.target.closest && ev.target.closest('[data-panel-close]');
    if (closer) {
      ev.preventDefault();
      const id = closer.getAttribute('data-panel-close');
      togglePanel(id, false);
      if (id === 'errorPagePanel') currentErrorPageProxyId = null;
    }
  });

  function initDashboard() {
    dashboardState.canvas = document.getElementById('trafficChart');
    dashboardState.placeholder = document.getElementById('chartPlaceholder');
    dashboardState.stats = {
      requests: document.getElementById('stat-requests'),
      rps: document.getElementById('stat-rps'),
      trafficIn: document.getElementById('stat-traffic-in'),
      trafficOut: document.getElementById('stat-traffic-out')
    };
    dashboardState.buttons = {
      realtime: document.getElementById('btnViewRealtime'),
      daily: document.getElementById('btnView24h')
    };
    if (dashboardState.buttons.realtime) {
      dashboardState.buttons.realtime.addEventListener('click', () => setDashboardViewMode('realtime'));
    }
    if (dashboardState.buttons.daily) {
      dashboardState.buttons.daily.addEventListener('click', () => setDashboardViewMode('24h'));
    }
    
    // Initialize Chart.js
    if (dashboardState.canvas) {
      const ctx = dashboardState.canvas.getContext('2d');
      dashboardState.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Trafic entrant',
              data: [],
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              borderWidth: 3,
              tension: 0.4,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 0,
              pointHitRadius: 0
            },
            {
              label: 'Trafic sortant',
              data: [],
              borderColor: '#a855f7',
              backgroundColor: 'rgba(168, 85, 247, 0.2)',
              borderWidth: 3,
              tension: 0.4,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 0,
              pointHitRadius: 0
            },
            {
              label: 'Requêtes/s',
              data: [],
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34, 197, 94, 0.2)',
              borderWidth: 3,
              tension: 0.4,
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 0,
              pointHitRadius: 0,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 0
          },
          transitions: {
            active: {
              animation: {
                duration: 0
              }
            }
          },
          interaction: {
            intersect: false,
            mode: 'index'
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: 'rgba(255, 255, 255, 0.9)',
                usePointStyle: true,
                padding: 20,
                font: {
                  size: 13,
                  weight: '500'
                }
              }
            },
            tooltip: {
              enabled: false
            }
          },
          scales: {
            x: {
              grid: {
                color: 'rgba(255, 255, 255, 0.08)',
                drawBorder: false
              },
              ticks: {
                color: 'rgba(255, 255, 255, 0.6)',
                maxTicksLimit: 10,
                font: {
                  size: 11
                }
              }
            },
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              beginAtZero: true,
              grid: {
                color: 'rgba(255, 255, 255, 0.08)',
                drawBorder: false
              },
              ticks: {
                color: 'rgba(255, 255, 255, 0.6)',
                callback: function(value) {
                  return formatBytes(value) + '/s';
                },
                font: {
                  size: 11
                }
              }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              beginAtZero: true,
              grid: {
                drawOnChartArea: false
              },
              ticks: {
                color: 'rgba(255, 255, 255, 0.6)',
                callback: function(value) {
                  return formatNumber(value);
                },
                font: {
                  size: 11
                }
              }
            }
          }
        }
      });
    }
    
    updateDashboardToggle();
    updateDashboardStats();
    fetchDashboardMetrics();
    refreshDashboardDomainStats();
  }

  function setDashboardViewMode(mode) {
    if (dashboardState.viewMode === mode) return;
    dashboardState.viewMode = mode;
    dashboardState.timeline = null; // Reset timeline when changing mode
    updateDashboardToggle();
    fetchDashboardMetrics();
  }

  function updateDashboardToggle() {
    if (!dashboardState.buttons) return;
    if (dashboardState.buttons.realtime) {
      dashboardState.buttons.realtime.classList.toggle('active', dashboardState.viewMode === 'realtime');
    }
    if (dashboardState.buttons.daily) {
      dashboardState.buttons.daily.classList.toggle('active', dashboardState.viewMode === '24h');
    }
  }

  async function fetchDashboardMetrics() {
    if (!dashboardState.canvas) return;
    clearTimeout(dashboardState.timer);
    const params = dashboardState.viewMode === 'realtime'
      ? 'last=65&interval=1'
      : 'last=86400&interval=3600';
    try {
      const res = await window.api.requestJson(`/api/metrics/combined?${params}`);
      if (!res || res.status !== 200 || !res.body) throw new Error('metrics');
      const payload = res.body;
      const rows = Array.isArray(payload.metrics) ? payload.metrics
        : Array.isArray(payload) ? payload : [];
      const normalized = normalizeMetrics(rows);
      const interval = dashboardState.viewMode === 'realtime' ? 1 : 3600;
      dashboardState.metrics = normalized.map(row => ({
        ts: row.ts,
        inRate: row.bytesIn / interval,
        outRate: row.bytesOut / interval,
        requestsRate: row.requests / interval,
        rawRequests: row.requests
      }));
      updateDashboardStats();
    } catch (err) {
      console.error('metrics fetch failed', err);
    } finally {
      const delay = dashboardState.viewMode === 'realtime' ? 1000 : 60000;
      dashboardState.timer = setTimeout(() => fetchDashboardMetrics(), delay);
    }
  }

  function normalizeMetrics(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(row => {
      const tsRaw = row.bucket || row.timestamp || row.ts || row.time || row.date;
      const ts = tsRaw ? new Date(tsRaw).getTime() : Date.now();
      return {
        ts,
        bytesIn: Number(row.bytes_in ?? row.traffic_in ?? row.in ?? 0),
        bytesOut: Number(row.bytes_out ?? row.traffic_out ?? row.out ?? 0),
        requests: Number(row.requests_per_second ?? row.requests ?? 0)
      };
    }).filter(item => !Number.isNaN(item.ts))
      .sort((a, b) => a.ts - b.ts);
  }

  function updateDashboardStats() {
    const stats = dashboardState.stats || {};
    const data = dashboardState.metrics || [];
    if (!stats.requests || !stats.rps || !stats.trafficIn || !stats.trafficOut) return;
    
    // Calculate stats (0 if no data)
    const totalRequests = data.length ? data.reduce((sum, row) => sum + (row.rawRequests || 0), 0) : 0;
    const latest = data.length ? data[data.length - 1] : null;
    const rpsValue = latest ? latest.requestsRate || 0 : 0;
    const inValue = latest ? latest.inRate || 0 : 0;
    const outValue = latest ? latest.outRate || 0 : 0;
    
    stats.requests.textContent = formatNumber(totalRequests);
    stats.rps.textContent = `${formatNumber(rpsValue >= 100 ? Math.round(rpsValue) : Number(rpsValue.toFixed(1)))} /s`;
    stats.trafficIn.textContent = `${formatBytes(inValue)}/s`;
    stats.trafficOut.textContent = `${formatBytes(outValue)}/s`;
    
    // Update Chart.js - always update, even with empty data
    if (dashboardState.chart) {
      const maxPoints = dashboardState.viewMode === 'realtime' ? 60 : 24;
      const now = Date.now();
      const interval = dashboardState.viewMode === 'realtime' ? 1000 : 3600000;
      
      // Initialize or shift existing timeline
      if (!dashboardState.timeline) {
        // First time - generate full timeline
        dashboardState.timeline = [];
        for (let i = maxPoints - 1; i >= 0; i--) {
          dashboardState.timeline.push(now - (i * interval));
        }
      } else {
        // Shift timeline: remove oldest, add newest
        dashboardState.timeline.shift();
        dashboardState.timeline.push(now);
      }
      
      // Fill with zeros or actual data
      const chartData = dashboardState.timeline.map(ts => {
        const dataPoint = data.find(d => Math.abs(d.ts - ts) < interval / 2);
        return {
          ts,
          inRate: dataPoint ? dataPoint.inRate : 0,
          outRate: dataPoint ? dataPoint.outRate : 0,
          requestsRate: dataPoint ? dataPoint.requestsRate : 0
        };
      });
      
      dashboardState.chart.data.labels = chartData.map(point => {
        const date = new Date(point.ts);
        return dashboardState.viewMode === 'realtime' 
          ? date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      });
      
      dashboardState.chart.data.datasets[0].data = chartData.map(p => p.inRate);
      dashboardState.chart.data.datasets[1].data = chartData.map(p => p.outRate);
      dashboardState.chart.data.datasets[2].data = chartData.map(p => p.requestsRate);
      
      // Hide placeholder if we have chart
      if (dashboardState.placeholder) {
        dashboardState.placeholder.hidden = true;
      }
      
      dashboardState.chart.update('none');
    }
  }

  async function refreshDashboardDomainStats() {
    await loadDomainInsights({ tableId: 'dashboardDomainStats', emptyId: 'dashboardDomainStatsEmpty', limit: 5, compact: true });
    if (dashboardState.domainStatsTimer) clearTimeout(dashboardState.domainStatsTimer);
    dashboardState.domainStatsTimer = setTimeout(refreshDashboardDomainStats, 60000);
  }

  async function initProxiesPage() {
    await loadProxies();
    const form = document.getElementById('createProxyForm');
    if (form) form.addEventListener('submit', createProxyFromForm);

    document.addEventListener('click', (ev) => {
      if ((document.body.dataset.page || '') !== 'proxies') return;
      const edit = ev.target.closest && ev.target.closest('.edit-proxy');
      if (edit && edit.dataset.id) {
        window.location.href = `/proxies/${edit.dataset.id}`;
      }
    });
  }



  async function initBackendsPage() {
    await loadBackends();
    const form = document.getElementById('createBackendForm');
    if (form) form.addEventListener('submit', createBackendFromForm);

    document.addEventListener('click', async (ev) => {
      if ((document.body.dataset.page || '') !== 'backends') return;

      const btn = ev.target.closest && ev.target.closest('.delete-backend');
      if (!btn || !btn.dataset.id) return;
      if (!confirm('Supprimer ce backend ?')) return;
      const res = await window.api.requestJson(`/api/backends/${btn.dataset.id}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        showToast('Backend supprime');
        await loadBackends();
      } else {
        showToast('Suppression impossible', 'error');
      }
    });
  }

  async function createBackendFromForm(ev) {
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    const payload = formDataToObject(data);

    try {
      const res = await window.api.requestJson('/api/backends', { method: 'POST', body: payload });
      if (res && (res.status === 200 || res.status === 201)) {
        showToast('Backend cree');
        form.reset();
        togglePanel('backendFormPanel', false);
        await loadBackends();
      } else {
        showToast('Creation impossible', 'error');
      }
    } catch (e) {
      showToast('Erreur technique', 'error');
    }
  }

  async function initDomainsPage() {
    await populateDomainSelects();
    await loadDomains();
    const createForm = document.getElementById('createDomainForm');
    if (createForm) createForm.addEventListener('submit', createDomainFromForm);

    document.addEventListener('click', async (ev) => {
      if ((document.body.dataset.page || '') !== 'domains') return;
      
      // Handle delete button
      const deleteBtn = ev.target.closest && ev.target.closest('.delete-domain');
      if (!deleteBtn || !deleteBtn.dataset.id) return;
      if (!confirm('Supprimer ce domaine ?')) return;
      const res = await window.api.requestJson(`/api/domains/${deleteBtn.dataset.id}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        showToast('Domaine supprime');
        await loadDomains();
      } else {
        showToast('Suppression impossible', 'error');
      }
    });
  }

  async function initCertsPage() {
    await loadCerts();
    const form = document.getElementById('requestCertForm');
    if (form) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const payload = formDataToObject(new FormData(form));
        const res = await window.api.requestJson('/api/certificates/generate', { method: 'POST', body: payload });
        if (res && (res.status === 200 || res.status === 201)) {
          showToast('Demande envoyee');
          form.reset();
          await loadCerts();
          togglePanel('certFormPanel', false);
        } else {
          showToast('Echec de la demande', 'error');
        }
      });
    }

    document.addEventListener('click', async (ev) => {
      if ((document.body.dataset.page || '') !== 'certificates') return;
      const btn = ev.target.closest && ev.target.closest('.renew-cert');
      if (!btn || !btn.dataset.domain) return;
      if (!confirm(`Renouveler ${btn.dataset.domain} ?`)) return;
      const res = await window.api.requestJson('/api/certificates/generate', {
        method: 'POST',
        body: { domain: btn.dataset.domain }
      });
      if (res && (res.status === 200 || res.status === 201)) {
        showToast('Renouvellement demande');
        await loadCerts();
      } else {
        showToast('Renouvellement impossible', 'error');
      }
    });
    const manualForm = document.getElementById('manualCertForm');
    if (manualForm) manualForm.addEventListener('submit', submitManualCert);
  }

  async function initSettingsPage() {
    await loadSettings();
    const form = document.getElementById('settingsForm');
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const textarea = document.getElementById('localTldsTextarea');
      const raw = (textarea.value || '').trim();
      const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const res = await window.api.requestJson('/api/settings/local_tlds', {
        method: 'PUT',
        body: { localTlds: list }
      });
      if (res && res.status === 200) {
        showToast('Parametres sauvegardes');
        await loadSettings();
      } else {
        showToast('Sauvegarde impossible', 'error');
      }
    });
  }

  async function loadProxies() {
    const tbody = document.querySelector('#proxiesTable tbody');
    const empty = document.getElementById('proxiesEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const rows = await fetchAndCache('/api/proxies', 'proxies');
      toggleEmpty(empty, rows.length > 0, 'Aucun proxy configure.');
      if (!rows.length) return;
      rows.forEach((p) => {
        const statusClass = p.enabled ? 'success' : 'muted';
        const statusLabel = p.enabled ? 'Actif' : 'Inactif';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <strong>${escapeHtml(p.name || '')}</strong>
            <div class="muted mono">${escapeHtml((p.protocol || 'tcp').toUpperCase())}</div>
          </td>
          <td class="mono">${escapeHtml(p.listen_host)}:${p.listen_port}</td>
          <td class="mono">${escapeHtml(p.target_host)}:${p.target_port}</td>
          <td><span class="status-badge ${statusClass}"><span class="status-dot"></span>${statusLabel}</span></td>
          <td class="actions">
            <button class="btn ghost small edit-proxy" data-id="${p.id}">Gerer</button>
            <button class="btn ghost small edit-error-page" data-id="${p.id}" data-name="${escapeHtml(p.name || '')}">Erreur</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      toggleEmpty(empty, false, 'Impossible de charger les proxies.');
      showToast('Chargement des proxies impossible', 'error');
    }
  }

  async function loadBlockedIps() {
    const table = document.getElementById('blockedIpsTable');
    const empty = document.getElementById('blockedIpsEmpty');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const res = await window.api.requestJson('/api/security/blocked-ips');
      if (!res || res.status !== 200) throw new Error('blocked');
      const rows = Array.isArray(res.body) ? res.body : [];
      if (!rows.length) {
        table.style.display = 'none';
        if (empty) empty.hidden = false;
        return;
      }
      table.style.display = 'table';
      if (empty) empty.hidden = true;
      rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${escapeHtml(row.ip)}</td>
          <td>${escapeHtml(row.reason || '')}</td>
          <td>${row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
          <td><button class="btn ghost small delete-blocked-ip" data-id="${row.id}">Retirer</button></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      table.style.display = 'none';
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'Impossible de charger les IP bloquees.';
      }
    }
  }

  async function submitBlockedIp(ev) {
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    const payload = {};
    for (const [k, v] of data.entries()) payload[k] = v;
    try {
      const res = await window.api.requestJson('/api/security/blocked-ips', {
        method: 'POST',
        body: payload
      });
      if (res && res.status === 200) {
        showToast('IP bloquee');
        form.reset();
        await loadBlockedIps();
      } else {
        showToast('Impossible de bloquer', 'error');
      }
    } catch (e) {
      showToast('Impossible de bloquer', 'error');
    }
  }

  async function deleteBlockedIp(id) {
    if (!id) return;
    if (!confirm('Retirer cette IP de la liste de blocage ?')) return;
    try {
      const res = await window.api.requestJson(`/api/security/blocked-ips/${id}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        showToast('IP retiree');
        await loadBlockedIps();
      } else {
        showToast('Suppression impossible', 'error');
      }
    } catch (e) {
      showToast('Suppression impossible', 'error');
    }
  }

  async function loadSecurityConfig() {
    try {
      const res = await window.api.requestJson('/api/security/config');
      if (!res || res.status !== 200) throw new Error('config');
      const cfg = res.body || {};
      populateSmtpForm(cfg.smtp || {});
      populateSecurityForm(cfg);
    } catch (e) {
      populateSmtpForm({});
      populateSecurityForm({});
    }
  }

  function populateSmtpForm(cfg) {
    const form = document.getElementById('smtpForm');
    if (!form) return;
    const hostEl = document.getElementById('smtpHost') || form.elements && form.elements['host'];
    const portEl = document.getElementById('smtpPort') || form.elements && form.elements['port'];
    const secureEl = document.getElementById('smtpSecure') || form.elements && form.elements['secure'];
    const userEl = document.getElementById('smtpUser') || form.elements && form.elements['user'];
    const passEl = document.getElementById('smtpPass') || form.elements && form.elements['pass'];
    const fromEl = document.getElementById('smtpFrom') || form.elements && form.elements['from'];
    const toEl = document.getElementById('smtpTo') || form.elements && form.elements['to'];
    if (hostEl) hostEl.value = cfg.host || '';
    if (portEl) portEl.value = cfg.port || '';
    if (secureEl) {
      try { secureEl.checked = !!cfg.secure; } catch (e) { /* ignore */ }
    }
    if (userEl) userEl.value = cfg.user || '';
    if (passEl) passEl.value = cfg.pass || '';
    if (fromEl) fromEl.value = cfg.from || '';
    if (toEl) toEl.value = cfg.to || '';
  }

  async function submitSmtpSettings(ev) {
    ev.preventDefault();
    const form = ev.target;
    const hostEl = document.getElementById('smtpHost') || form.elements && form.elements['host'];
    const portEl = document.getElementById('smtpPort') || form.elements && form.elements['port'];
    const secureEl = document.getElementById('smtpSecure') || form.elements && form.elements['secure'];
    const userEl = document.getElementById('smtpUser') || form.elements && form.elements['user'];
    const passEl = document.getElementById('smtpPass') || form.elements && form.elements['pass'];
    const fromEl = document.getElementById('smtpFrom') || form.elements && form.elements['from'];
    const toEl = document.getElementById('smtpTo') || form.elements && form.elements['to'];
    const payload = {
      smtp: {
        host: (hostEl && (hostEl.value || '') || '').trim(),
        port: Number(portEl && portEl.value) || 0,
        secure: !!(secureEl && secureEl.checked),
        user: (userEl && userEl.value) || '',
        pass: (passEl && passEl.value) || '',
        from: (fromEl && fromEl.value) || '',
        to: (toEl && toEl.value) || ''
      }
    };
    await updateSecurityConfig(payload, 'Parametres SMTP mis a jour');
  }

  function populateSecurityForm(cfg) {
    const form = document.getElementById('securityConfigForm');
    if (!form) return;
    form.autoBlockIps.checked = !!(cfg.autoBlockIps || cfg.auto_block_ips);
    form.autoAlertDomains.checked = !!(cfg.autoAlertDomains || cfg.auto_alert_domains);
    form.ipBytesThreshold.value = Number(cfg.ipBytesThreshold ?? cfg.ip_bytes_threshold ?? 0) || 0;
    form.ipRequestsThreshold.value = Number(cfg.ipRequestsThreshold ?? cfg.ip_requests_threshold ?? 0) || 0;
    form.domainBytesThreshold.value = Number(cfg.domainBytesThreshold ?? cfg.domain_bytes_threshold ?? 0) || 0;
    form.domainRequestsThreshold.value = Number(cfg.domainRequestsThreshold ?? cfg.domain_requests_threshold ?? 0) || 0;
  }

  // expose initSecurityPage to global scope so the DOMContentLoaded switch can call it
  window.initSecurityPage = async function initSecurityPage() {
    await Promise.all([loadBlockedIps(), loadTrustedIps(), loadSecurityConfig(), loadBotStats()]);
    const blockedForm = document.getElementById('blockedIpForm');
    if (blockedForm) blockedForm.addEventListener('submit', submitBlockedIp);
    const trustedForm = document.getElementById('trustedIpForm');
    if (trustedForm) trustedForm.addEventListener('submit', submitTrustedIp);
    const smtpForm = document.getElementById('smtpForm');
    if (smtpForm) smtpForm.addEventListener('submit', submitSmtpSettings);
    const configForm = document.getElementById('securityConfigForm');
    if (configForm) configForm.addEventListener('submit', submitSecurityConfig);

    document.addEventListener('click', (ev) => {
      if ((document.body.dataset.page || '') !== 'security') return;
      const blockedBtn = ev.target.closest && ev.target.closest('.delete-blocked-ip');
      if (blockedBtn && blockedBtn.dataset.id) {
        ev.preventDefault();
        deleteBlockedIp(blockedBtn.dataset.id);
      }
      const trustedBtn = ev.target.closest && ev.target.closest('.delete-trusted-ip');
      if (trustedBtn && trustedBtn.dataset.id) {
        ev.preventDefault();
        deleteTrustedIp(trustedBtn.dataset.id);
      }
    });
  };

  async function submitSecurityConfig(ev) {
    ev.preventDefault();
    const form = ev.target;
    const payload = {
      autoBlockIps: form.autoBlockIps.checked,
      autoAlertDomains: form.autoAlertDomains.checked,
      ipBytesThreshold: Number(form.ipBytesThreshold.value) || 0,
      ipRequestsThreshold: Number(form.ipRequestsThreshold.value) || 0,
      domainBytesThreshold: Number(form.domainBytesThreshold.value) || 0,
      domainRequestsThreshold: Number(form.domainRequestsThreshold.value) || 0
    };
    await updateSecurityConfig(payload, 'Seuils enregistres');
  }

  async function updateSecurityConfig(body, successMessage) {
    try {
      const res = await window.api.requestJson('/api/security/config', { method: 'PUT', body });
      if (res && res.status === 200) {
        showToast(successMessage || 'Configuration sauvegardee');
        populateSmtpForm(res.body && res.body.smtp ? res.body.smtp : {});
        populateSecurityForm(res.body || {});
      } else {
        showToast('Sauvegarde impossible', 'error');
      }
    } catch (e) {
      showToast('Sauvegarde impossible', 'error');
    }
  }

  async function loadTrustedIps() {
    const table = document.getElementById('trustedIpsTable');
    const empty = document.getElementById('trustedIpsEmpty');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const res = await window.api.requestJson('/api/security/trusted-ips');
      if (!res || res.status !== 200) throw new Error('trusted');
      const rows = Array.isArray(res.body) ? res.body : [];
      if (!rows.length) {
        table.style.display = 'none';
        if (empty) empty.hidden = false;
        return;
      }
      table.style.display = 'table';
      if (empty) empty.hidden = true;
      rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${escapeHtml(row.ip)}</td>
          <td>${escapeHtml(row.label || '')}</td>
          <td>${row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
          <td><button class="btn ghost small delete-trusted-ip" data-id="${row.id}">Retirer</button></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      table.style.display = 'none';
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'Impossible de charger les IP approuvees.';
      }
    }
  }

  async function submitTrustedIp(ev) {
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    const payload = {};
    for (const [k, v] of data.entries()) payload[k] = v;
    try {
      const res = await window.api.requestJson('/api/security/trusted-ips', { method: 'POST', body: payload });
      if (res && res.status === 200) {
        showToast('IP ajoutee aux approuves');
        form.reset();
        await loadTrustedIps();
      } else {
        showToast('Impossible d\'ajouter', 'error');
      }
    } catch (e) {
      showToast('Impossible d\'ajouter', 'error');
    }
  }

  async function deleteTrustedIp(id) {
    if (!id) return;
    if (!confirm('Retirer cette IP approuvee ?')) return;
    try {
      const res = await window.api.requestJson(`/api/security/trusted-ips/${id}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        showToast('IP retiree');
        await loadTrustedIps();
      } else {
        showToast('Suppression impossible', 'error');
      }
    } catch (e) {
      showToast('Suppression impossible', 'error');
    }
  }
  // === BOT PROTECTION MANAGEMENT ===
  window.loadBotStats = async function () {
    try {
      const res = await window.api.requestJson('/api/bot-protection/stats');
      if (res && res.status === 200) {
        const stats = res.body;
        const rpsEl = document.getElementById('statsRps');
        const verifiedEl = document.getElementById('statsVerified');
        const statusEl = document.getElementById('statsStatus');
        const modeEl = document.getElementById('underAttackMode');
        const thresholdEl = document.getElementById('botThreshold');

        if (rpsEl) rpsEl.textContent = stats.requestsPerSecond;
        if (verifiedEl) verifiedEl.textContent = stats.verifiedIPs;
        if (statusEl) statusEl.textContent = stats.isUnderAttack ? '🔴 Under Attack' : '🟢 Normal';
        if (modeEl) modeEl.checked = stats.enabled;
        if (thresholdEl) thresholdEl.value = stats.threshold;
      }
    } catch (e) {
      console.error('Failed to load bot stats', e);
    }
  };

  async function loadBackends() {
    const tbody = document.querySelector('#backendsTable tbody');
    const empty = document.getElementById('backendsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const rows = await fetchAndCache('/api/backends', 'backends');
      toggleEmpty(empty, rows.length > 0, 'Aucun backend defini.');
      if (!rows.length) return;
      rows.forEach((b) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHtml(b.name || '')}</strong></td>
          <td class="mono">${escapeHtml(b.targetHost || b.target_host || '')}:${b.targetPort || b.target_port}</td>
          <td>${escapeHtml((b.targetProtocol || b.target_protocol || '').toUpperCase())}</td>
          <td>
            <a class="btn ghost small" href="/backend.html?id=${b.id}">Gerer</a>
            <button class="btn ghost small delete-backend" data-id="${b.id}">Supprimer</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      toggleEmpty(empty, false, 'Impossible de charger les backends.');
      showToast('Chargement des backends impossible', 'error');
    }
  }

  async function loadDomains() {
    const tbody = document.querySelector('#domainsTable tbody');
    const empty = document.getElementById('domainsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const res = await window.api.requestJson('/api/domains');
      if (!res || res.status !== 200) throw new Error('loadDomains');
      const rows = Array.isArray(res.body) ? res.body : [];
      toggleEmpty(empty, rows.length > 0, 'Aucun domaine configure.');
      if (!rows.length) return;
      const proxyMap = new Map((cache.proxies || []).map((p) => [String(p.id), p]));
      const backendMap = new Map((cache.backends || []).map((b) => [String(b.id), b]));

      rows.forEach((d) => {
        const proxy = proxyMap.get(String(d.proxy_id));
        const backend = backendMap.get(String(d.backend_id));
        const backendLabel = backend
          ? `${escapeHtml(backend.name || '')} (${escapeHtml(backend.targetHost || backend.target_host || '')}:${backend.targetPort || backend.target_port})`
          : `${escapeHtml(d.target_host || '')}:${d.target_port || ''}`;
        
        // Bot protection status
        const botProtection = d.bot_protection || 'unprotected';
        let protectionBadge = '';
        let protectionText = '';
        if (botProtection === 'protected') {
          protectionBadge = 'warning';
          protectionText = '🔒 Protégé';
        } else {
          protectionBadge = 'success';
          protectionText = '✓ Ouvert';
        }
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHtml(d.hostname || '')}</strong></td>
          <td>${proxy ? escapeHtml(proxy.name || '') : `Proxy #${d.proxy_id}`}</td>
          <td>${backendLabel}</td>
          <td><span class="status-badge ${protectionBadge}"><span class="status-dot"></span>${protectionText}</span></td>
          <td>
            <a class="btn ghost small" href="/domain.html?id=${d.id}">Gerer</a>
            <button class="btn ghost small delete-domain" data-id="${d.id}">Supprimer</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      toggleEmpty(empty, false, 'Impossible de charger les domaines.');
      showToast('Chargement des domaines impossible', 'error');
    }
  }

  async function loadCerts() {
    const tbody = document.querySelector('#certsTable tbody');
    const empty = document.getElementById('certsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const res = await window.api.requestJson('/api/certificates');
      if (!res || res.status !== 200) throw new Error('loadCerts');
      const rows = Array.isArray(res.body) ? res.body : [];
      toggleEmpty(empty, rows.length > 0, 'Aucun certificat connu.');
      if (!rows.length) return;
      rows.forEach((c) => {
        const status = (c.status || '').toLowerCase();
        let badge = 'muted';
        if (status.includes('valid')) badge = 'success';
        else if (status.includes('pending')) badge = 'warning';
        const validUntil = c.valid_until ? new Date(c.valid_until).toLocaleString() : 'N/A';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHtml(c.hostname || '')}</strong></td>
          <td><span class="status-badge ${badge}"><span class="status-dot"></span>${escapeHtml(c.status || 'inconnu')}</span></td>
          <td>${escapeHtml(validUntil)}</td>
          <td><button class="btn ghost small renew-cert" data-domain="${escapeHtml(c.hostname || '')}">Renouveler</button></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      toggleEmpty(empty, false, 'Impossible de charger les certificats.');
      showToast('Chargement des certificats impossible', 'error');
    }
  }

  async function loadSettings() {
    const textarea = document.getElementById('localTldsTextarea');
    if (!textarea) return;
    try {
      const res = await window.api.requestJson('/api/settings/local_tlds');
      if (!res || res.status !== 200) throw new Error('loadSettings');
      const list = res.body && res.body.localTlds;
      if (Array.isArray(list)) textarea.value = list.join(', ');
      else if (typeof list === 'string') textarea.value = list;
      else textarea.value = '';
    } catch (e) {
      textarea.value = '';
      showToast('Chargement des parametres impossible', 'error');
    }
  }

  async function createProxyFromForm(ev) {
    ev.preventDefault();
    const form = ev.target;
    const payload = formDataToObject(new FormData(form));
    const backendSelect = document.getElementById('proxyBackendSelect');
    if (!backendSelect || !backendSelect.value) {
      showToast('Choisissez un backend', 'error');
      return;
    }
    const backend = findBackendById(backendSelect.value);
    if (!backend) {
      showToast('Backend introuvable', 'error');
      return;
    }
    payload.target_host = backend.targetHost || backend.target_host;
    payload.target_port = backend.targetPort || backend.target_port;
    try {
      const res = await window.api.requestJson('/api/proxies', { method: 'POST', body: payload });
      if (res && (res.status === 200 || res.status === 201)) {
        showToast('Proxy cree');
        form.reset();
        await loadProxies();
        togglePanel('proxyFormPanel', false);
      } else {
        showToast('Creation impossible', 'error');
      }
    } catch (e) {
      showToast('Creation impossible', 'error');
    }
  }



  async function createDomainFromForm(ev) {
    ev.preventDefault();
    const form = ev.target;
    const payload = formDataToObject(new FormData(form));
    if (!payload.backendId) {
      showToast('Choisissez un backend', 'error');
      return;
    }
    
    // Handle bot protection setting
    const botProtection = payload.botProtection || 'unprotected';
    const hostname = payload.hostname;
    delete payload.botProtection;
    
    try {
      const res = await window.api.requestJson('/api/domains', { method: 'POST', body: payload });
      if (res && (res.status === 200 || res.status === 201)) {
        console.log(`[Domains] Created domain: ${hostname}, protection: ${botProtection}`);
        
        // Apply bot protection setting
        if (botProtection === 'protected') {
          try {
            const protRes = await window.api.requestJson('/api/bot-protection/protected-domains/add', {
              method: 'POST',
              body: { domain: hostname }
            });
            console.log('[Domains] Added to protected list:', protRes ? protRes.status : 'no response');
          } catch (e) {
            console.error('[Domains] Failed to add to protected list:', e);
          }
        } else if (botProtection === 'unprotected') {
          try {
            const unprotRes = await window.api.requestJson('/api/bot-protection/unprotected-domains/add', {
              method: 'POST',
              body: { domain: hostname }
            });
            console.log('[Domains] Added to unprotected list:', unprotRes ? unprotRes.status : 'no response');
          } catch (e) {
            console.error('[Domains] Failed to add to unprotected list:', e);
          }
        }
        
        showToast('Domaine cree');
        form.reset();
        await loadDomains();
        togglePanel('domainFormPanel', false);
      } else {
        showToast('Creation impossible', 'error');
      }
    } catch (e) {
      console.error('[Domains] Create error:', e);
      showToast('Creation impossible', 'error');
    }
  }

  async function loadBackendDetail() {
    const urlParams = new URLSearchParams(window.location.search);
    const backendId = urlParams.get('id');
    if (!backendId) {
      showToast('ID de backend manquant', 'error');
      window.location.href = '/backends.html';
      return;
    }

    try {
      const backends = await fetchAndCache('/api/backends', 'backends');
      const backend = backends.find(b => String(b.id) === String(backendId));
      if (!backend) {
        showToast('Backend introuvable', 'error');
        window.location.href = '/backends.html';
        return;
      }

      const idField = document.getElementById('editBackendId');
      const nameField = document.getElementById('editBackendName');
      const hostField = document.getElementById('editBackendHost');
      const portField = document.getElementById('editBackendPort');
      const protocolField = document.getElementById('editBackendProtocol');

      if (!idField || !nameField || !hostField || !portField || !protocolField) {
        console.error('[Backend Detail] Required form fields not found', {
          idField: !!idField,
          nameField: !!nameField,
          hostField: !!hostField,
          portField: !!portField,
          protocolField: !!protocolField,
          bodyHTML: document.body ? 'exists' : 'missing'
        });
        return;
      }

      idField.value = backend.id;
      nameField.value = backend.name || '';
      hostField.value = backend.targetHost || backend.target_host || '';
      portField.value = backend.targetPort || backend.target_port || '';
      protocolField.value = backend.targetProtocol || backend.target_protocol || 'http';
    } catch (e) {
      console.error('[Backend Detail] Failed to load:', e);
      showToast('Erreur lors du chargement', 'error');
    }
  }

  async function saveBackendDetail() {
    const form = document.getElementById('editBackendForm');
    const payload = formDataToObject(new FormData(form));
    const backendId = payload.id;
    delete payload.id;

    try {
      const res = await window.api.requestJson(`/api/backends/${backendId}`, { 
        method: 'PUT', 
        body: payload 
      });
      
      if (res && (res.status === 200 || res.status === 201)) {
        showToast('Backend mis à jour');
        window.location.href = '/backends.html';
      } else {
        showToast('Mise à jour impossible', 'error');
      }
    } catch (e) {
      console.error('[Backend Detail] Update error:', e);
      showToast('Mise à jour impossible', 'error');
    }
  }

  async function deleteBackendDetail() {
    const backendId = document.getElementById('editBackendId').value;
    const backendName = document.getElementById('editBackendName').value;
    if (!confirm(`Supprimer le backend "${backendName}" ?`)) return;
    
    try {
      const res = await window.api.requestJson(`/api/backends/${backendId}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        showToast('Backend supprime');
        window.location.href = '/backends.html';
      } else {
        showToast('Suppression impossible', 'error');
      }
    } catch (e) {
      console.error('[Backend Detail] Delete error:', e);
      showToast('Suppression impossible', 'error');
    }
  }

  async function loadDomainCertificate() {
    const hostnameField = document.getElementById('editDomainHostname');
    if (!hostnameField) return;
    
    const hostname = hostnameField.value;
    if (!hostname) return;

    const certInfo = document.getElementById('domainCertInfo');
    const certEmpty = document.getElementById('domainCertEmpty');
    
    if (!certInfo || !certEmpty) return;
    
    try {
      const res = await window.api.requestJson('/api/certificates');
      if (!res || res.status !== 200) throw new Error('loadCerts');
      const certs = Array.isArray(res.body) ? res.body : [];
      const cert = certs.find(c => c.hostname === hostname);
      
      if (cert) {
        const status = (cert.status || '').toLowerCase();
        let badge = 'muted';
        let statusText = cert.status || 'inconnu';
        if (status.includes('valid')) badge = 'success';
        else if (status.includes('pending')) badge = 'warning';
        
        const validUntil = cert.valid_until ? new Date(cert.valid_until).toLocaleString() : 'N/A';
        
        document.getElementById('domainCertStatus').innerHTML = 
          `<span class="status-badge ${badge}"><span class="status-dot"></span>${escapeHtml(statusText)}</span>`;
        document.getElementById('domainCertExpiry').textContent = validUntil;
        
        // Charger le contenu du certificat
        try {
          const contentRes = await window.api.requestJson(`/api/certificates/${encodeURIComponent(hostname)}`);
          if (contentRes && contentRes.status === 200 && contentRes.body) {
            const fullchainEl = document.getElementById('domainCertFullchain');
            const keyEl = document.getElementById('domainCertKey');
            if (fullchainEl) fullchainEl.value = contentRes.body.cert || '';
            if (keyEl) keyEl.value = contentRes.body.key || '';
          }
        } catch (e) {
          console.error('[Domain Cert] Failed to load content:', e);
        }
        
        certInfo.hidden = false;
        certEmpty.hidden = true;
      } else {
        certInfo.hidden = true;
        certEmpty.hidden = false;
      }
    } catch (e) {
      console.error('[Domain Cert] Failed to load:', e);
      certInfo.hidden = true;
      certEmpty.hidden = false;
    }
  }

  async function importDomainCertificate() {
    const hostnameField = document.getElementById('editDomainHostname');
    const fullchainField = document.getElementById('domainCertFullchain');
    const keyField = document.getElementById('domainCertKey');
    
    if (!hostnameField || !fullchainField || !keyField) return;
    
    const hostname = hostnameField.value.trim();
    const certificate = fullchainField.value.trim();
    const privateKey = keyField.value.trim();
    
    if (!hostname) {
      showToast('Nom de domaine requis', 'error');
      return;
    }
    
    if (!certificate || !privateKey) {
      showToast('Le certificat et la clé privée sont requis', 'error');
      return;
    }
    
    try {
      const res = await window.api.requestJson('/api/certificates/manual', {
        method: 'POST',
        body: {
          domain: hostname,
          certificate,
          privateKey
        }
      });
      
      if (res && res.status === 200) {
        showToast('Certificat importé avec succès', 'success');
        await loadDomainCertificate();
      } else {
        throw new Error('Import failed');
      }
    } catch (e) {
      console.error('[Domain Cert] Import failed:', e);
      showToast('Échec de l\'importation du certificat', 'error');
    }
  }

  function showCertImportForm() {
    const certInfo = document.getElementById('domainCertInfo');
    const certEmpty = document.getElementById('domainCertEmpty');
    
    if (certInfo && certEmpty) {
      certInfo.hidden = false;
      certEmpty.hidden = true;
      
      // Vider les champs pour l'import
      const fullchainField = document.getElementById('domainCertFullchain');
      const keyField = document.getElementById('domainCertKey');
      if (fullchainField) fullchainField.value = '';
      if (keyField) keyField.value = '';
    }
  }

  async function loadDomainDetail() {
    const urlParams = new URLSearchParams(window.location.search);
    const domainId = urlParams.get('id');
    if (!domainId) {
      showToast('ID de domaine manquant', 'error');
      window.location.href = '/domains.html';
      return;
    }

    try {
      // Load domain data
      const res = await window.api.requestJson('/api/domains');
      if (!res || res.status !== 200) throw new Error('Failed to load domains');
      const domains = Array.isArray(res.body) ? res.body : [];
      const domain = domains.find(d => String(d.id) === String(domainId));
      if (!domain) {
        showToast('Domaine introuvable', 'error');
        window.location.href = '/domains.html';
        return;
      }

      // Populate selects
      const proxySelect = document.getElementById('editDomainProxySelect');
      const backendSelect = document.getElementById('editDomainBackendSelect');
      if (proxySelect && backendSelect) {
        proxySelect.innerHTML = '';
        backendSelect.innerHTML = '<option value="">Sélectionner...</option>';
        
        const proxies = cache.proxies.length ? cache.proxies : await fetchAndCache('/api/proxies', 'proxies');
        const backends = cache.backends.length ? cache.backends : await fetchAndCache('/api/backends', 'backends');
        
        proxies.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.listen_host}:${p.listen_port})`;
          proxySelect.appendChild(opt);
        });
        
        backends.forEach((b) => {
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = `${b.name} (${b.target_host}:${b.target_port})`;
          backendSelect.appendChild(opt);
        });
      }

      // Fill form with domain data
      const idField = document.getElementById('editDomainId');
      const hostnameField = document.getElementById('editDomainHostname');
      const proxyField = document.getElementById('editDomainProxySelect');
      const backendField = document.getElementById('editDomainBackendSelect');
      const protectionField = document.getElementById('editDomainBotProtection');

      if (!idField || !hostnameField || !proxyField || !backendField || !protectionField) {
        console.error('[Domain Detail] Required form fields not found', {
          idField: !!idField,
          hostnameField: !!hostnameField,
          proxyField: !!proxyField,
          backendField: !!backendField,
          protectionField: !!protectionField,
          bodyHTML: document.body ? 'exists' : 'missing',
          bodyDataPage: document.body?.dataset?.page,
          formExists: !!document.getElementById('editDomainForm'),
          pageContentExists: !!document.querySelector('.page-content'),
          allEditDomain: document.querySelectorAll('[id^="editDomain"]').length
        });
        return;
      }

      idField.value = domain.id;
      hostnameField.value = domain.hostname;
      proxyField.value = domain.proxy_id;
      backendField.value = domain.backend_id;
      protectionField.value = domain.bot_protection || 'unprotected';
    } catch (e) {
      console.error('[Domain Detail] Failed to load:', e);
      showToast('Erreur lors du chargement', 'error');
    }
  }

  async function saveDomainDetail(ev) {
    ev.preventDefault();
    const form = document.getElementById('editDomainForm');
    const payload = formDataToObject(new FormData(form));
    const domainId = payload.id;
    
    if (!payload.backendId) {
      showToast('Choisissez un backend', 'error');
      return;
    }
    
    const botProtection = payload.botProtection || 'unprotected';
    const hostname = payload.hostname;
    delete payload.id;
    delete payload.botProtection;
    
    try {
      const res = await window.api.requestJson(`/api/domains/${domainId}`, { 
        method: 'PUT', 
        body: { ...payload, botProtection }
      });
      
      if (res && (res.status === 200 || res.status === 201)) {
        // Update bot protection lists
        try {
          await window.api.requestJson('/api/bot-protection/protected-domains/remove', {
            method: 'POST',
            body: { domain: hostname }
          });
          await window.api.requestJson('/api/bot-protection/unprotected-domains/remove', {
            method: 'POST',
            body: { domain: hostname }
          });
        } catch (e) {
          // Ignore errors for removal
        }
        
        // Add to appropriate list
        if (botProtection === 'protected') {
          await window.api.requestJson('/api/bot-protection/protected-domains/add', {
            method: 'POST',
            body: { domain: hostname }
          });
        } else if (botProtection === 'unprotected') {
          await window.api.requestJson('/api/bot-protection/unprotected-domains/add', {
            method: 'POST',
            body: { domain: hostname }
          });
        }
        
        showToast('Domaine mis à jour');
        window.location.href = '/domains.html';
      } else {
        showToast('Mise à jour impossible', 'error');
      }
    } catch (e) {
      console.error('[Domain Detail] Update error:', e);
      showToast('Mise à jour impossible', 'error');
    }
  }

  async function deleteDomainDetail() {
    const domainId = document.getElementById('editDomainId').value;
    const hostname = document.getElementById('editDomainHostname').value;
    if (!confirm(`Supprimer le domaine "${hostname}" ?`)) return;
    
    try {
      const res = await window.api.requestJson(`/api/domains/${domainId}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        // Clean up bot protection lists
        try {
          await window.api.requestJson('/api/bot-protection/protected-domains/remove', {
            method: 'POST',
            body: { domain: hostname }
          });
          await window.api.requestJson('/api/bot-protection/unprotected-domains/remove', {
            method: 'POST',
            body: { domain: hostname }
          });
        } catch (e) {
          // Ignore errors
        }
        
        showToast('Domaine supprime');
        window.location.href = '/domains.html';
      } else {
        showToast('Suppression impossible', 'error');
      }
    } catch (e) {
      console.error('[Domain Detail] Delete error:', e);
      showToast('Suppression impossible', 'error');
    }
  }

  async function populateDomainSelects() {
    const proxySelect = document.getElementById('createDomainProxySelect');
    const backendSelect = document.getElementById('createDomainBackendSelect');
    if (!proxySelect || !backendSelect) return;
    proxySelect.innerHTML = '';
    backendSelect.innerHTML = '<option value="">Selectionner...</option>';
    try {
      const proxies = cache.proxies.length ? cache.proxies : await fetchAndCache('/api/proxies', 'proxies');
      const backends = cache.backends.length ? cache.backends : await fetchAndCache('/api/backends', 'backends');
      proxies.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.listen_host}:${p.listen_port})`;
        proxySelect.appendChild(opt);
      });
      backends.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.name} (${b.targetHost || b.target_host}:${b.targetPort || b.target_port})`;
        backendSelect.appendChild(opt);
      });
    } catch (e) {
      showToast('Impossible de charger proxies/backends', 'error');
    }
  }

  async function fetchAndCache(endpoint, cacheKey) {
    const res = await window.api.requestJson(endpoint);
    if (!res || res.status !== 200) throw new Error(`fetch-failed:${endpoint}`);
    const rows = Array.isArray(res.body) ? res.body : [];
    if (cacheKey) cache[cacheKey] = rows;
    return rows;
  }

  function toggleEmpty(el, hasData, message) {
    if (!el) return;
    if (!hasData && message) el.textContent = message;
    el.hidden = !!hasData;
  }

  function showToast(message, type = 'success') {
    const stack = document.getElementById('toastStack');
    if (!stack) {
      console[type === 'error' ? 'error' : 'log'](message);
      return;
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => toast.classList.add('toast-hide'), 3400);
    setTimeout(() => toast.remove(), 4000);
  }

  function formDataToObject(data) {
    const obj = {};
    for (const [k, v] of data.entries()) obj[k] = v;
    return obj;
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function initProxyDetail() {
    const match = window.location.pathname.match(/\/proxies\/(\d+)/);
    if (!match) return;
    const id = match[1];
    try {
      const res = await window.api.requestJson('/api/proxies');
      if (!res || res.status !== 200) return;
      const proxy = (res.body || []).find((p) => String(p.id) === String(id));
      if (!proxy) return;
      document.getElementById('editProxyName').value = proxy.name || '';
      document.getElementById('editProxyListenHost').value = proxy.listen_host || '';
      document.getElementById('editProxyListenPort').value = proxy.listen_port || '';
      document.getElementById('editProxyProtocol').value = proxy.protocol || 'tcp';

      const saveBtn = document.getElementById('btnSaveProxy');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const form = document.getElementById('editProxyForm');
          const payload = formDataToObject(new FormData(form));
          const resp = await window.api.requestJson(`/api/proxies/${id}`, { method: 'PUT', body: payload });
          if (resp && resp.status === 200) {
            showToast('Proxy enregistre');
            window.location.href = '/proxies.html';
          } else {
            showToast('Impossible de sauvegarder', 'error');
          }
        });
      }

      const delBtn = document.getElementById('btnDeleteProxy');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm('Supprimer ce proxy ?')) return;
          const resp = await window.api.requestJson(`/api/proxies/${id}`, { method: 'DELETE' });
          if (resp && (resp.status === 200 || resp.status === 204)) {
            showToast('Proxy supprime');
            window.location.href = '/proxies.html';
          } else {
            showToast('Suppression impossible', 'error');
          }
        });
      }
    } catch (e) {
      showToast('Chargement du proxy impossible', 'error');
    }
  }

  async function initDomainDetail() {
    await loadDomainDetail();
    await loadDomainCertificate();
    
    const saveBtn = document.getElementById('btnSaveDomain');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveDomainDetail);
    }

    const deleteBtn = document.getElementById('btnDeleteDomain');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', deleteDomainDetail);
    }

    const importCertBtn = document.getElementById('btnImportDomainCert');
    if (importCertBtn) {
      importCertBtn.addEventListener('click', importDomainCertificate);
    }

    const showImportBtn = document.getElementById('btnShowCertImport');
    if (showImportBtn) {
      showImportBtn.addEventListener('click', showCertImportForm);
    }
  }

  async function initBackendDetail() {
    await loadBackendDetail();
    
    const saveBtn = document.getElementById('btnSaveBackend');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveBackendDetail);
    }

    const deleteBtn = document.getElementById('btnDeleteBackend');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', deleteBackendDetail);
    }
  }

  function togglePanel(id, force, focusSelector) {
    if (!id) return;
    const panel = document.getElementById(id);
    if (!panel) return;
    const shouldShow = typeof force === 'boolean' ? force : !!panel.hidden;
    if (shouldShow) {
      panel.hidden = false;
      try {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { /* ignore */ }
      if (focusSelector) {
        const focusEl = document.querySelector(focusSelector);
        if (focusEl) setTimeout(() => focusEl.focus(), 60);
      }
    } else {
      panel.hidden = true;
      if (id === 'proxyFormPanel') resetProxyFormState();
      if (id === 'errorPagePanel') {
        currentErrorPageProxyId = null;
      }
    }
  }

  async function submitManualCert(ev) {
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    const payload = {};
    for (const [k, v] of data.entries()) payload[k] = v;
    try {
      const res = await window.api.requestJson('/api/certificates/manual', { method: 'POST', body: payload });
      if (res && res.status === 200) {
        showToast('Certificat importe');
        form.reset();
        togglePanel('manualCertPanel', false);
        await loadCerts();
      } else {
        showToast('Import impossible', 'error');
      }
    } catch (e) {
      showToast('Import impossible', 'error');
    }
  }

  async function loadDomainInsights(targetConfig) {
    const configList = Array.isArray(targetConfig) ? targetConfig : (targetConfig ? [targetConfig] : []);
    const usable = configList.filter((t) => t && document.getElementById(t.tableId));
    if (!usable.length) return;
    if (!usable.length) return;
    try {
      const res = await window.api.requestJson('/api/metrics/domains?last=86400&interval=3600');
      if (!res || res.status !== 200) throw new Error('domain-stats');
      const rows = res.body && Array.isArray(res.body.metrics) ? res.body.metrics : [];
      const aggregated = aggregateDomainStats(rows);
      usable.forEach((target) => renderDomainStatsTable(target.tableId, target.emptyId, aggregated, target));
    } catch (e) {
      usable.forEach((target) => {
        const table = document.getElementById(target.tableId);
        const empty = target.emptyId ? document.getElementById(target.emptyId) : null;
        if (table) table.style.display = 'none';
        if (empty) {
          empty.hidden = false;
          empty.textContent = 'Impossible de charger les statistiques.';
        }
      });
    }
  }

  function aggregateDomainStats(rows) {
    if (!Array.isArray(rows)) return [];
    const map = new Map();
    rows.forEach((row) => {
      const hostname = row.hostname;
      if (!hostname) return;
      if (!map.has(hostname)) {
        map.set(hostname, {
          hostname: hostname,
          bytesIn: 0,
          bytesOut: 0,
          requests: 0,
          lastSeen: null
        });
      }
      const entry = map.get(hostname);
      entry.bytesIn += Number(row.bytes_in ?? row.bytesIn ?? 0);
      entry.bytesOut += Number(row.bytes_out ?? row.bytesOut ?? 0);
      entry.requests += Number(row.requests ?? 0);
      const bucket = row.bucket || row.ts;
      if (bucket) {
        const ts = new Date(bucket).getTime();
        if (!entry.lastSeen || ts > entry.lastSeen) entry.lastSeen = ts;
      }
    });
    return Array.from(map.values()).sort((a, b) => (b.requests - a.requests));
  }

  function renderDomainStatsTable(tableId, emptyId, data, options = {}) {
    const table = document.getElementById(tableId);
    const empty = emptyId ? document.getElementById(emptyId) : null;
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const limit = options.limit || data.length;
    const rows = data.slice(0, limit);
    if (!rows.length) {
      table.style.display = 'none';
      if (empty) empty.hidden = false;
      return;
    }
    table.style.display = 'table';
    if (empty) empty.hidden = true;
    rows.forEach((stat) => {
      const tr = document.createElement('tr');
      const totalBytes = stat.bytesIn + stat.bytesOut;
      const lastSeen = stat.lastSeen ? new Date(stat.lastSeen).toLocaleString() : 'N/A';
      const trafficCells = options.splitTraffic
        ? `<td>${formatBytes(stat.bytesIn)}</td><td>${formatBytes(stat.bytesOut)}</td>`
        : `<td>${formatBytes(totalBytes)}</td>`;
      tr.innerHTML = `
        <td><strong>${escapeHtml(stat.hostname)}</strong></td>
        <td>${formatNumber(stat.requests)}</td>
        ${trafficCells}
        <td>${lastSeen}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function prepareProxyFormPanel() {
    const select = document.getElementById('proxyBackendSelect');
    const callout = document.getElementById('proxyBackendEmpty');
    if (!select) return;
    try {
      const list = await ensureBackendsCached(true);
      select.innerHTML = '';
      if (!list.length) {
        select.disabled = true;
        if (callout) callout.hidden = false;
        toggleInlineBackendPanel(false);
        applyBackendDataToProxyFields(null);
        return;
      }
      select.disabled = false;
      if (callout) callout.hidden = true;
      select.innerHTML = '<option value="">Selectionner...</option>';
      list.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.name} (${b.targetHost || b.target_host}:${b.targetPort || b.target_port})`;
        select.appendChild(opt);
      });
      attachProxyBackendChange();
      applyBackendDataToProxyFields(null);
    } catch (e) {
      showToast('Impossible de charger les backends', 'error');
    }
  }

  function attachProxyBackendChange() {
    const select = document.getElementById('proxyBackendSelect');
    if (!select || select.dataset.wired) return;
    select.dataset.wired = '1';
    select.addEventListener('change', handleProxyBackendChange);
  }

  function handleProxyBackendChange() {
    const backendId = this.value;
    const backend = backendId ? findBackendById(backendId) : null;
    applyBackendDataToProxyFields(backend);
  }

  function applyBackendDataToProxyFields(backend) {
    const hostInput = document.getElementById('targetHost');
    const portInput = document.getElementById('targetPort');
    if (!hostInput || !portInput) return;
    hostInput.readOnly = true;
    portInput.readOnly = true;
    hostInput.classList.add('input-locked');
    portInput.classList.add('input-locked');
    hostInput.value = backend ? backend.targetHost || backend.target_host || '' : '';
    portInput.value = backend ? backend.targetPort || backend.target_port || '' : '';
  }

  function resetProxyFormState() {
    const form = document.getElementById('createProxyForm');
    if (form) form.reset();
    const select = document.getElementById('proxyBackendSelect');
    if (select) {
      select.disabled = false;
      select.selectedIndex = 0;
    }
    const callout = document.getElementById('proxyBackendEmpty');
    if (callout) callout.hidden = true;
    toggleInlineBackendPanel(false);
    applyBackendDataToProxyFields(null);
  }

  async function ensureBackendsCached(force = false) {
    if (force || !Array.isArray(cache.backends) || !cache.backends.length) {
      await fetchAndCache('/api/backends', 'backends');
    }
    return cache.backends || [];
  }

  function findBackendById(id) {
    return (cache.backends || []).find((b) => String(b.id) === String(id));
  }

  function setupInlineBackendCreator() {
    const showBtn = document.getElementById('btnShowInlineBackend');
    const cancelBtn = document.getElementById('btnCancelInlineBackend');
    const submitBtn = document.getElementById('btnSubmitInlineBackend');
    if (showBtn) showBtn.addEventListener('click', () => toggleInlineBackendPanel(true));
    if (cancelBtn) cancelBtn.addEventListener('click', () => toggleInlineBackendPanel(false));
    if (submitBtn) submitBtn.addEventListener('click', handleInlineBackendSubmit);
  }

  function setupErrorPageEditor() {
    const textarea = document.getElementById('errorPageTextarea');
    const saveBtn = document.getElementById('btnSaveErrorPage');
    const resetBtn = document.getElementById('btnResetErrorPage');
    if (textarea) {
      textarea.addEventListener('input', updateErrorPagePreview);
    }
    if (saveBtn) saveBtn.addEventListener('click', saveErrorPage);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (!textarea) return;
      textarea.value = '';
      updateErrorPagePreview();
    });
  }

  function toggleInlineBackendPanel(show) {
    const panel = document.getElementById('inlineBackendPanel');
    const callout = document.getElementById('proxyBackendEmpty');
    if (!panel) return;
    panel.hidden = !show;
    if (!show) clearInlineBackendInputs();
    if (callout && (!cache.backends || !cache.backends.length)) {
      callout.hidden = show;
    }
  }

  function clearInlineBackendInputs() {
    const ids = ['inlineBackendName', 'inlineBackendHost', 'inlineBackendPort', 'inlineBackendProtocol'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        if (el.tagName === 'SELECT') el.selectedIndex = 0;
        else if (id === 'inlineBackendPort') el.value = '8080';
        else el.value = '';
      }
    });
  }

  async function handleInlineBackendSubmit() {
    const payload = {
      name: (document.getElementById('inlineBackendName') || {}).value || '',
      targetHost: (document.getElementById('inlineBackendHost') || {}).value || '',
      targetPort: Number((document.getElementById('inlineBackendPort') || {}).value || 0),
      targetProtocol: (document.getElementById('inlineBackendProtocol') || {}).value || 'http'
    };
    payload.name = payload.name.trim();
    payload.targetHost = payload.targetHost.trim();
    if (!payload.name || !payload.targetHost || !payload.targetPort || payload.targetPort <= 0) {
      showToast('Completez le backend', 'error');
      return;
    }
    try {
      const res = await window.api.requestJson('/api/backends', { method: 'POST', body: payload });
      if (res && (res.status === 200 || res.status === 201)) {
        showToast('Backend cree');
        toggleInlineBackendPanel(false);
        await ensureBackendsCached(true);
        await prepareProxyFormPanel();
        const select = document.getElementById('proxyBackendSelect');
        if (select && res.body && res.body.id) {
          select.value = res.body.id;
          handleProxyBackendChange.call(select);
        }
      } else {
        showToast('Creation impossible', 'error');
      }
    } catch (e) {
      showToast('Creation impossible', 'error');
    }
  }

  function isPanelOpen(id) {
    const panel = document.getElementById(id);
    return !!(panel && !panel.hidden);
  }

  function formatBytes(value) {
    let bytes = Number(value) || 0;
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    while (bytes >= 1024 && unitIndex < units.length - 1) {
      bytes /= 1024;
      unitIndex++;
    }
    const display = unitIndex === 0 ? Math.round(bytes) : bytes.toFixed(1);
    return `${display} ${units[unitIndex]}`;
  }

  function formatNumber(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('en-US');
  }

  async function openErrorPageEditor(proxyId, proxyName) {
    currentErrorPageProxyId = proxyId;
    const title = document.getElementById('errorPageTitle');
    if (title) title.textContent = proxyName ? `Page d'erreur · ${proxyName}` : 'Page d’erreur';
    const textarea = document.getElementById('errorPageTextarea');
    if (textarea) {
      textarea.value = '';
      updateErrorPagePreview();
    }
    togglePanel('errorPagePanel', true, '#errorPageTextarea');
    try {
      const res = await window.api.requestJson(`/api/proxies/${proxyId}/error-page`);
      if (textarea) {
        if (res && res.status === 200 && res.body && typeof res.body.html === 'string') {
          textarea.value = res.body.html;
        } else {
          textarea.value = '';
        }
        updateErrorPagePreview();
      }
    } catch (e) {
      if (textarea) textarea.value = '';
      updateErrorPagePreview();
    }
  }

  function updateErrorPagePreview() {
    const textarea = document.getElementById('errorPageTextarea');
    const preview = document.getElementById('errorPagePreview');
    if (!preview) return;
    const html = textarea ? textarea.value || '' : '';
    preview.innerHTML = html || '<p class="muted">Aucun contenu</p>';
  }

  async function saveErrorPage() {
    if (!currentErrorPageProxyId) return;
    const textarea = document.getElementById('errorPageTextarea');
    const html = textarea ? textarea.value : '';
    try {
      await window.api.requestJson(`/api/proxies/${currentErrorPageProxyId}/error-page`, {
        method: 'PUT',
        body: { html }
      });
      showToast('Page d\'erreur mise a jour');
      togglePanel('errorPagePanel', false);
    } catch (e) {
      showToast('Impossible de sauvegarder', 'error');
    }
  }
  // Bot protection save button
  document.addEventListener('click', async (e) => {
    if (e.target.id === 'saveBotConfig') {
      const enabled = document.getElementById('underAttackMode').checked;
      const threshold = parseInt(document.getElementById('botThreshold').value);

      try {
        await window.api.requestJson('/api/bot-protection/toggle', { method: 'POST', body: { enabled } });
        await window.api.requestJson('/api/bot-protection/threshold', { method: 'POST', body: { threshold } });
        showToast('Configuration sauvegardée');
        if (typeof loadBotStats === 'function') loadBotStats();
      } catch (err) {
        console.error('Bot config error:', err);
        showToast('Erreur: ' + err.message, 'error');
      }
    }
  });

  // Refresh bot stats every 5s on security page
  setInterval(() => {
    if (document.body.dataset.page === 'security' && typeof loadBotStats === 'function') {
      loadBotStats();
    }
  }, 5000);

  // ========== REQUEST LOGS PAGE ==========
  let requestLogsState = {
    offset: 0,
    limit: 100,
    days: 30,
    total: 0
  };

  function initRequestsPage() {
    const periodFilter = document.getElementById('periodFilter');
    const refreshBtn = document.getElementById('refreshBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (periodFilter) {
      periodFilter.addEventListener('change', () => {
        requestLogsState.days = parseInt(periodFilter.value);
        requestLogsState.offset = 0;
        loadRequestLogs();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        requestLogsState.offset = 0;
        loadRequestLogs();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (requestLogsState.offset > 0) {
          requestLogsState.offset = Math.max(0, requestLogsState.offset - requestLogsState.limit);
          loadRequestLogs();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (requestLogsState.offset + requestLogsState.limit < requestLogsState.total) {
          requestLogsState.offset += requestLogsState.limit;
          loadRequestLogs();
        }
      });
    }

    loadRequestLogs();
  }

  async function loadRequestLogs() {
    const table = document.getElementById('requestLogsTable');
    const totalCount = document.getElementById('totalCount');
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (!table) return;

    table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Chargement...</td></tr>';

    try {
      const res = await window.api.requestJson(
        `/api/request-logs?limit=${requestLogsState.limit}&offset=${requestLogsState.offset}&days=${requestLogsState.days}`
      );

      if (!res || res.status !== 200) throw new Error('Fetch failed');

      const data = res.body;
      requestLogsState.total = data.total || 0;

      if (totalCount) {
        totalCount.textContent = `Total: ${formatNumber(requestLogsState.total)} combinaisons IP/domaine`;
      }

      if (!data.logs || data.logs.length === 0) {
        table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Aucune requête trouvée</td></tr>';
        if (pageInfo) pageInfo.textContent = '';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
      }

      table.innerHTML = data.logs.map(log => {
        const firstSeen = new Date(log.first_seen);
        const lastSeen = new Date(log.last_seen);
        const countryCode = getCountryFromIP(log.client_ip);
        const flagEmoji = countryCode ? getFlagEmoji(countryCode) : '🌐';
        
        return `
          <tr>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">${flagEmoji}</span>
                <a href="https://check-host.net/check-http?host=${encodeURIComponent(log.client_ip)}" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   style="color: #3b82f6; text-decoration: none; font-family: monospace; cursor: pointer;"
                   title="Voir les infos de ${log.client_ip} sur check-host.net">
                  ${escapeHtml(log.client_ip)}
                </a>
              </div>
            </td>
            <td><strong>${escapeHtml(log.hostname || 'N/A')}</strong></td>
            <td><span style="color: #22c55e; font-weight: 600;">${formatNumber(log.request_count)}</span></td>
            <td style="color: rgba(255,255,255,0.6); font-size: 13px;">${formatDate(firstSeen)}</td>
            <td style="color: rgba(255,255,255,0.6); font-size: 13px;">${formatDate(lastSeen)}</td>
          </tr>
        `;
      }).join('');

      // Update pagination
      const currentPage = Math.floor(requestLogsState.offset / requestLogsState.limit) + 1;
      const totalPages = Math.ceil(requestLogsState.total / requestLogsState.limit);
      
      if (pageInfo) {
        pageInfo.textContent = `Page ${currentPage} sur ${totalPages}`;
      }
      
      if (prevBtn) {
        prevBtn.disabled = requestLogsState.offset === 0;
      }
      
      if (nextBtn) {
        nextBtn.disabled = requestLogsState.offset + requestLogsState.limit >= requestLogsState.total;
      }

    } catch (err) {
      console.error('Error loading request logs:', err);
      table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #ff4444;">Erreur de chargement</td></tr>';
    }
  }

  function formatDate(date) {
    return date.toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getCountryFromIP(ip) {
    // Basic IP geolocation based on known ranges
    // This is a simplified version - for production, use a proper GeoIP service
    if (!ip) return null;
    
    // Cloudflare IPs
    if (ip.startsWith('104.') || ip.startsWith('172.') || ip.startsWith('188.114.')) return 'US';
    
    // Common European ranges
    if (ip.startsWith('82.64.') || ip.startsWith('87.121.')) return 'FR';
    if (ip.startsWith('185.171.')) return 'NL';
    if (ip.startsWith('46.') || ip.startsWith('78.')) return 'DE';
    
    // Private/Local
    if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '127.0.0.1') return 'LOCAL';
    
    return null;
  }

  function getFlagEmoji(countryCode) {
    if (countryCode === 'LOCAL') return '🏠';
    
    const flags = {
      'FR': '🇫🇷', 'US': '🇺🇸', 'GB': '🇬🇧', 'DE': '🇩🇪', 'NL': '🇳🇱',
      'BE': '🇧🇪', 'ES': '🇪🇸', 'IT': '🇮🇹', 'CH': '🇨🇭', 'CA': '🇨🇦',
      'CN': '🇨🇳', 'JP': '🇯🇵', 'RU': '🇷🇺', 'BR': '🇧🇷', 'IN': '🇮🇳',
      'AU': '🇦🇺', 'MX': '🇲🇽', 'KR': '🇰🇷', 'SE': '🇸🇪', 'NO': '🇳🇴',
      'DK': '🇩🇰', 'FI': '🇫🇮', 'PL': '🇵🇱', 'PT': '🇵🇹', 'AT': '🇦🇹',
      'IE': '🇮🇪', 'CZ': '🇨🇿', 'GR': '🇬🇷', 'RO': '🇷🇴', 'HU': '🇭🇺'
    };
    
    return flags[countryCode] || '🌐';
  }

})();

