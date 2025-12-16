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
    } else if (/^\/domain$/i.test(path) || /^\/domain\?/i.test(path)) {
      targetInit = initDomainDetail;
    } else if (/^\/backend$/i.test(path) || /^\/backend\?/i.test(path)) {
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
    console.log('[DEBUG] ====== DOMContentLoaded FIRED ======');
    console.log('[DEBUG] document.body=', document.body);
    const body = document.body || {};
    console.log('[DEBUG] body=', body);
    console.log('[DEBUG] body.dataset=', body.dataset);
    const page = body.dataset ? body.dataset.page : '';
    const path = window.location.pathname;
    console.log('[DEBUG] page=', page, 'path=', path);
    
    if (!page) {
      console.error('[DEBUG] ERROR: page is empty! body.dataset.page not found!');
    }

    console.log('[DEBUG] Calling setupInlineBackendCreator...');
    try {
      setupInlineBackendCreator();
      console.log('[DEBUG] setupInlineBackendCreator OK');
    } catch(e) {
      console.error('[DEBUG] setupInlineBackendCreator ERROR:', e);
    }
    
    console.log('[DEBUG] Calling attachProxyBackendChange...');
    try {
      attachProxyBackendChange();
      console.log('[DEBUG] attachProxyBackendChange OK');
    } catch(e) {
      console.error('[DEBUG] attachProxyBackendChange ERROR:', e);
    }
    
    console.log('[DEBUG] Calling setupErrorPageEditor...');
    try {
      setupErrorPageEditor();
      console.log('[DEBUG] setupErrorPageEditor OK');
    } catch(e) {
      console.error('[DEBUG] setupErrorPageEditor ERROR:', e);
    }

    // Skip initialization for detail pages, wait for partials-loaded event
    console.log('[DEBUG] Testing path regex, path=', path);
    if (/^\/proxies\/\d+$/i.test(path)) {
      console.log('[DEBUG] RETURN: matched /proxies/ID');
      return;
    }
    
    if (/^\/domain\?/i.test(path)) {
      console.log('[DEBUG] RETURN: matched /domain?id=...');
      return;
    }
    
    if (/^\/backend\?/i.test(path)) {
      console.log('[DEBUG] RETURN: matched /backend?id=...');
      return;
    }

    console.log('[DEBUG] About to enter switch, page=', page, 'typeof=', typeof page);
    switch (page) {
      case 'dashboard':
        console.log('[DEBUG] Calling initDashboard');
        initDashboard();
        break;
      case 'proxies':
        console.log('[DEBUG] Calling initProxiesPage');
        initProxiesPage();
        break;
      case 'backends':
        console.log('[DEBUG] Calling initBackendsPage');
        initBackendsPage();
        break;
      case 'domains':
        console.log('[DEBUG] Calling initDomainsPage');
        initDomainsPage();
        break;
      case 'certificates':
        console.log('[DEBUG] Calling initCertsPage');
        initCertsPage();
        break;
      case 'settings':
        console.log('[DEBUG] Calling initSettingsPage');
        initSettingsPage();
        break;
      case 'security':
        console.log('[DEBUG] Calling initSecurityPage');
        window.initSecurityPage();
        break;
      case 'requests':
        console.log('[DEBUG] Calling initRequestsPage');
        initRequestsPage();
        break;
      case 'alerts':
        console.log('[DEBUG] Calling initAlertsPage');
        initAlertsPage();
        break;
      case 'ip-management':
        console.log('[DEBUG] Calling initIpManagementPage');
        initIpManagementPage();
        break;
      case 'reports':
        console.log('[DEBUG] Calling initReportsPage');
        initReportsPage();
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
              label: 'Incoming Traffic',
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
              label: 'Outgoing Traffic',
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
              label: 'Requ�tes/s',
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
              enabled: true,
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(10, 10, 10, 0.95)',
              titleColor: '#ffffff',
              bodyColor: '#ffffff',
              borderColor: 'rgba(255, 255, 255, 0.2)',
              borderWidth: 1,
              padding: 12,
              displayColors: true,
              titleFont: {
                size: 13,
                weight: 'bold'
              },
              bodyFont: {
                size: 12
              },
              callbacks: {
                title: function(context) {
                  return context[0].label || '';
                },
                label: function(context) {
                  let label = context.dataset.label || '';
                  if (label) {
                    label += ': ';
                  }
                  if (context.parsed.y !== null) {
                    if (context.datasetIndex === 2) {
                      // Requests/s
                      label += formatNumber(context.parsed.y) + ' req/s';
                    } else {
                      // Traffic
                      label += formatBytes(context.parsed.y) + '/s';
                    }
                  }
                  return label;
                }
              }
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
    loadLiveActivityStats(); // Start live activity monitoring
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
      const res = await window.api.requestJson(`/api/metrics/combined?${params}`, { skipAuthRedirect: true });
      if (!res) throw new Error('metrics');
      if (res.status === 401) {
        // Not authenticated — skip metrics refresh silently
        return;
      }
      if (res.status !== 200 || !res.body) throw new Error('metrics');
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
    
    // Update live metrics display
    const liveTrafficIn = document.getElementById('live-traffic-in');
    const liveTrafficOut = document.getElementById('live-traffic-out');
    const liveRequests = document.getElementById('live-requests');
    if (liveTrafficIn) liveTrafficIn.textContent = `${formatBytes(inValue)}/s`;
    if (liveTrafficOut) liveTrafficOut.textContent = `${formatBytes(outValue)}/s`;
    if (liveRequests) liveRequests.textContent = `${formatNumber(rpsValue >= 100 ? Math.round(rpsValue) : Number(rpsValue.toFixed(1)))} req/s`;
    
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

  async function loadLiveActivityStats() {
    try {
      // Load live request logs (last 5 minutes - individual requests, not grouped)
      const logsRes = await window.api.requestJson('/api/request-logs/recent?limit=1000&minutes=5', { skipAuthRedirect: true });
      if (!logsRes) throw new Error('no-logs');
      if (logsRes.status === 401) return; // not authenticated, skip
      if (logsRes && logsRes.status === 200 && logsRes.body && logsRes.body.logs) {
        const now = Date.now();

        // Filter out local loopback requests (don't count 127.0.0.1 / ::1 and IPv4-mapped variants)
        const rawLogs = Array.isArray(logsRes.body.logs) ? logsRes.body.logs : [];
        const filteredLogs = rawLogs.filter((log) => {
          const ip = (log.client_ip || log.remote_addr || '').toString().trim();
          if (!ip) return true; // keep logs without ip
          // Normalize common loopback representations
          if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return false;
          if (ip === '::ffff:127.0.0.1') return false;
          // Some proxies may include IPv4-mapped in longer strings, check endsWith
          if (ip.endsWith(':127.0.0.1')) return false;
          return true;
        });

        console.log('[Live Activity] Processing', rawLogs.length, 'recent logs, filtered to', filteredLogs.length, 'logs (loopback removed)');

        // Group by IP address
        const ipStats = {};

        filteredLogs.forEach(log => {
          const timestamp = log.timestamp ? new Date(log.timestamp).getTime() : 0;

          if (!timestamp || isNaN(timestamp)) return;

          const ip = log.client_ip || log.remote_addr || 'unknown';
          if (!ipStats[ip]) {
            ipStats[ip] = {
              ip: ip,
              requests: 0,
              traffic: 0,
              lastSeen: timestamp
            };
          }
          ipStats[ip].requests++;
          ipStats[ip].traffic += (log.bytes_sent || 0) + (log.bytes_received || 0);
          if (timestamp > ipStats[ip].lastSeen) {
            ipStats[ip].lastSeen = timestamp;
          }
        });

        console.log('[Live Activity] Found', Object.keys(ipStats).length, 'unique IPs');

        // Sort by requests
        const sortedIps = Object.values(ipStats).sort((a, b) => b.requests - a.requests).slice(0, 10);
        
        const ipTable = document.getElementById('liveIpStats');
        const ipEmpty = document.getElementById('liveIpStatsEmpty');
        
        if (sortedIps.length === 0) {
          if (ipTable) ipTable.querySelector('tbody').innerHTML = '';
          if (ipEmpty) ipEmpty.hidden = false;
        } else {
          if (ipEmpty) ipEmpty.hidden = true;
          if (ipTable) {
            ipTable.querySelector('tbody').innerHTML = sortedIps.map(stat => {
              const secondsAgo = Math.max(0, Math.round((now - stat.lastSeen) / 1000));
              return `
              <tr>
                <td><code>${escapeHtml(stat.ip)}</code></td>
                <td><strong>${stat.requests}</strong></td>
                <td>${formatBytes(stat.traffic)}</td>
                <td><span style="color: var(--text-muted); font-size: 12px;">${secondsAgo}s ago</span></td>
              </tr>
              `;
            }).join('');
          }
        }

        // Group by domain (use filteredLogs so domains called only by loopback are excluded)
        const domainStats = {};
        filteredLogs.forEach(log => {
          const timestamp = log.timestamp ? new Date(log.timestamp).getTime() : 0;

          if (!timestamp || isNaN(timestamp)) return;

          const domain = log.hostname || log.host || 'unknown';
          if (!domainStats[domain]) {
            domainStats[domain] = {
              domain: domain,
              requests: 0,
              traffic: 0,
              lastRequest: timestamp
            };
          }
          domainStats[domain].requests++;
          domainStats[domain].traffic += (log.bytes_sent || 0) + (log.bytes_received || 0);
          if (timestamp > domainStats[domain].lastRequest) {
            domainStats[domain].lastRequest = timestamp;
          }
        });

        // Sort by requests
        const sortedDomains = Object.values(domainStats).sort((a, b) => b.requests - a.requests).slice(0, 10);
        
        console.log('[Live Activity] Found', Object.keys(domainStats).length, 'unique domains');
        
        const domainTable = document.getElementById('liveDomainStats');
        const domainEmpty = document.getElementById('liveDomainStatsEmpty');
        
        if (sortedDomains.length === 0) {
          if (domainTable) domainTable.querySelector('tbody').innerHTML = '';
          if (domainEmpty) domainEmpty.hidden = false;
        } else {
          if (domainEmpty) domainEmpty.hidden = true;
          if (domainTable) {
            domainTable.querySelector('tbody').innerHTML = sortedDomains.map(stat => {
              const secondsAgo = Math.max(0, Math.round((now - stat.lastRequest) / 1000));
              return `
              <tr>
                <td><strong>${escapeHtml(stat.domain)}</strong></td>
                <td><strong>${stat.requests}</strong></td>
                <td>${formatBytes(stat.traffic)}</td>
                <td><span style="color: var(--text-muted); font-size: 12px;">${secondsAgo}s ago</span></td>
              </tr>
              `;
            }).join('');
          }
        }
      }
    } catch (err) {
      console.error('Error loading live activity stats:', err);
    }

    // Refresh every 5 seconds
    if (dashboardState.liveActivityTimer) clearTimeout(dashboardState.liveActivityTimer);
    dashboardState.liveActivityTimer = setTimeout(loadLiveActivityStats, 5000);
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
    console.log('[DEBUG] ====== initBackendsPage CALLED ======');
    await loadBackends();
    console.log('[DEBUG] loadBackends done');
    const form = document.getElementById('createBackendForm');
    if (form) form.addEventListener('submit', createBackendFromForm);

    document.addEventListener('click', async (ev) => {
      if ((document.body.dataset.page || '') !== 'backends') return;

      const btn = ev.target.closest && ev.target.closest('.delete-backend');
      if (!btn || !btn.dataset.id) return;
      if (!confirm('Delete ce backend ?')) return;
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
      showToast('Error technique', 'error');
    }
  }

  async function initDomainsPage() {
    console.log('[DEBUG] ====== initDomainsPage CALLED ======');
    await populateDomainSelects();
    console.log('[DEBUG] populateDomainSelects done');
    await loadDomains();
    console.log('[DEBUG] loadDomains done');
    const createForm = document.getElementById('createDomainForm');
    if (createForm) createForm.addEventListener('submit', createDomainFromForm);

    // Wire maintenance toggle UI in the create panel
    const createMaintenanceToggle = document.getElementById('domainMaintenanceEnabled');
    const createMaintenanceText = document.getElementById('domainMaintenanceStatusText');
    if (createMaintenanceToggle) {
      createMaintenanceToggle.addEventListener('change', () => {
        if (createMaintenanceText) createMaintenanceText.textContent = createMaintenanceToggle.checked ? 'Enabled' : 'Disabled';
      });
    }

    document.addEventListener('click', async (ev) => {
      if ((document.body.dataset.page || '') !== 'domains') return;

      // Handle delete button (both table and card)
      const deleteBtn = ev.target.closest && ev.target.closest('.delete-domain, .delete-domain-card');
      if (deleteBtn && deleteBtn.dataset.id) {
        if (!confirm('Delete this domain?')) return;
        const res = await window.api.requestJson(`/api/domains/${deleteBtn.dataset.id}`, { method: 'DELETE' });
        if (res && (res.status === 200 || res.status === 204)) {
          showToast('Domain deleted');
          await loadDomains();
        } else {
          showToast('Deletion failed', 'error');
        }
        return;
      }

      // Handle maintenance button (both table and card)
      const maintenanceBtn = ev.target.closest && ev.target.closest('.manage-maintenance, .manage-maintenance-card');
      if (maintenanceBtn && maintenanceBtn.dataset.id) {
        await openMaintenancePanel(maintenanceBtn.dataset.id, maintenanceBtn.dataset.hostname);
        return;
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
      toggleEmpty(empty, rows.length > 0, 'No proxy configured.');
      if (!rows.length) return;
      rows.forEach((p) => {
        const statusClass = p.enabled ? 'success' : 'muted';
        const statusLabel = p.enabled ? 'Active' : 'Inactive';
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
            <button class="btn ghost small edit-proxy" data-id="${p.id}">Manage</button>
            <button class="btn ghost small edit-error-page" data-id="${p.id}" data-name="${escapeHtml(p.name || '')}">Error</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      toggleEmpty(empty, false, 'Failed to load proxies.');
      showToast('Failed to load proxies', 'error');
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
    const PortEl = document.getElementById('smtpPort') || form.elements && form.elements['Port'];
    const secureEl = document.getElementById('smtpSecure') || form.elements && form.elements['secure'];
    const userEl = document.getElementById('smtpUser') || form.elements && form.elements['user'];
    const passEl = document.getElementById('smtpPass') || form.elements && form.elements['pass'];
    const fromEl = document.getElementById('smtpFrom') || form.elements && form.elements['from'];
    const toEl = document.getElementById('smtpTo') || form.elements && form.elements['to'];
    if (hostEl) hostEl.value = cfg.host || '';
    if (PortEl) PortEl.value = cfg.Port || '';
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
    const PortEl = document.getElementById('smtpPort') || form.elements && form.elements['Port'];
    const secureEl = document.getElementById('smtpSecure') || form.elements && form.elements['secure'];
    const userEl = document.getElementById('smtpUser') || form.elements && form.elements['user'];
    const passEl = document.getElementById('smtpPass') || form.elements && form.elements['pass'];
    const fromEl = document.getElementById('smtpFrom') || form.elements && form.elements['from'];
    const toEl = document.getElementById('smtpTo') || form.elements && form.elements['to'];
    const payload = {
      smtp: {
        host: (hostEl && (hostEl.value || '') || '').trim(),
        Port: Number(PortEl && PortEl.value) || 0,
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
        showToast('Impossible d\'Add', 'error');
      }
    } catch (e) {
      showToast('Impossible d\'Add', 'error');
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
  // === Bot Protection MANAGEMENT ===
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
        if (statusEl) statusEl.textContent = stats.isUnderAttack ? '?? Under Attack' : '?? Normal';
        if (modeEl) modeEl.checked = stats.enabled;
        if (thresholdEl) thresholdEl.value = stats.threshold;
      }
    } catch (e) {
      console.error('Failed to load bot stats', e);
    }
  };

  async function loadBackends() {
    console.log('[DEBUG] loadBackends: Starting...');
    const tbody = document.querySelector('#backendsTable tbody');
    const empty = document.getElementById('backendsEmpty');
    console.log('[DEBUG] loadBackends: tbody=', tbody, 'empty=', empty);
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const rows = await fetchAndCache('/api/backends', 'backends');
      console.log('[DEBUG] loadBackends: Received rows=', rows);
      toggleEmpty(empty, rows.length > 0, 'No backend defined.');
      if (!rows.length) return;
      rows.forEach((b) => {
        console.log('[DEBUG] loadBackends: Processing backend=', b);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHtml(b.name || '')}</strong></td>
          <td class="mono">${escapeHtml(b.target_host || '')}:${b.target_port || ''}</td>
          <td>${escapeHtml((b.target_protocol || '').toUpperCase())}</td>
          <td>
            <a class="btn ghost small" href="/backend?id=${b.id}">Manage</a>
            <button class="btn ghost small delete-backend" data-id="${b.id}">Delete</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      console.log('[DEBUG] loadBackends: Done, rendered', rows.length, 'rows');
    } catch (e) {
      console.error('[DEBUG] loadBackends: Error=', e);
      toggleEmpty(empty, false, 'Unable to load backends.');
      showToast('Backend loading failed', 'error');
    }
  }

  async function loadDomains() {
    console.log('[DEBUG] loadDomains: Starting...');
    const grid = document.getElementById('domainsGrid');
    const empty = document.getElementById('domainsEmpty');
    console.log('[DEBUG] loadDomains: grid=', grid, 'empty=', empty);
    if (!grid) return;
    grid.innerHTML = '';
    try {
      const res = await window.api.requestJson('/api/domains');
      console.log('[DEBUG] loadDomains: API response=', res);
      if (!res || res.status !== 200) throw new Error('loadDomains');
      const rows = Array.isArray(res.body) ? res.body : [];
      console.log('[DEBUG] loadDomains: Parsed rows=', rows);
      toggleEmpty(empty, rows.length > 0, 'No domain configured.');
      if (!rows.length) return;
      const proxyMap = new Map((cache.proxies || []).map((p) => [String(p.id), p]));
      const backendMap = new Map((cache.backends || []).map((b) => [String(b.id), b]));
      console.log('[DEBUG] loadDomains: proxyMap=', proxyMap, 'backendMap=', backendMap);

      rows.forEach((d) => {
        console.log('[DEBUG] loadDomains: Processing domain=', d);
        const proxy = proxyMap.get(String(d.proxy_id));
        const backend = backendMap.get(String(d.backend_id));
        const backendLabel = backend
          ? `${escapeHtml(backend.name || '')} (${escapeHtml(backend.target_host || '')}:${backend.target_port || ''})`
          : `${escapeHtml(d.target_host || '')}:${d.target_port || ''}`;

        // Bot Protection status
        const botProtection = d.bot_protection || 'unprotected';
        let protectionBadge = '';
        let protectionText = '';
        if (botProtection === 'protected') {
          protectionBadge = 'warning';
          protectionText = 'Protected';
        } else {
          protectionBadge = 'success';
          protectionText = 'Open';
        }

        // Maintenance status
        const maintenanceEnabled = d.maintenance_enabled || false;
        const maintenanceBadge = maintenanceEnabled ? 'warning' : 'success';
        const maintenanceText = maintenanceEnabled ? 'Active' : 'Disabled';

        const card = document.createElement('div');
        card.className = 'domain-card';
        card.dataset.domainId = d.id;
        card.innerHTML = `
          <div class="domain-card-preview">
            <div class="domain-card-preview-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18"/>
                <circle cx="7" cy="6" r="0.5" fill="currentColor"/>
                <circle cx="9" cy="6" r="0.5" fill="currentColor"/>
                <circle cx="11" cy="6" r="0.5" fill="currentColor"/>
              </svg>
              <span>${escapeHtml(d.hostname || '')}</span>
            </div>
          </div>
          <div class="domain-card-content">
            <h3 class="domain-card-hostname">${escapeHtml(d.hostname || '')}</h3>
            <div class="domain-card-meta">
              <div class="domain-card-meta-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 4h16v6H4zM4 14h16v6H4z"/>
                </svg>
                <span>${proxy ? escapeHtml(proxy.name || '') : `Proxy #${d.proxy_id}`}</span>
              </div>
              <div class="domain-card-meta-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                <span>${backendLabel}</span>
              </div>
            </div>
            <div class="domain-card-badges">
              <span class="status-badge ${protectionBadge}"><span class="status-dot"></span>${protectionText}</span>
              <span class="status-badge ${maintenanceBadge}"><span class="status-dot"></span>${maintenanceText}</span>
            </div>
            <div class="domain-card-actions">
              <button class="btn ghost small manage-maintenance-card" data-id="${d.id}" data-hostname="${escapeHtml(d.hostname || '')}">Maintenance</button>
              <button class="btn ghost small delete-domain-card" data-id="${d.id}">Delete</button>
            </div>
          </div>
        `;

        // Click on card (but not buttons) to navigate
        card.addEventListener('click', (e) => {
          if (!e.target.closest('.btn')) {
            window.location.href = `/domain?id=${d.id}`;
          }
        });

        grid.appendChild(card);

        // Try to load preview after a short delay
        setTimeout(() => loadDomainPreview(d.hostname, card), 100);
      });
    } catch (e) {
      toggleEmpty(empty, false, 'Impossible de charger les Domains.');
      showToast('Loading des Domains impossible', 'error');
    }
  }

  async function loadDomainPreview(hostname, card, retryCount = 0) {
    const previewDiv = card.querySelector('.domain-card-preview');
    const domainId = card.dataset.domainId;
    if (!previewDiv || !hostname || !domainId) return;

    const maxRetries = 3;
    const retryDelay = 2000 * (retryCount + 1); // 2s, 4s, 6s

    try {
      // Request screenshot from API (inline to avoid extra image request through proxy)
      const res = await window.api.requestJson(`/api/domains/${domainId}/screenshot?inline=1`);
      console.log(`[Screenshot] API response for ${hostname} (attempt ${retryCount + 1}):`, res);

      if (res && res.status === 200 && res.body && res.body.path) {
        console.log(`[Screenshot] Loading image for ${hostname} from:`, res.body.path);

        // Create image element for screenshot
        const img = document.createElement('img');
        // Add cache buster for retries to force reload
        const cacheBuster = retryCount > 0 ? `?t=${Date.now()}` : '';

        // If server returned inline data URL, use it to avoid another HTTP request
        if (res.body.inline) {
          img.src = res.body.inline;
        } else {
          // Attempt to fetch the image via fetch() and set a blob URL.
          // This gives clearer error reporting and works around some image loading quirks.
          const imgUrl = res.body.path + cacheBuster;
          console.log(`[Screenshot] Fetching image blob for ${hostname} from:`, imgUrl);
          fetch(imgUrl, { credentials: 'same-origin' })
            .then(response => {
              console.log(`[Screenshot] Fetch response for ${hostname}:`, response.status);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.blob();
            })
            .then(blob => {
              const objectUrl = URL.createObjectURL(blob);
              img.src = objectUrl;
            })
            .catch(err => {
              console.error(`[Screenshot] Failed to fetch blob for ${hostname}:`, err);
              // Fallback: set src directly to the path (may trigger browser image load)
              img.src = imgUrl;
            });
        }
        img.alt = `Preview of ${hostname}`;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.loading = 'lazy';

        // Append the image element immediately so the DOM contains the <img>
        // even if loading fails; this makes debugging and fallbacks clearer.
        previewDiv.appendChild(img);

        // Replace placeholder with screenshot on load
        img.onload = () => {
          console.log(`[Screenshot] Image loaded successfully for ${hostname}`);
          const placeholder = previewDiv.querySelector('.domain-card-preview-placeholder');
          if (placeholder) {
            placeholder.remove();
          }
        };

        // If image fails to load, retry with exponential backoff
        img.onerror = (e) => {
          console.error(`[Screenshot] Failed to load image for ${hostname} (attempt ${retryCount + 1}):`, img.src);

          if (retryCount < maxRetries) {
            console.log(`[Screenshot] Retrying in ${retryDelay}ms...`);
            setTimeout(() => {
              loadDomainPreview(hostname, card, retryCount + 1);
            }, retryDelay);
          } else {
            console.error(`[Screenshot] Max retries reached for ${hostname}`);
          }
        };
      } else if (res && res.status === 503) {
        // Service unavailable, screenshot still being generated
        console.log(`[Screenshot] Screenshot still being generated for ${hostname}, retrying...`);
        if (retryCount < maxRetries) {
          setTimeout(() => {
            loadDomainPreview(hostname, card, retryCount + 1);
          }, retryDelay);
        }
      } else {
        console.warn(`[Screenshot] Invalid response for ${hostname}:`, res);
      }
    } catch (error) {
      console.error(`[Screenshot] Error fetching screenshot for ${hostname}:`, error);
      // Retry on error
      if (retryCount < maxRetries) {
        setTimeout(() => {
          loadDomainPreview(hostname, card, retryCount + 1);
        }, retryDelay);
      }
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
      toggleEmpty(empty, false, 'Impossible de charger les Certificates.');
      showToast('Loading des Certificates impossible', 'error');
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
      showToast('Loading des parametres impossible', 'error');
    }
  }

  async function createProxyFromForm(ev) {
    ev.preventDefault();
    const form = ev.target;
    const payload = formDataToObject(new FormData(form));
    // Normalize checkbox value for certificate generation
    const generateCert = payload.generateCert === 'on' || payload.generateCert === 'true' || payload.generateCert === true;
    delete payload.generateCert;
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
    // Normalize checkbox value for certificate generation (create domain form)
    const generateCert = payload.generateCert === 'on' || payload.generateCert === 'true' || payload.generateCert === true;
    delete payload.generateCert;
    if (!payload.backendId) {
      showToast('Choisissez un backend', 'error');
      return;
    }
    
    // Handle Bot Protection setting
    const botProtection = payload.botProtection || 'unprotected';
    const maintenanceEnabled = !!payload.maintenanceEnabled;
    const maintenancePagePath = payload.maintenancePagePath || null;
    const hostname = payload.hostname;
    delete payload.botProtection;
    delete payload.maintenanceEnabled;
    delete payload.maintenancePagePath;
    
    try {
      const res = await window.api.requestJson('/api/domains', { method: 'POST', body: { ...payload, maintenanceEnabled, maintenancePagePath, generateCert } });
      if (res && (res.status === 200 || res.status === 201)) {
        console.log(`[Domains] Created domain: ${hostname}, protection: ${botProtection}`);
        
        // Apply Bot Protection setting
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
      window.location.href = '/backends';
      return;
    }

    try {
      const backends = await fetchAndCache('/api/backends', 'backends');
      const backend = backends.find(b => String(b.id) === String(backendId));
      if (!backend) {
        showToast('Backend introuvable', 'error');
        window.location.href = '/backends';
        return;
      }

      const idField = document.getElementById('editBackendId');
      const nameField = document.getElementById('editBackendName');
      const hostField = document.getElementById('editBackendHost');
      const PortField = document.getElementById('editBackendPort');
      const protocolField = document.getElementById('editBackendProtocol');

      if (!idField || !nameField || !hostField || !PortField || !protocolField) {
        console.error('[Backend Detail] Required form fields not found', {
          idField: !!idField,
          nameField: !!nameField,
          hostField: !!hostField,
          PortField: !!PortField,
          protocolField: !!protocolField,
          bodyHTML: document.body ? 'exists' : 'missing'
        });
        return;
      }

      idField.value = backend.id;
      nameField.value = backend.name || '';
      hostField.value = backend.targetHost || backend.target_host || '';
      PortField.value = backend.targetPort || backend.target_port || '';
      protocolField.value = backend.targetProtocol || backend.target_protocol || 'http';
    } catch (e) {
      console.error('[Backend Detail] Failed to load:', e);
      showToast('Error lors du Loading', 'error');
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
        showToast('Backend mis � jour');
        window.location.href = '/backends';
      } else {
        showToast('Mise � jour impossible', 'error');
      }
    } catch (e) {
      console.error('[Backend Detail] Update error:', e);
      showToast('Mise � jour impossible', 'error');
    }
  }

  async function deleteBackendDetail() {
    const backendId = document.getElementById('editBackendId').value;
    const backendName = document.getElementById('editBackendName').value;
    if (!confirm(`Delete le backend "${backendName}" ?`)) return;
    
    try {
      const res = await window.api.requestJson(`/api/backends/${backendId}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        showToast('Backend supprime');
        window.location.href = '/backends';
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
      
      if (cert && cert.certificate_exists) {
        const status = (cert.status || 'unknown').toLowerCase();
        let badge = 'muted';
        let statusText = cert.status ? cert.status.toUpperCase() : 'UNKNOWN';

        // Determine badge color based on status
        if (status === 'valid') {
          badge = 'success';
        } else if (status === 'warning') {
          badge = 'warning';
        } else if (status === 'critical' || status === 'expired') {
          badge = 'error';
        } else if (status === 'missing') {
          badge = 'muted';
        }

        // Format expiry info with days remaining
        let expiryText = 'N/A';
        if (cert.valid_until) {
          const expiryDate = new Date(cert.valid_until);
          expiryText = expiryDate.toLocaleString('fr-FR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          if (cert.expires_in_days !== null && cert.expires_in_days !== undefined) {
            if (cert.expires_in_days < 0) {
              expiryText += ` (expiré depuis ${Math.abs(cert.expires_in_days)} jours)`;
            } else if (cert.expires_in_days === 0) {
              expiryText += ` (expire aujourd'hui!)`;
            } else if (cert.expires_in_days === 1) {
              expiryText += ` (expire demain!)`;
            } else {
              expiryText += ` (${cert.expires_in_days} jours restants)`;
            }
          }
        }

        document.getElementById('domainCertStatus').innerHTML =
          `<span class="status-badge ${badge}"><span class="status-dot"></span>${escapeHtml(statusText)}</span>`;
        document.getElementById('domainCertExpiry').textContent = expiryText;
        
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

  async function imPortDomainCertificate() {
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
      showToast('Le certificat et la cl� priv�e sont requis', 'error');
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
        showToast('Certificat imPort� avec succ�s', 'success');
        await loadDomainCertificate();
      } else {
        throw new Error('ImPort failed');
      }
    } catch (e) {
      console.error('[Domain Cert] ImPort failed:', e);
      showToast('�chec de l\'imPortation du certificat', 'error');
    }
  }

  function showCertImPortForm() {
    const certInfo = document.getElementById('domainCertInfo');
    const certEmpty = document.getElementById('domainCertEmpty');
    
    if (certInfo && certEmpty) {
      certInfo.hidden = false;
      certEmpty.hidden = true;
      
      // Vider les champs pour l'imPort
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
      window.location.href = '/domains';
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
        window.location.href = '/domains';
        return;
      }

      // Populate selects
      const proxySelect = document.getElementById('editDomainProxySelect');
      const backendSelect = document.getElementById('editDomainBackendSelect');
      if (proxySelect && backendSelect) {
        proxySelect.innerHTML = '';
        backendSelect.innerHTML = '<option value="">S�lectionner...</option>';
        
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
      const maintenanceEnabledField = document.getElementById('editDomainMaintenanceEnabled');
      const maintenancePathField = document.getElementById('editDomainMaintenancePagePath');
      const maintenanceContentField = document.getElementById('editDomainMaintenancePageContent');
      const loadMaintenanceBtn = document.getElementById('btnLoadMaintenancePage');
      const clearMaintenanceBtn = document.getElementById('btnClearMaintenancePage');
      const uploadMaintenanceBtn = document.getElementById('btnUploadMaintenancePage');
      const deleteMaintenanceBtn = document.getElementById('btnDeleteMaintenancePage');

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
      if (maintenanceEnabledField) maintenanceEnabledField.checked = !!domain.maintenance_enabled;
      if (maintenancePathField) maintenancePathField.value = domain.maintenance_page_path || '';

      // Update page header title with domain name
      const headerTitle = document.getElementById('domainHeaderTitle');
      if (headerTitle && domain.hostname) {
        headerTitle.textContent = domain.hostname;
      }

      // Update status text
      const maintenanceStatusText = document.getElementById('editDomainMaintenanceStatusText');
      if (maintenanceStatusText) maintenanceStatusText.textContent = maintenanceEnabledField && maintenanceEnabledField.checked ? 'Activé' : 'Désactivé';

      if (maintenanceEnabledField) {
        maintenanceEnabledField.addEventListener('change', () => {
          if (maintenanceStatusText) maintenanceStatusText.textContent = maintenanceEnabledField.checked ? 'Activé' : 'Désactivé';
        });
      }

      // Wire maintenance buttons
      if (loadMaintenanceBtn) {
        loadMaintenanceBtn.addEventListener('click', async () => {
          try {
            const resp = await window.api.get(`/api/maintenance/page/${domain.id}`);
            if (resp && resp.content !== undefined) {
              if (maintenanceContentField) maintenanceContentField.value = resp.content || '';
              if (maintenancePathField && resp.path) maintenancePathField.value = resp.path;
              showToast('Maintenance page loaded');
            } else {
              showToast('No maintenance page found', 'error');
            }
          } catch (e) {
            console.error('Load maintenance page error', e);
            showToast('Impossible de charger la page', 'error');
          }
        });
      }

      if (clearMaintenanceBtn) {
        clearMaintenanceBtn.addEventListener('click', () => {
          if (maintenanceContentField) maintenanceContentField.value = '';
          showToast('Content cleared');
        });
      }

      if (uploadMaintenanceBtn) {
        uploadMaintenanceBtn.addEventListener('click', async () => {
          if (!maintenanceContentField) return showToast('Nothing to upload', 'error');
          const htmlContent = maintenanceContentField.value || '';
          try {
            const res = await window.api.post(`/api/maintenance/page/${domain.id}`, { htmlContent });
            if (res && res.path) {
              if (maintenancePathField) maintenancePathField.value = res.path;
              showToast('Maintenance page uploaded');
            } else {
              showToast('Upload failed', 'error');
            }
          } catch (e) {
            console.error('Upload maintenance page error', e);
            showToast('Upload failed', 'error');
          }
        });
      }

      if (deleteMaintenanceBtn) {
        deleteMaintenanceBtn.addEventListener('click', async () => {
          if (!confirm('Delete custom maintenance page for this domain?')) return;
          try {
            const res = await window.api.requestJson(`/api/maintenance/page/${domain.id}`, { method: 'DELETE' });
            if (res && res.status >= 200 && res.status < 300) {
              if (maintenancePathField) maintenancePathField.value = '';
              if (maintenanceContentField) maintenanceContentField.value = '';
              showToast('Maintenance page deleted');
            } else {
              showToast('Delete failed', 'error');
            }
          } catch (e) {
            console.error('Delete maintenance page error', e);
            showToast('Delete failed', 'error');
          }
        });
      }
    } catch (e) {
      console.error('[Domain Detail] Failed to load:', e);
      showToast('Error lors du Loading', 'error');
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
    const maintenanceEnabled = !!payload.maintenanceEnabled || !!document.getElementById('editDomainMaintenanceEnabled')?.checked;
    const maintenancePagePath = payload.maintenancePagePath || document.getElementById('editDomainMaintenancePagePath')?.value || null;
    const hostname = payload.hostname;
    delete payload.id;
    delete payload.botProtection;
    delete payload.maintenanceEnabled;
    delete payload.maintenancePagePath;
    
    try {
      const res = await window.api.requestJson(`/api/domains/${domainId}`, { 
        method: 'PUT', 
        body: { ...payload, botProtection, maintenanceEnabled, maintenancePagePath }
      });
      
      if (res && (res.status === 200 || res.status === 201)) {
        // Update Bot Protection lists
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
        
        showToast('Domaine mis � jour');
        window.location.href = '/domains';
      } else {
        showToast('Mise � jour impossible', 'error');
      }
    } catch (e) {
      console.error('[Domain Detail] Update error:', e);
      showToast('Mise � jour impossible', 'error');
    }
  }

  async function deleteDomainDetail() {
    const domainId = document.getElementById('editDomainId').value;
    const hostname = document.getElementById('editDomainHostname').value;
    if (!confirm(`Delete le domaine "${hostname}" ?`)) return;
    
    try {
      const res = await window.api.requestJson(`/api/domains/${domainId}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        // Clean up Bot Protection lists
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
        window.location.href = '/domains';
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
    backendSelect.innerHTML = '<option value="">Select...</option>';
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
    console.log('[DEBUG] fetchAndCache: endpoint=', endpoint, 'cacheKey=', cacheKey);
    const res = await window.api.requestJson(endpoint);
    console.log('[DEBUG] fetchAndCache: response=', res);
    if (!res || res.status !== 200) throw new Error(`fetch-failed:${endpoint}`);
    const rows = Array.isArray(res.body) ? res.body : [];
    console.log('[DEBUG] fetchAndCache: rows=', rows, 'length=', rows.length);
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
      if (document.getElementById('editTargetHost')) document.getElementById('editTargetHost').value = proxy.target_host || '';
      if (document.getElementById('editTargetPort')) document.getElementById('editTargetPort').value = proxy.target_port || '';
      const enabledCheckbox = document.getElementById('editEnabled');
      if (enabledCheckbox) {
        enabledCheckbox.checked = proxy.enabled === true;
      }

      const saveBtn = document.getElementById('btnSaveProxy');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const form = document.getElementById('editProxyForm');
          const payload = formDataToObject(new FormData(form));
          // Manually handle checkbox since unchecked checkboxes aren't in FormData
          const enabledCheckbox = document.getElementById('editEnabled');
          payload.enabled = enabledCheckbox ? enabledCheckbox.checked : false;
          
          const resp = await window.api.requestJson(`/api/proxies/${id}`, { method: 'PUT', body: payload });
          if (resp && resp.status === 200) {
            showToast('Proxy enregistre');
            window.location.href = '/proxies';
          } else {
            showToast('Impossible de Save', 'error');
          }
        });
      }

      const delBtn = document.getElementById('btnDeleteProxy');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete ce proxy ?')) return;
          const resp = await window.api.requestJson(`/api/proxies/${id}`, { method: 'DELETE' });
          if (resp && (resp.status === 200 || resp.status === 204)) {
            showToast('Proxy supprime');
            window.location.href = '/proxies';
          } else {
            showToast('Suppression impossible', 'error');
          }
        });
      }
    } catch (e) {
      showToast('Loading du proxy impossible', 'error');
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

    const imPortCertBtn = document.getElementById('btnImPortDomainCert');
    if (imPortCertBtn) {
      imPortCertBtn.addEventListener('click', imPortDomainCertificate);
    }

    const showImPortBtn = document.getElementById('btnShowCertImPort');
    if (showImPortBtn) {
      showImPortBtn.addEventListener('click', showCertImPortForm);
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
        showToast('Certificat imPorte');
        form.reset();
        togglePanel('manualCertPanel', false);
        await loadCerts();
      } else {
        showToast('ImPort impossible', 'error');
      }
    } catch (e) {
      showToast('ImPort impossible', 'error');
    }
  }

  async function loadDomainInsights(targetConfig) {
    const configList = Array.isArray(targetConfig) ? targetConfig : (targetConfig ? [targetConfig] : []);
    const usable = configList.filter((t) => t && document.getElementById(t.tableId));
    if (!usable.length) return;
    if (!usable.length) return;
    try {
      const res = await window.api.requestJson('/api/metrics/domains?last=86400&interval=3600', { skipAuthRedirect: true });
      if (!res) throw new Error('domain-stats');
      if (res.status === 401) return; // not authenticated, skip
      if (res.status !== 200) throw new Error('domain-stats');
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
    const PortInput = document.getElementById('targetPort');
    if (!hostInput || !PortInput) return;
    hostInput.readOnly = true;
    PortInput.readOnly = true;
    hostInput.classList.add('input-locked');
    PortInput.classList.add('input-locked');
    hostInput.value = backend ? backend.targetHost || backend.target_host || '' : '';
    PortInput.value = backend ? backend.targetPort || backend.target_port || '' : '';
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
    if (title) title.textContent = proxyName ? `Page d'Error � ${proxyName}` : 'Page d�Error';
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
      showToast('Page d\'Error mise a jour');
      togglePanel('errorPagePanel', false);
    } catch (e) {
      showToast('Impossible de Save', 'error');
    }
  }
  // Bot Protection save button
  document.addEventListener('click', async (e) => {
    if (e.target.id === 'saveBotConfig') {
      const enabled = document.getElementById('underAttackMode').checked;
      const threshold = parseInt(document.getElementById('botThreshold').value);

      try {
        await window.api.requestJson('/api/bot-protection/toggle', { method: 'POST', body: { enabled } });
        await window.api.requestJson('/api/bot-protection/threshold', { method: 'POST', body: { threshold } });
        showToast('Configuration sauvegard�e');
        if (typeof loadBotStats === 'function') loadBotStats();
      } catch (err) {
        console.error('Bot config error:', err);
        showToast('Error: ' + err.message, 'error');
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
    const clearRequestsBtn = document.getElementById('clearRequestsBtn');
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

    if (clearRequestsBtn) {
      clearRequestsBtn.addEventListener('click', async () => {
        if (!confirm('Clear all request logs from view? (Data will be kept in database)')) return;
        
        try {
          const res = await window.api.requestJson('/api/request-logs/dismiss', { method: 'POST' });
          if (res && res.status === 200) {
            showToast(`✅ Cleared ${res.body.dismissed} request logs`, 'success');
            loadRequestLogs();
          } else {
            throw new Error('Failed to clear request logs');
          }
        } catch (err) {
          console.error('Error clearing request logs:', err);
          showToast('❌ Error: ' + err.message, 'error');
        }
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

    table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Loading...</td></tr>';

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
        table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">No requests found</td></tr>';
        if (pageInfo) pageInfo.textContent = '';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
      }

      // Render table immediately with placeholder flags
      table.innerHTML = data.logs.map((log) => {
        const firstSeen = new Date(log.first_seen);
        const lastSeen = new Date(log.last_seen);
        
        return `
          <tr data-ip="${escapeHtml(log.client_ip)}">
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="flag-placeholder" style="width: 24px; text-align: center;">⏳</span>
                <a href="https://check-host.net/check-http?host=${encodeURIComponent(log.client_ip)}" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   style="color: #3b82f6; text-decoration: none; font-family: monospace; cursor: pointer;"
                   title="View info for ${log.client_ip} on check-host.net">
                  ${escapeHtml(log.client_ip)}
                </a>
              </div>
            </td>
            <td><strong>${escapeHtml(log.hostname || 'N/A')}</strong></td>
            <td><span style="color: #22c55e; font-weight: 600;">${formatNumber(log.request_count)}</span></td>
            <td style="color: rgba(255,255,255,0.6); font-size: 13px;">${formatDate(firstSeen)}</td>
            <td style="color: rgba(255,255,255,0.6); font-size: 13px;">${formatDate(lastSeen)}</td>
            <td style="text-align: center;">
              <div class="dropdown" style="position: relative; display: inline-block;">
                <button class="btn-icon" onclick="toggleDropdown(event, '${escapeHtml(log.client_ip).replace(/'/g, "\\'")}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="1" fill="currentColor"/>
                    <circle cx="12" cy="5" r="1" fill="currentColor"/>
                    <circle cx="12" cy="19" r="1" fill="currentColor"/>
                  </svg>
                </button>
                <div class="dropdown-menu" id="dropdown-${escapeHtml(log.client_ip)}" style="display: none;">
                  <button onclick="addToWhitelist('${escapeHtml(log.client_ip).replace(/'/g, "\\'")}')">✅ Add to Whitelist</button>
                  <button onclick="addToBlacklist('${escapeHtml(log.client_ip).replace(/'/g, "\\'")}')">🚫 Block IP</button>
                </div>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Fetch country codes progressively (rate-limited by queue)
      data.logs.forEach(async (log) => {
        const countryCode = await getCountryFromIP(log.client_ip);
        const row = table.querySelector(`tr[data-ip="${log.client_ip}"]`);
        if (row) {
          const placeholder = row.querySelector('.flag-placeholder');
          if (placeholder) {
            if (countryCode && countryCode !== 'LOCAL' && countryCode !== 'UNKNOWN') {
              placeholder.outerHTML = `<img src="https://flagsapi.com/${countryCode}/flat/32.png" style="width: 24px; height: 18px; border-radius: 2px;" alt="${countryCode}" title="${countryCode}">`;
            } else if (countryCode === 'LOCAL') {
              placeholder.outerHTML = '<span style="font-size: 18px;">🏠</span>';
            } else {
              placeholder.outerHTML = '<span style="font-size: 18px;">🌍</span>';
            }
          }
        }
      });

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
      table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #ff4444;">Error de Loading</td></tr>';
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

  // Cache for IP geolocation to avoid repeated API calls
  const ipCountryCache = new Map();

  // Rate limiting for API calls
  let apiCallQueue = Promise.resolve();
  const API_DELAY = 100; // 100ms between calls
  
  async function getCountryFromIP(ip) {
    if (!ip) return null;
    
    // Check cache first
    if (ipCountryCache.has(ip)) {
      return ipCountryCache.get(ip);
    }
    
    // Queue API calls with delay to avoid overwhelming backend
    return new Promise((resolve) => {
      apiCallQueue = apiCallQueue.then(async () => {
        try {
          // Use our backend API instead of direct ipapi.co call
          const response = await window.api.requestJson(`/api/geoip/${encodeURIComponent(ip)}`);
          
          if (response && response.status === 200 && response.body && response.body.countryCode) {
            const countryCode = response.body.countryCode;
            
            if (countryCode && (countryCode === 'LOCAL' || countryCode === 'UNKNOWN' || countryCode.length === 2)) {
              ipCountryCache.set(ip, countryCode);
              // Wait before next API call
              await new Promise(r => setTimeout(r, API_DELAY));
              return resolve(countryCode);
            }
          }
        } catch (error) {
          console.warn('Failed to fetch country for IP:', ip, error);
        }
        
        // Fallback to null
        ipCountryCache.set(ip, null);
        await new Promise(r => setTimeout(r, API_DELAY));
        resolve(null);
      });
    });
  }

  function getFlagEmoji(countryCode) {
    if (!countryCode) return '??';
    if (countryCode === 'LOCAL') return '??';
    
    // Convert country code to flag emoji
    // Each letter is converted to its regional indicator symbol
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    
    return String.fromCodePoint(...codePoints);
  }

  // ========== ALERTS PAGE ==========
  let alertsState = {
    offset: 0,
    limit: 50,
    total: 0,
    severity: 'all',
    autoRefreshTimer: null
  };

  function initAlertsPage() {
    const refreshBtn = document.getElementById('refreshBtn');
    const clearAlertsBtn = document.getElementById('clearAlertsBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const filterBadges = document.querySelectorAll('.filter-badge');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        alertsState.offset = 0;
        loadAlerts();
      });
    }

    if (clearAlertsBtn) {
      clearAlertsBtn.addEventListener('click', async () => {
        if (!confirm('Clear all security alerts from view? (Data will be kept in database)')) return;
        
        try {
          const res = await window.api.requestJson('/api/security/alerts/dismiss', { method: 'POST' });
          if (res && res.status === 200) {
            showToast(`✅ Cleared ${res.body.dismissed} alerts`, 'success');
            loadAlerts();
          } else {
            throw new Error('Failed to clear alerts');
          }
        } catch (err) {
          console.error('Error clearing alerts:', err);
          showToast('❌ Error: ' + err.message, 'error');
        }
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (alertsState.offset > 0) {
          alertsState.offset = Math.max(0, alertsState.offset - alertsState.limit);
          loadAlerts();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (alertsState.offset + alertsState.limit < alertsState.total) {
          alertsState.offset += alertsState.limit;
          loadAlerts();
        }
      });
    }

    filterBadges.forEach(badge => {
      badge.addEventListener('click', () => {
        filterBadges.forEach(b => b.classList.remove('active'));
        badge.classList.add('active');
        alertsState.severity = badge.dataset.severity;
        alertsState.offset = 0;
        loadAlerts();
      });
    });

    loadAlerts();
    
    // Auto-refresh every 10 seconds
    alertsState.autoRefreshTimer = setInterval(() => {
      loadAlerts(true);
    }, 10000);
  }

  async function loadAlerts(silent = false) {
    const alertsList = document.getElementById('alertsList');
    const totalCount = document.getElementById('totalCount');
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (!alertsList) return;

    if (!silent) {
      alertsList.innerHTML = '<div class="alert-item-loading"><div class="spinner"></div><p>Loading...</p></div>';
    }

    try {
      const res = await window.api.requestJson(
        `/api/security-alerts?limit=${alertsState.limit}&offset=${alertsState.offset}`
      );

      if (!res || res.status !== 200) throw new Error('Fetch failed');

      const data = res.body;
      alertsState.total = data.total || 0;

      if (totalCount) {
        totalCount.textContent = `Total: ${formatNumber(alertsState.total)} Alerts`;
      }

      if (!data.alerts || data.alerts.length === 0) {
        alertsList.innerHTML = '<div class="alert-item-empty"><p>🛡️ No security alerts</p></div>';
        if (pageInfo) pageInfo.textContent = '';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
      }

      // Filter by severity if not "all"
      let filteredAlerts = data.alerts;
      if (alertsState.severity !== 'all') {
        filteredAlerts = data.alerts.filter(alert => alert.severity === alertsState.severity);
      }

      // Render alerts immediately with placeholder flags
      alertsList.innerHTML = filteredAlerts.map(alert => {
        const createdAt = new Date(alert.created_at);
        const severityIcon = getSeverityIcon(alert.severity);
        const typeLabel = getAlertTypeLabel(alert.alert_type);
        const ip = escapeHtml(alert.ip_address || '');
        
        return `
          <div class="alert-item ${alert.severity}" data-alert-ip="${ip}">
            <div class="alert-header">
              <div class="alert-icon">${severityIcon}</div>
              <div class="alert-content">
                <div class="alert-title">${typeLabel}</div>
                <div class="alert-message">${escapeHtml(alert.message)}</div>
                <div class="alert-meta">
                  <div class="alert-meta-item">
                    <span class="severity-badge severity-${alert.severity}">${alert.severity}</span>
                  </div>
                  ${alert.ip_address ? `<div class="alert-meta-item alert-ip-container"><span class="flag-placeholder">⏳</span> ${ip}</div>` : ''}
                  ${alert.hostname ? `<div class="alert-meta-item">🌐 ${escapeHtml(alert.hostname)}</div>` : ''}
                  <div class="alert-meta-item">🕒 ${formatDate(createdAt)}</div>
                  ${alert.ip_address ? `
                  <div class="alert-meta-item" style="margin-left: auto;">
                    <div class="dropdown">
                      <button class="btn-icon" onclick="toggleDropdown(event, '${ip}')" title="IP Actions">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <circle cx="8" cy="3" r="1.5"/>
                          <circle cx="8" cy="8" r="1.5"/>
                          <circle cx="8" cy="13" r="1.5"/>
                        </svg>
                      </button>
                      <div class="dropdown-menu" id="dropdown-${ip}" style="display: none;">
                        <button onclick="addToWhitelist('${ip}')">✅ Add to Whitelist</button>
                        <button onclick="addToBlacklist('${ip}')">🚫 Block IP</button>
                      </div>
                    </div>
                  </div>
                  ` : ''}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Fetch country codes progressively (rate-limited by queue)
      filteredAlerts.forEach(async (alert) => {
        if (!alert.ip_address) return;
        
        const countryCode = await getCountryFromIP(alert.ip_address);
        const alertItem = alertsList.querySelector(`[data-alert-ip="${alert.ip_address}"]`);
        if (alertItem) {
          const container = alertItem.querySelector('.alert-ip-container');
          if (container) {
            const placeholder = container.querySelector('.flag-placeholder');
            if (placeholder) {
              if (countryCode && countryCode !== 'LOCAL' && countryCode !== 'UNKNOWN') {
                placeholder.outerHTML = `<img src="https://flagsapi.com/${countryCode}/flat/24.png" alt="${countryCode}" style="width: 24px; height: 18px; vertical-align: middle; margin-right: 6px;">`;
              } else if (countryCode === 'LOCAL') {
                placeholder.outerHTML = `<span style="margin-right: 6px;">🏠</span>`;
              } else {
                placeholder.outerHTML = `<span style="margin-right: 6px;">🌍</span>`;
              }
            }
          }
        }
      });

      // Update pagination
      const currentPage = Math.floor(alertsState.offset / alertsState.limit) + 1;
      const totalPages = Math.ceil(alertsState.total / alertsState.limit);
      
      if (pageInfo) {
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
      }
      
      if (prevBtn) {
        prevBtn.disabled = alertsState.offset === 0;
      }
      
      if (nextBtn) {
        nextBtn.disabled = alertsState.offset + alertsState.limit >= alertsState.total;
      }

    } catch (err) {
      console.error('Error loading alerts:', err);
      alertsList.innerHTML = '<div class="alert-item-empty"><p style="color: #ff4444;">❌ Loading Error</p></div>';
    }
  }

  function getSeverityIcon(severity) {
    const icons = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢'
    };
    return icons[severity] || '⚪';
  }

  function getAlertTypeLabel(type) {
    const labels = {
      IP_BANNED: '🚫 IP Banned',
      RATE_LIMIT: '⚡ Rate Limit Exceeded',
      BRUTE_FORCE: '🔨 Brute Force Attempt',
      DDOS: '💥 DDoS Attack Detected',
      SUSPICIOUS_ACTIVITY: '👁️ Suspicious Activity',
      CHALLENGE_FAILED: '❌ Challenge Failed',
      MALICIOUS_REQUEST: '⚠️ Malicious Request'
    };
    return labels[type] || type;
  }

  // ========================================
  // IP MANAGEMENT PAGE
  // ========================================
  function initIpManagementPage() {
    console.log('[IP Management] Initializing page...');
    loadTrustedIps();
    loadBlockedIps();

    const addTrustedBtn = document.getElementById('addTrustedBtn');
    const addBlockedBtn = document.getElementById('addBlockedBtn');
    const confirmAddTrusted = document.getElementById('confirmAddTrusted');
    const confirmAddBlocked = document.getElementById('confirmAddBlocked');

    console.log('[IP Management] Buttons found:', {
      addTrustedBtn: !!addTrustedBtn,
      addBlockedBtn: !!addBlockedBtn,
      confirmAddTrusted: !!confirmAddTrusted,
      confirmAddBlocked: !!confirmAddBlocked
    });

    if (addTrustedBtn) {
      addTrustedBtn.addEventListener('click', () => {
        console.log('[IP Management] Add Trusted button clicked');
        const modal = document.getElementById('addTrustedModal');
        console.log('[IP Management] Modal element:', modal);
        modal.style.display = 'flex';
        document.getElementById('trustedIpInput').value = '';
        document.getElementById('trustedLabelInput').value = '';
      });
    }

    if (addBlockedBtn) {
      addBlockedBtn.addEventListener('click', () => {
        console.log('[IP Management] Add Blocked button clicked');
        const modal = document.getElementById('addBlockedModal');
        console.log('[IP Management] Modal element:', modal);
        modal.style.display = 'flex';
        document.getElementById('blockedIpInput').value = '';
        document.getElementById('blockedReasonInput').value = '';
      });
    }

    if (confirmAddTrusted) {
      confirmAddTrusted.addEventListener('click', async () => {
        console.log('[IP Management] Confirm Add Trusted clicked');
        const ip = document.getElementById('trustedIpInput').value.trim();
        const label = document.getElementById('trustedLabelInput').value.trim();

        console.log('[IP Management] Adding IP:', { ip, label });

        if (!ip) {
          alert('Please enter an IP address');
          return;
        }

        try {
          console.log('[IP Management] Sending POST request to /api/security/trusted-ips');
          const res = await window.api.requestJson('/api/security/trusted-ips', { method: 'POST', body: { ip, label } });
          console.log('[IP Management] Response:', res);
          console.log('[IP Management] Response status:', res?.status);
          console.log('[IP Management] Response body:', res?.body);
          
          if (res && (res.status === 200 || res.status === 201)) {
            document.getElementById('addTrustedModal').style.display = 'none';
            showToast('✅ IP added to whitelist', 'success');
            // Reload after a short delay to ensure DB has committed
            setTimeout(() => loadTrustedIps(), 300);
          } else {
            const errorMsg = res?.body?.error || res?.body?.message || 'Failed to add IP';
            console.error('[IP Management] Error response:', errorMsg);
            throw new Error(errorMsg);
          }
        } catch (err) {
          console.error('[IP Management] Exception caught:', err);
          showToast('❌ Error: ' + err.message, 'error');
        }
      });
    }

    if (confirmAddBlocked) {
      confirmAddBlocked.addEventListener('click', async () => {
        console.log('[IP Management] Confirm Add Blocked clicked');
        const ip = document.getElementById('blockedIpInput').value.trim();
        const reason = document.getElementById('blockedReasonInput').value.trim();

        console.log('[IP Management] Blocking IP:', { ip, reason });

        if (!ip) {
          alert('Please enter an IP address');
          return;
        }

        try {
          console.log('[IP Management] Sending POST request to /api/security/blocked-ips');
          const res = await window.api.requestJson('/api/security/blocked-ips', { method: 'POST', body: { ip, reason } });
          console.log('[IP Management] Response:', res);
          console.log('[IP Management] Response status:', res?.status);
          console.log('[IP Management] Response body:', res?.body);
          
          if (res && (res.status === 200 || res.status === 201)) {
            document.getElementById('addBlockedModal').style.display = 'none';
            showToast('🚫 IP blocked successfully', 'success');
            // Reload after a short delay to ensure DB has committed
            setTimeout(() => loadBlockedIps(), 300);
          } else {
            const errorMsg = res?.body?.error || res?.body?.message || 'Failed to block IP';
            console.error('[IP Management] Error response:', errorMsg);
            throw new Error(errorMsg);
          }
        } catch (err) {
          console.error('[IP Management] Exception caught:', err);
          showToast('❌ Error: ' + err.message, 'error');
        }
      });
    }
  }

  async function loadTrustedIps() {
    const table = document.getElementById('trustedIpsTable');
    if (!table) return;

    table.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px;"><div class="spinner"></div><p style="margin-top: 12px; color: rgba(255,255,255,0.5);">Loading...</p></td></tr>';

    try {
      const res = await window.api.requestJson('/api/security/trusted-ips');
      if (!res || res.status !== 200) throw new Error('Failed to fetch');

      const ips = res.body || [];

      if (ips.length === 0) {
        table.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">No trusted IPs configured</td></tr>';
        return;
      }

      table.innerHTML = ips.map(item => {
        const createdAt = new Date(item.created_at);
        return `
          <tr>
            <td><code style="background: rgba(59, 130, 246, 0.1); padding: 4px 8px; border-radius: 4px; color: #60a5fa;">${escapeHtml(item.ip)}</code></td>
            <td>${escapeHtml(item.label || '-')}</td>
            <td style="color: rgba(255,255,255,0.6); font-size: 13px;">${formatDate(createdAt)}</td>
            <td style="text-align: center;">
              <button class="btn-icon btn-icon-danger" onclick="removeTrustedIp(${item.id})" title="Remove from whitelist">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Error loading trusted IPs:', err);
      table.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: #ff4444;">❌ Error loading data</td></tr>';
    }
  }

  async function loadBlockedIps() {
    const table = document.getElementById('blockedIpsTable');
    if (!table) return;

    console.log('[IP Management] Loading blocked IPs...');
    table.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px;"><div class="spinner"></div><p style="margin-top: 12px; color: rgba(255,255,255,0.5);">Loading...</p></td></tr>';

    try {
      console.log('[IP Management] Fetching /api/security/blocked-ips');
      const res = await window.api.requestJson('/api/security/blocked-ips');
      console.log('[IP Management] Blocked IPs response:', res);
      
      if (!res || res.status !== 200) throw new Error('Failed to fetch');

      const ips = res.body || [];
      console.log('[IP Management] Blocked IPs count:', ips.length);

      if (ips.length === 0) {
        table.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">No blocked IPs</td></tr>';
        return;
      }

      table.innerHTML = ips.map(item => {
        const createdAt = new Date(item.created_at);
        return `
          <tr>
            <td><code style="background: rgba(220, 38, 38, 0.1); padding: 4px 8px; border-radius: 4px; color: #f87171;">${escapeHtml(item.ip)}</code></td>
            <td>${escapeHtml(item.reason || '-')}</td>
            <td style="color: rgba(255,255,255,0.6); font-size: 13px;">${formatDate(createdAt)}</td>
            <td style="text-align: center;">
              <button class="btn-icon" onclick="removeBlockedIp(${item.id})" title="Unblock IP">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');
      console.log('[IP Management] Blocked IPs table rendered');
    } catch (err) {
      console.error('[IP Management] Error loading blocked IPs:', err);
      table.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: #ff4444;">❌ Error loading data</td></tr>';
    }
  }

  window.removeTrustedIp = async function(id) {
    if (!confirm('Remove this IP from the whitelist?')) return;

    try {
      const res = await window.api.requestJson(`/api/security/trusted-ips/${id}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        loadTrustedIps();
        showToast('✅ IP removed from whitelist', 'success');
      } else {
        throw new Error('Failed to remove IP');
      }
    } catch (err) {
      console.error('Error removing trusted IP:', err);
      showToast('❌ Error: ' + err.message, 'error');
    }
  };

  window.removeBlockedIp = async function(id) {
    if (!confirm('Unblock this IP address?')) return;

    try {
      const res = await window.api.requestJson(`/api/security/blocked-ips/${id}`, { method: 'DELETE' });
      if (res && (res.status === 200 || res.status === 204)) {
        loadBlockedIps();
        showToast('✅ IP unblocked', 'success');
      } else {
        throw new Error('Failed to unblock IP');
      }
    } catch (err) {
      console.error('Error unblocking IP:', err);
      showToast('❌ Error: ' + err.message, 'error');
    }
  };

  function showToast(message, type = 'info') {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ========== Global Dropdown Functions ==========
  window.toggleDropdown = function(event, ip) {
    event.stopPropagation();
    const dropdownId = `dropdown-${ip}`;
    const menu = document.getElementById(dropdownId);
    
    if (!menu) return;
    
    // Close all other dropdowns
    document.querySelectorAll('.dropdown-menu').forEach(m => {
      if (m.id !== dropdownId) m.style.display = 'none';
    });
    
    // Toggle this dropdown
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  };

  window.addToWhitelist = async function(ip) {
    try {
      const response = await window.api.requestJson('/api/security/trusted-ips', {
        method: 'POST',
        body: {
          ip: ip,
          label: `Added from logs on ${new Date().toLocaleString()}`
        }
      });

      if (response && (response.status === 200 || response.status === 201)) {
        showToast(`✅ ${ip} added to whitelist`, 'success');
        
        // Close dropdown
        const menu = document.getElementById(`dropdown-${ip}`);
        if (menu) menu.style.display = 'none';
        
        // Refresh IP Management tables if on that page
        const currentPage = window.location.hash.replace('#', '') || 'dashboard';
        if (currentPage === 'ip-management') {
          if (typeof loadTrustedIps === 'function') loadTrustedIps();
        }
      } else {
        throw new Error(response.message || 'Failed to add IP to whitelist');
      }
    } catch (err) {
      console.error('Error adding to whitelist:', err);
      showToast('❌ Error: ' + err.message, 'error');
    }
  };

  window.addToBlacklist = async function(ip) {
    try {
      const response = await window.api.requestJson('/api/security/blocked-ips', {
        method: 'POST',
        body: {
          ip: ip,
          reason: `Blocked from logs on ${new Date().toLocaleString()}`
        }
      });

      if (response && (response.status === 200 || response.status === 201)) {
        showToast(`🚫 ${ip} added to blocklist`, 'success');
        
        // Close dropdown
        const menu = document.getElementById(`dropdown-${ip}`);
        if (menu) menu.style.display = 'none';
        
        // Refresh IP Management tables if on that page
        const currentPage = window.location.hash.replace('#', '') || 'dashboard';
        if (currentPage === 'ip-management') {
          if (typeof loadBlockedIps === 'function') loadBlockedIps();
        }
      } else {
        throw new Error(response.message || 'Failed to block IP');
      }
    } catch (err) {
      console.error('Error blocking IP:', err);
      showToast('❌ Error: ' + err.message, 'error');
    }
  };

  // Close dropdowns when clicking outside
  document.addEventListener('click', function(event) {
    if (!event.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown-menu').forEach(menu => {
        menu.style.display = 'none';
      });
    }
  });

  // ================== MONTHLY REPORTS PAGE ==================
  function initReportsPage() {
    const generateReportBtn = document.getElementById('generateReportBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (generateReportBtn) {
      generateReportBtn.addEventListener('click', generateMonthlyReport);
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        reportsState.offset = 0;
        loadReports();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (reportsState.offset > 0) {
          reportsState.offset = Math.max(0, reportsState.offset - reportsState.limit);
          loadReports();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        reportsState.offset += reportsState.limit;
        loadReports();
      });
    }

    // Close modal
    const closeModal = document.getElementById('closeModal');
    if (closeModal) {
      closeModal.addEventListener('click', () => {
        document.getElementById('reportModal').style.display = 'none';
      });
    }

    // Load initial data
    loadReports();
  }

  const reportsState = {
    limit: 12,
    offset: 0,
    total: 0
  };

  async function loadLatestReport() {
    try {
      const res = await window.api.requestJson('/api/reports/latest');
      if (res && res.status === 200) {
        displayLatestReport(res.body);
      }
    } catch (err) {
      console.error('Error loading latest report:', err);
    }
  }

  function displayLatestReport(report) {
    const card = document.getElementById('latestReportCard');
    const content = document.getElementById('latestReportContent');
    
    if (!report) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';

    const monthStr = new Date(report.report_month).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long' 
    });

    content.innerHTML = `
      <div class="stat-item">
        <span class="stat-label">Report Month</span>
        <span class="stat-value">${monthStr}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Domains</span>
        <span class="stat-value">${report.domains_total || 0}</span>
        <span class="stat-meta">+${report.domains_added || 0} / -${report.domains_deleted || 0}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Proxies</span>
        <span class="stat-value">${report.proxies_total || 0}</span>
        <span class="stat-meta">+${report.proxies_added || 0} / -${report.proxies_deleted || 0}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Backends</span>
        <span class="stat-value">${report.backends_total || 0}</span>
        <span class="stat-meta">+${report.backends_added || 0} / -${report.backends_deleted || 0}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total Requests</span>
        <span class="stat-value">${formatNumber(report.total_requests || 0)}</span>
        <span class="stat-meta">${formatNumber(report.unique_ips || 0)} unique IPs</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Unique Domains</span>
        <span class="stat-value">${formatNumber(report.unique_domains || 0)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Security Alerts</span>
        <span class="stat-value">${formatNumber(report.total_alerts || 0)}</span>
        <span class="stat-meta">${report.blocked_ips || 0} blocked IPs</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Active Certificates</span>
        <span class="stat-value">${report.active_certificates || 0}</span>
        <span class="stat-meta">${report.certificates_issued || 0} issued this month</span>
      </div>
    `;
  }

  async function loadReports() {
    const tbody = document.getElementById('reportsTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading...</td></tr>';

    try {
      const res = await window.api.requestJson(
        `/api/reports?limit=${reportsState.limit}&offset=${reportsState.offset}`
      );

      if (res && res.status === 200) {
        const { reports, total } = res.body;
        reportsState.total = total;
        displayReports(reports);
        updatePagination();
      } else {
        throw new Error('Failed to load reports');
      }
    } catch (err) {
      console.error('Error loading reports:', err);
      tbody.innerHTML = `<tr><td colspan="8" class="error">Error: ${err.message}</td></tr>`;
    }
  }

  function displayReports(reports) {
    const tbody = document.getElementById('reportsTableBody');

    if (!reports || reports.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No reports found. Reports are generated on the 1st of each month.</td></tr>';
      return;
    }

    tbody.innerHTML = reports.map(r => {
      const monthStr = new Date(r.report_month).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long' 
      });
      const generatedStr = new Date(r.generated_at).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <tr>
          <td><strong>${monthStr}</strong></td>
          <td>${generatedStr}</td>
          <td>${r.domains_total || 0}</td>
          <td>${r.proxies_total || 0}</td>
          <td>${r.backends_total || 0}</td>
          <td>${r.certificates_active || 0}</td>
          <td>
            <button class="btn" onclick="viewReportDetails('${r.report_month}')">View Details</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function updatePagination() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const pageInfo = document.getElementById('pageInfo');

    const currentPage = Math.floor(reportsState.offset / reportsState.limit) + 1;
    const totalPages = Math.ceil(reportsState.total / reportsState.limit);

    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${reportsState.total} total)`;

    prevBtn.disabled = reportsState.offset === 0;
    nextBtn.disabled = reportsState.offset + reportsState.limit >= reportsState.total;
  }

  window.viewReportDetails = async function(reportMonth) {
    try {
      const res = await window.api.requestJson(`/api/reports/${reportMonth}`);
      
      if (res && res.status === 200) {
        displayReportModal(res.body);
      } else {
        throw new Error('Failed to load report details');
      }
    } catch (err) {
      console.error('Error loading report details:', err);
      showToast('❌ Error: ' + err.message, 'error');
    }
  };

  function displayReportModal(report) {
    const modal = document.getElementById('reportModal');
    const modalTitle = document.getElementById('modalTitle');

    const monthStr = new Date(report.report_month).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long' 
    });

    modalTitle.textContent = `Report for ${monthStr}`;

    // Update all stats
    document.getElementById('stat-domains-total').textContent = report.domains_total || 0;
    document.getElementById('stat-domains-added').textContent = `+${report.domains_added || 0}`;
    document.getElementById('stat-domains-deleted').textContent = `-${report.domains_deleted || 0}`;

    document.getElementById('stat-proxies-total').textContent = report.proxies_total || 0;
    document.getElementById('stat-proxies-added').textContent = `+${report.proxies_added || 0}`;
    document.getElementById('stat-proxies-deleted').textContent = `-${report.proxies_deleted || 0}`;

    document.getElementById('stat-backends-total').textContent = report.backends_total || 0;
    document.getElementById('stat-backends-added').textContent = `+${report.backends_added || 0}`;
    document.getElementById('stat-backends-deleted').textContent = `-${report.backends_deleted || 0}`;

    document.getElementById('stat-requests-total').textContent = formatNumber(report.total_requests || 0);
    document.getElementById('stat-requests-ips').textContent = formatNumber(report.unique_ips || 0);
    document.getElementById('stat-requests-domains').textContent = formatNumber(report.unique_domains || 0);

    document.getElementById('stat-security-alerts').textContent = formatNumber(report.total_alerts || 0);
    document.getElementById('stat-security-blocked').textContent = report.blocked_ips || 0;
    document.getElementById('stat-security-trusted').textContent = report.trusted_ips || 0;

    document.getElementById('stat-certs-active').textContent = report.active_certificates || 0;
    document.getElementById('stat-certs-issued').textContent = `+${report.certificates_issued || 0}`;
    document.getElementById('stat-certs-renewed').textContent = report.certificates_renewed || 0;

    // Top Domains
    const additionalData = typeof report.additional_data === 'string' 
      ? JSON.parse(report.additional_data) 
      : report.additional_data || {};

    displayTopDomains(additionalData.topDomains || []);
    displayTopIPs(additionalData.topIPs || []);

    modal.style.display = 'block';
  }

  function displayTopDomains(topDomains) {
    const container = document.getElementById('topDomainsTable');
    
    if (!topDomains || topDomains.length === 0) {
      container.innerHTML = '<p class="empty">No data</p>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Domain</th>
            <th>Requests</th>
          </tr>
        </thead>
        <tbody>
          ${topDomains.map((d, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><code>${d.hostname || 'N/A'}</code></td>
              <td>${formatNumber(d.count || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function displayTopIPs(topIPs) {
    const container = document.getElementById('topIPsTable');
    
    if (!topIPs || topIPs.length === 0) {
      container.innerHTML = '<p class="empty">No data</p>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>IP Address</th>
            <th>Requests</th>
          </tr>
        </thead>
        <tbody>
          ${topIPs.map((ip, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><code>${ip.client_ip || 'N/A'}</code></td>
              <td>${formatNumber(ip.count || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  async function generateMonthlyReport() {
    const btn = document.getElementById('generateReportBtn');
    
    if (!confirm('Generate monthly report for the previous month?\n\nThis will:\n- Calculate all statistics\n- Clear old dismissed logs (>90 days)\n- Create snapshot for comparison')) {
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = 'Generating...';

      const res = await window.api.requestJson('/api/reports/generate', {
        method: 'POST',
        body: {}
      });

      if (res && res.status === 200) {
        showToast('✅ Monthly report generated successfully', 'success');
        loadReports();
      } else {
        throw new Error(res.body?.error || 'Failed to generate report');
      }
    } catch (err) {
      console.error('Error generating report:', err);
      showToast('❌ Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Report';
    }
  }

  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  // Maintenance Management Functions
  let currentMaintenanceDomainId = null;

  async function openMaintenancePanel(domainId, hostname) {
    currentMaintenanceDomainId = domainId;

    // Set domain name
    const domainNameEl = document.getElementById('maintenanceDomainName');
    if (domainNameEl) domainNameEl.textContent = hostname;

    // Load current maintenance status
    try {
      const res = await window.api.requestJson(`/api/maintenance/status/${domainId}`);
      if (res && res.status === 200) {
        const data = res.body;
        const toggle = document.getElementById('maintenanceToggle');
        const statusText = document.getElementById('maintenanceStatusText');

        if (toggle) toggle.checked = data.maintenance_enabled || false;
        if (statusText) statusText.textContent = (data.maintenance_enabled ? 'Enabled' : 'Disabled');

        // Update toggle event listener
        if (toggle) {
          toggle.onchange = function() {
            statusText.textContent = this.checked ? 'Enabled' : 'Disabled';
          };
        }
      }
    } catch (e) {
      console.error('Error loading maintenance status:', e);
    }

    // Clear custom page textarea
    const textarea = document.getElementById('customMaintenancePage');
    if (textarea) textarea.value = '';

    // Show panel
    togglePanel('maintenancePanel', true);
  }

  // Load current maintenance page
  document.getElementById('loadCurrentPageBtn')?.addEventListener('click', async () => {
    if (!currentMaintenanceDomainId) return;

    try {
      const res = await window.api.requestJson(`/api/maintenance/page/${currentMaintenanceDomainId}`);
      if (res && res.status === 200) {
        const textarea = document.getElementById('customMaintenancePage');
        if (textarea && res.body && res.body.content) {
          textarea.value = res.body.content;
          showToast('Current page loaded');
        }
      }
    } catch (e) {
      console.error('Error loading current page:', e);
      showToast('Failed to load current page', 'error');
    }
  });

  // Clear custom page
  document.getElementById('clearCustomPageBtn')?.addEventListener('click', () => {
    const textarea = document.getElementById('customMaintenancePage');
    if (textarea) {
      textarea.value = '';
      showToast('Custom page cleared');
    }
  });

  // Save maintenance settings
  document.getElementById('saveMaintenanceBtn')?.addEventListener('click', async function() {
    if (!currentMaintenanceDomainId) return;

    const btn = this;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const toggle = document.getElementById('maintenanceToggle');
      const textarea = document.getElementById('customMaintenancePage');

      const maintenanceEnabled = toggle ? toggle.checked : false;
      const customHtml = textarea ? textarea.value.trim() : '';

      // Update maintenance mode
      const modeRes = await window.api.requestJson(`/api/maintenance/mode/${currentMaintenanceDomainId}`, {
        method: 'PUT',
        body: {
          enabled: maintenanceEnabled,
          maintenancePagePath: null  // Will be set after uploading custom page
        }
      });

      if (!modeRes || modeRes.status !== 200) {
        throw new Error('Failed to update maintenance mode');
      }

      // Upload custom page if provided
      if (customHtml) {
        const pageRes = await window.api.requestJson(`/api/maintenance/page/${currentMaintenanceDomainId}`, {
          method: 'POST',
          body: { htmlContent: customHtml }
        });

        if (!pageRes || pageRes.status !== 200) {
          throw new Error('Failed to upload custom maintenance page');
        }
      } else {
        // Delete custom page if textarea is empty
        await window.api.requestJson(`/api/maintenance/page/${currentMaintenanceDomainId}`, {
          method: 'DELETE'
        });
      }

      showToast('Maintenance settings saved successfully', 'success');
      togglePanel('maintenancePanel', false);

      // Reload domains to reflect changes
      if (document.body.dataset.page === 'domains') {
        await loadDomains();
      }
    } catch (e) {
      console.error('Error saving maintenance settings:', e);
      showToast('Failed to save settings: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

})();

