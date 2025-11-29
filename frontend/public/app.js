'use strict';

(function () {
  // --- State Management ---
  const state = {
    proxies: [],
    backends: [],
    domains: [],
    certificates: [],
    metricsData: null,
    viewMode: 'realtime', // 'realtime' or '24h'
    metricsInterval: 300,
    serverTimeOffset: 0,
    animationId: null,
    mouseX: null,
    mouseY: null,
    isHovering: false,
    editingDomainId: null,
    editingProxyId: null,
    editingBackendId: null
  };

  const els = {};

  // --- Initialization ---
  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    bindEvents();
    bootstrap();
  });

  function cacheElements() {
    const ids = [
      'trafficChart', 'chartWrapper', 'chartPlaceholder',
      'stat-requests', 'stat-rps', 'stat-traffic-in', 'stat-traffic-out',
      'proxiesTable', 'proxiesEmpty',
      'backendsTable', 'backendsEmpty',
      'domainsTable', 'domainsEmpty',
      'proxyModal', 'backendModal', 'domainModal',
      'btnAddProxy', 'btnCancelProxy', 'proxyForm',
      'btnAddBackend', 'btnCancelBackend', 'backendForm',
      'btnAddDomain', 'btnCancelDomain', 'domainForm',
      'toastStack',
      'proxyBackendSelect', 'domainProxySelect', 'domainBackendSelect',
      'btnViewRealtime', 'btnView24h',
      'view-domain-details', 'btnBackToDomains', 'domainDetailsForm',
      'editDomainHostname', 'editDomainProxySelect', 'editDomainBackendSelect', 'btnDeleteDomain',
      'view-proxy-details', 'proxyDetailsForm', 'editProxyName', 'editProxyProtocol', 'editProxyListenHost', 'editProxyListenPort', 'editProxyBackendSelect', 'btnDeleteProxy',
      'view-backend-details', 'backendDetailsForm', 'editBackendName', 'editBackendTargetHost', 'editBackendTargetPort', 'editBackendTargetProtocol', 'btnDeleteBackend',
      'view-certificates', 'certsTable', 'certsEmpty',
      'view-settings', 'settingsForm', 'localTldsTextarea',
      'certModal', 'certDomain', 'certContent', 'certKey', 'btnCloseCert'
    ];
    ids.forEach(id => els[id] = document.getElementById(id));

    els.navItems = document.querySelectorAll('.nav-item');
    els.views = document.querySelectorAll('.view-section');
  }

  function bindEvents() {
    // Navigation
    document.body.addEventListener('click', e => {
      const link = e.target.matches('[data-link]') ? e.target : e.target.closest('[data-link]');
      if (link) {
        e.preventDefault();
        navigateTo(link.getAttribute('href'));
      }
    });
    window.addEventListener('popstate', router);

    // View Toggles
    if (els.btnViewRealtime) els.btnViewRealtime.addEventListener('click', () => setViewMode('realtime'));
    if (els.btnView24h) els.btnView24h.addEventListener('click', () => setViewMode('24h'));

    // Modals
    bindModalEvents();

    // Forms
    if (els.proxyForm) els.proxyForm.addEventListener('submit', handleProxySubmit);
    if (els.backendForm) els.backendForm.addEventListener('submit', handleBackendSubmit);
    if (els.domainForm) els.domainForm.addEventListener('submit', handleDomainSubmit);
    if (els.domainDetailsForm) els.domainDetailsForm.addEventListener('submit', handleDomainUpdate);
    if (els.proxyDetailsForm) els.proxyDetailsForm.addEventListener('submit', handleProxyUpdate);
    if (els.backendDetailsForm) els.backendDetailsForm.addEventListener('submit', handleBackendUpdate);
    if (els.settingsForm) els.settingsForm.addEventListener('submit', handleSettingsSubmit);

    // Delete Actions
    if (els.btnDeleteDomain) els.btnDeleteDomain.addEventListener('click', deleteDomain);
    if (els.btnDeleteProxy) els.btnDeleteProxy.addEventListener('click', deleteProxy);
    if (els.btnDeleteBackend) els.btnDeleteBackend.addEventListener('click', deleteBackend);

    // Chart Interaction
    if (els.trafficChart) {
      els.trafficChart.addEventListener('mousemove', (e) => {
        const rect = els.trafficChart.getBoundingClientRect();
        state.mouseX = e.clientX - rect.left;
        state.mouseY = e.clientY - rect.top;
        state.isHovering = true;
      });
      els.trafficChart.addEventListener('mouseleave', () => {
        state.isHovering = false;
        state.mouseX = null;
      });
    }
  }

  function bindModalEvents() {
    const bind = (btnOpen, btnClose, modalId, onOpen) => {
      if (els[btnOpen]) els[btnOpen].addEventListener('click', () => {
        if (onOpen) onOpen();
        openModal(modalId);
      });
      if (els[btnClose]) els[btnClose].addEventListener('click', () => closeModal(modalId));
    };

    bind('btnAddProxy', 'btnCancelProxy', 'proxyModal', () => populateBackendSelect(els.proxyBackendSelect));
    bind('btnAddBackend', 'btnCancelBackend', 'backendModal');
    bind('btnAddDomain', 'btnCancelDomain', 'domainModal', () => {
      populateProxySelect(els.domainProxySelect);
      populateBackendSelect(els.domainBackendSelect);
    });
    if (els.btnCloseCert) els.btnCloseCert.addEventListener('click', () => closeModal('certModal'));
  }

  // --- Router ---
  function navigateTo(url) {
    history.pushState(null, null, url);
    router();
  }

  async function router() {
    const path = window.location.pathname;

    // Update Nav
    els.navItems.forEach(el => {
      el.classList.toggle('active', el.getAttribute('href') === path);
    });

    // Route Matching
    if (path === '/' || path === '/dashboard') switchView('dashboard');
    else if (path === '/proxies') switchView('proxies');
    else if (path === '/backends') switchView('backends');
    else if (path === '/domains') switchView('domains');
    else if (path === '/certificates') switchView('certificates');
    else if (path === '/settings') {
      switchView('settings');
      await loadSettings();
    }
    else if (path.match(/^\/domains\/\d+$/)) await handleDetailRoute(path, 'domains', showDomainDetails);
    else if (path.match(/^\/proxies\/\d+$/)) await handleDetailRoute(path, 'proxies', showProxyDetails);
    else if (path.match(/^\/backends\/\d+$/)) await handleDetailRoute(path, 'backends', showBackendDetails);
    else navigateTo('/dashboard');
  }

  async function handleDetailRoute(path, type, showFn) {
    const id = path.split('/')[2];
    if (state[type].length === 0) await loadData(type);
    const item = state[type].find(i => i.id == id);
    if (item) showFn(item);
    else {
      notify(`${type.slice(0, -1)} not found`, 'error');
      navigateTo(`/${type}`);
    }
  }

  function switchView(viewName) {
    els.navItems.forEach(el => el.classList.toggle('active', el.dataset.view === viewName));
    els.views.forEach(el => el.style.display = el.id === `view-${viewName}` ? 'block' : 'none');
  }

  function setViewMode(mode) {
    if (state.viewMode === mode) return;
    state.viewMode = mode;

    const isRealtime = mode === 'realtime';
    updateViewBtn(els.btnViewRealtime, isRealtime);
    updateViewBtn(els.btnView24h, !isRealtime);

    if (isRealtime) startAnimation();
    else stopAnimation();

    loadMetrics();
  }

  function updateViewBtn(btn, isActive) {
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('btn-primary', isActive);
    btn.classList.toggle('btn-ghost', !isActive);
  }

  // --- Data Loading ---
  async function bootstrap() {
    try {
      await Promise.all([loadData('proxies'), loadData('backends'), loadData('domains'), loadData('certificates')]);
      renderProxies();
      renderBackends();
      renderDomains();
      await loadMetrics();

      setInterval(() => {
        if (state.viewMode === 'realtime') loadMetrics();
      }, 1000);

      startAnimation();
      router();
    } catch (err) {
      if (isNetworkError(err)) {
        console.log('Connection lost, retrying in 2s...');
        setTimeout(bootstrap, 2000);
      } else {
        console.error(err);
        notify('Failed to load initial data', 'error');
      }
    }
  }

  async function loadData(type) {
    const res = await requestJson(`/api/${type}`);
    state[type] = res || [];
    if (type === 'proxies') renderProxies();
    if (type === 'backends') renderBackends();
    if (type === 'domains') renderDomains();
    if (type === 'certificates') renderCertificates();
  }

  // --- Settings ---
  async function loadSettings() {
    try {
      const res = await requestJson('/api/settings/local_tlds');
      if (res && Array.isArray(res.localTlds)) {
        els.localTldsTextarea.value = res.localTlds.join(',');
      } else {
        els.localTldsTextarea.value = '';
      }
    } catch (e) {
      notify('Failed to load settings', 'error');
    }
  }

  async function handleSettingsSubmit(e) {
    e.preventDefault();
    const raw = (els.localTldsTextarea.value || '').trim();
    const list = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    try {
      await requestJson('/api/settings/local_tlds', { method: 'PUT', body: { localTlds: list } });
      notify('Settings saved');
      await loadSettings();
    } catch (err) {
      notify('Failed to save settings: ' + err.message, 'error');
    }
  }

  async function loadMetrics() {
    try {
      const url = state.viewMode === 'realtime'
        ? `/api/metrics/combined?last=65&interval=1`
        : `/api/metrics/combined?last=86400&interval=3600`;

      const res = await requestJson(url);
      if (res && res.metrics) {
        state.metricsData = res.metrics.map(m => ({
          bucket: m.bucket,
          timestamp: m.bucket,
          requests_per_second: Number(m.requests),
          traffic_in: Number(m.bytes_in),
          traffic_out: Number(m.bytes_out)
        }));

        if (state.viewMode === 'realtime' && res.serverTime && state.serverTimeOffset === 0) {
          state.serverTimeOffset = new Date(res.serverTime).getTime() - Date.now();
        } else if (state.viewMode !== 'realtime') {
          render24hChart();
        }
      }
    } catch (e) {
      if (isNetworkError(e)) console.log('Metrics connection lost, retrying...');
      else console.error('Error fetching metrics:', e);
    }
  }

  // --- Rendering Lists ---
  function renderProxies() {
    renderTable(els.proxiesTable, els.proxiesEmpty, state.proxies, p => {
      let target = `${p.target_host}:${p.target_port}`;
      const backend = state.backends.find(b =>
        b.target_host === p.target_host &&
        b.target_port === p.target_port &&
        (b.target_protocol || 'http') === (p.target_protocol || 'http')
      );
      if (backend) target = `Backend: ${escapeHtml(backend.name)}`;

      return `
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.listen_host)}:${p.listen_port} <span class="text-muted">(${p.protocol})</span></td>
        <td>${target}</td>
        <td><span class="status-badge ${p.enabled ? 'active' : 'inactive'}">${p.enabled ? 'Active' : 'Disabled'}</span></td>
      `;
    }, p => navigateTo(`/proxies/${p.id}`));
  }

  function renderBackends() {
    renderTable(els.backendsTable, els.backendsEmpty, state.backends, b => `
      <td><strong>${escapeHtml(b.name)}</strong></td>
      <td>${escapeHtml(b.target_host)}:${b.target_port}</td>
      <td>${(b.target_protocol || 'http').toUpperCase()}</td>
    `, b => navigateTo(`/backends/${b.id}`));
  }

  function renderDomains() {
    renderTable(els.domainsTable, els.domainsEmpty, state.domains, d => {
      const backend = state.backends.find(b => b.id == d.backend_id);
      const proxy = state.proxies.find(p => p.id == d.proxy_id);
      return `
        <td><strong>${escapeHtml(d.hostname)}</strong></td>
        <td>${proxy ? escapeHtml(proxy.name) : '-'}</td>
        <td>${backend ? escapeHtml(backend.name) : '-'}</td>
      `;
    }, d => navigateTo(`/domains/${d.id}`));
  }

  function renderCertificates() {
    renderTable(els.certsTable, els.certsEmpty, state.certificates, c => {
      let statusHtml, actionHtml, validUntil = '-';
      if (c.exists) {
        statusHtml = c.expiresSoon ? '<span class="badge badge-warning">Expires Soon</span>' : '<span class="badge badge-success">Valid</span>';
        validUntil = c.validTo ? new Date(c.validTo).toLocaleDateString() : 'Unknown';
        actionHtml = '<button class="btn btn-ghost btn-sm" disabled>Valid</button>';
      } else {
        statusHtml = '<span class="badge badge-danger">Missing</span>';
      }
      return `
        <td onclick="showCertificateDetails('${c.hostname}')" style="cursor: pointer;"><strong>${escapeHtml(c.hostname)}</strong></td>
        <td onclick="showCertificateDetails('${c.hostname}')" style="cursor: pointer;">${statusHtml}</td>
        <td onclick="showCertificateDetails('${c.hostname}')" style="cursor: pointer;">${validUntil}</td>
        <td>${actionHtml}</td>
      `;
    });
  }

  function renderTable(table, emptyMsg, data, rowHtmlFn, clickHandler) {
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    if (data.length === 0) {
      table.style.display = 'none';
      emptyMsg.style.display = 'block';
      return;
    }
    table.style.display = 'table';
    emptyMsg.style.display = 'none';

    data.forEach(item => {
      const tr = document.createElement('tr');
      if (clickHandler) {
        tr.style.cursor = 'pointer';
        tr.onclick = () => clickHandler(item);
      }
      tr.innerHTML = rowHtmlFn(item);
      tbody.appendChild(tr);
    });
  }

  // --- Graph Rendering (Upgraded) ---
  function startAnimation() {
    if (state.animationId) return;
    let lastTime = performance.now();
    function loop(now) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      updateChart(dt);
      state.animationId = requestAnimationFrame(loop);
    }
    state.animationId = requestAnimationFrame(loop);
  }

  function stopAnimation() {
    if (state.animationId) {
      cancelAnimationFrame(state.animationId);
      state.animationId = null;
    }
  }

  function updateChart(dt) {
    const canvas = els.trafficChart;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    if (state.viewMode === 'realtime') renderRealtimeChart(ctx, width, height);
    else render24hChart(ctx, width, height);
  }

  function renderRealtimeChart(ctx, width, height) {
    if (!state.metricsData) return;

    const now = Date.now() + state.serverTimeOffset;
    const timeWindow = 60 * 1000;
    const startTime = now - timeWindow;

    // Generate points aligned to absolute seconds for smooth sliding
    const dataPoints = [];
    const startAligned = Math.ceil(startTime / 1000) * 1000;
    const endAligned = Math.floor(now / 1000) * 1000;

    for (let t = startAligned; t <= endAligned; t += 1000) {
      const m = state.metricsData.find(d => new Date(d.bucket).getTime() === t);
      dataPoints.push({
        x: ((t - startTime) / timeWindow) * width,
        trafficIn: m ? Number(m.traffic_in) : 0,
        trafficOut: m ? Number(m.traffic_out) : 0,
        rps: m ? Number(m.requests_per_second) : 0,
        timestamp: t
      });
    }

    if (dataPoints.length < 2) return;

    // Draw Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const y = height - (height / 5) * i;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Scales
    const maxVal = Math.max(...dataPoints.map(p => Math.max(p.trafficIn, p.trafficOut)), 1024);
    const scaleY = (height - 40) / maxVal;
    const maxRps = Math.max(...dataPoints.map(p => p.rps), 5);
    const scaleRps = (height - 40) / maxRps;

    // Draw Function
    const drawLine = (accessor, color, fill, scale) => {
      const s = scale || scaleY;
      ctx.beginPath();
      ctx.moveTo(dataPoints[0].x, height - (accessor(dataPoints[0]) * s));

      for (let i = 0; i < dataPoints.length - 1; i++) {
        const p0 = dataPoints[i];
        const p1 = dataPoints[i + 1];
        const y0 = height - (accessor(p0) * s);
        const y1 = height - (accessor(p1) * s);
        const midX = (p0.x + p1.x) / 2;
        const midY = (y0 + y1) / 2;
        ctx.quadraticCurveTo(p0.x, y0, midX, midY);
        ctx.quadraticCurveTo(midX, midY, p1.x, y1);
      }

      if (fill) {
        ctx.lineTo(dataPoints[dataPoints.length - 1].x, height);
        ctx.lineTo(dataPoints[0].x, height);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 10; // Glow effect
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset
      }
    };

    // Gradients
    const createGradient = (color) => {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, color.replace('0.4', '0.2'));
      g.addColorStop(1, color.replace('0.4', '0.0'));
      return g;
    };

    // Draw Layers
    drawLine(d => d.trafficOut, '#a855f7', createGradient('rgba(168, 85, 247, 0.4)')); // Purple Fill
    drawLine(d => d.trafficOut, '#a855f7'); // Purple Line

    drawLine(d => d.trafficIn, '#22c55e', createGradient('rgba(34, 197, 94, 0.4)')); // Green Fill
    drawLine(d => d.trafficIn, '#22c55e'); // Green Line

    drawLine(d => d.rps, '#3b82f6', createGradient('rgba(59, 130, 246, 0.4)'), scaleRps); // Blue Fill
    drawLine(d => d.rps, '#3b82f6', null, scaleRps); // Blue Line

    // Hover & Tooltip
    if (state.isHovering && state.mouseX !== null) {
      const hoverTime = startTime + (state.mouseX / width) * timeWindow;
      // Find closest point
      const point = dataPoints.reduce((prev, curr) =>
        Math.abs(curr.timestamp - hoverTime) < Math.abs(prev.timestamp - hoverTime) ? curr : prev
      );

      if (point) {
        const x = point.x;

        // Vertical Line
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dots
        const drawDot = (val, color, scale) => {
          const y = height - (val * (scale || scaleY));
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        };

        drawDot(point.trafficOut, '#a855f7');
        drawDot(point.trafficIn, '#22c55e');
        drawDot(point.rps, '#3b82f6', scaleRps);

        // Tooltip Box
        const boxWidth = 140;
        const boxHeight = 85;
        let tx = x + 15;
        if (tx + boxWidth > width) tx = x - boxWidth - 15;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.roundRect(tx, 20, boxWidth, boxHeight, 6);
        ctx.fill();
        ctx.stroke();

        // Text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Inter';
        ctx.fillText(new Date(point.timestamp).toLocaleTimeString(), tx + 10, 40);

        ctx.font = '11px Inter';
        ctx.fillStyle = '#22c55e';
        ctx.fillText(`In: ${formatBytes(point.trafficIn)}/s`, tx + 10, 60);
        ctx.fillStyle = '#a855f7';
        ctx.fillText(`Out: ${formatBytes(point.trafficOut)}/s`, tx + 10, 75);
        ctx.fillStyle = '#3b82f6';
        ctx.fillText(`${point.rps.toFixed(1)} RPS`, tx + 10, 90);
      }
    }

    // Update Stats
    const lastPoint = dataPoints[dataPoints.length - 1];
    updateStats({
      requests_per_second: lastPoint.rps,
      traffic_in: lastPoint.trafficIn,
      traffic_out: lastPoint.trafficOut
    });
  }

  function render24hChart(ctx, width, height) {
    if (!state.metricsData || state.metricsData.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('No data available for the last 24h', width / 2, height / 2);
      return;
    }

    // 24h Window
    const now = Date.now() + state.serverTimeOffset;
    const timeWindow = 24 * 60 * 60 * 1000;
    const startTime = now - timeWindow;

    // Filter data within window
    const validData = state.metricsData.filter(d => {
      const t = new Date(d.bucket).getTime();
      return t >= startTime && t <= now;
    });

    if (validData.length < 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('Insufficient data for 24h view', width / 2, height / 2);
      return;
    }

    // Map to points
    const dataPoints = validData.map(d => {
      const t = new Date(d.bucket).getTime();
      return {
        x: ((t - startTime) / timeWindow) * width,
        trafficIn: Number(d.traffic_in),
        trafficOut: Number(d.traffic_out),
        rps: Number(d.requests_per_second),
        timestamp: t
      };
    }).sort((a, b) => a.timestamp - b.timestamp);

    // Draw Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const y = height - (height / 5) * i;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Scales
    const maxVal = Math.max(...dataPoints.map(p => Math.max(p.trafficIn, p.trafficOut)), 1024);
    const scaleY = (height - 40) / maxVal;
    const maxRps = Math.max(...dataPoints.map(p => p.rps), 5);
    const scaleRps = (height - 40) / maxRps;

    // Draw Function (Shared logic could be extracted, but keeping inline for now)
    const drawLine = (accessor, color, fill, scale) => {
      const s = scale || scaleY;
      ctx.beginPath();
      ctx.moveTo(dataPoints[0].x, height - (accessor(dataPoints[0]) * s));

      for (let i = 0; i < dataPoints.length - 1; i++) {
        const p0 = dataPoints[i];
        const p1 = dataPoints[i + 1];
        const y0 = height - (accessor(p0) * s);
        const y1 = height - (accessor(p1) * s);
        const midX = (p0.x + p1.x) / 2;
        const midY = (y0 + y1) / 2;
        ctx.quadraticCurveTo(p0.x, y0, midX, midY);
        ctx.quadraticCurveTo(midX, midY, p1.x, y1);
      }

      if (fill) {
        ctx.lineTo(dataPoints[dataPoints.length - 1].x, height);
        ctx.lineTo(dataPoints[0].x, height);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    };

    // Gradients
    const createGradient = (color) => {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, color.replace('0.4', '0.2'));
      g.addColorStop(1, color.replace('0.4', '0.0'));
      return g;
    };

    // Draw Layers
    drawLine(d => d.trafficOut, '#a855f7', createGradient('rgba(168, 85, 247, 0.4)'));
    drawLine(d => d.trafficOut, '#a855f7');

    drawLine(d => d.trafficIn, '#22c55e', createGradient('rgba(34, 197, 94, 0.4)'));
    drawLine(d => d.trafficIn, '#22c55e');

    drawLine(d => d.rps, '#3b82f6', createGradient('rgba(59, 130, 246, 0.4)'), scaleRps);
    drawLine(d => d.rps, '#3b82f6', null, scaleRps);

    // Hover & Tooltip
    if (state.isHovering && state.mouseX !== null) {
      const hoverTime = startTime + (state.mouseX / width) * timeWindow;
      const point = dataPoints.reduce((prev, curr) =>
        Math.abs(curr.timestamp - hoverTime) < Math.abs(prev.timestamp - hoverTime) ? curr : prev
      );

      if (point) {
        const x = point.x;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        const drawDot = (val, color, scale) => {
          const y = height - (val * (scale || scaleY));
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        };

        drawDot(point.trafficOut, '#a855f7');
        drawDot(point.trafficIn, '#22c55e');
        drawDot(point.rps, '#3b82f6', scaleRps);

        // Tooltip
        const boxWidth = 150;
        const boxHeight = 85;
        let tx = x + 15;
        if (tx + boxWidth > width) tx = x - boxWidth - 15;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.roundRect(tx, 20, boxWidth, boxHeight, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Inter';
        // Show full date for 24h view
        ctx.fillText(new Date(point.timestamp).toLocaleString(), tx + 10, 40);

        ctx.font = '11px Inter';
        ctx.fillStyle = '#22c55e';
        ctx.fillText(`In: ${formatBytes(point.trafficIn)}/s`, tx + 10, 60);
        ctx.fillStyle = '#a855f7';
        ctx.fillText(`Out: ${formatBytes(point.trafficOut)}/s`, tx + 10, 75);
        ctx.fillStyle = '#3b82f6';
        ctx.fillText(`${point.rps.toFixed(1)} RPS`, tx + 10, 90);
      }
    }
  }

  function updateStats(metric) {
    if (!metric) return;
    if (els['stat-rps']) els['stat-rps'].textContent = Number(metric.requests_per_second).toFixed(1);
    if (els['stat-traffic-in']) els['stat-traffic-in'].textContent = formatBytes(metric.traffic_in) + '/s';
    if (els['stat-traffic-out']) els['stat-traffic-out'].textContent = formatBytes(metric.traffic_out) + '/s';
  }

  // --- Details Handlers ---
  function showCertificateDetails(domain) {
    els.certDomain.value = domain;
    els.certContent.value = 'Loading...';
    els.certKey.value = 'Loading...';
    openModal('certModal');

    requestJson(`/api/certificates/${domain}`)
      .then(res => {
        els.certContent.value = res.cert;
        els.certKey.value = res.key;
      })
      .catch(err => {
        const msg = err.message.toLowerCase();
        if (msg.includes('404') || msg.includes('not found')) {
          els.certContent.value = 'No certificate found for this domain.';
          els.certKey.value = '';
        } else {
          els.certContent.value = 'Error loading certificate: ' + err.message;
          els.certKey.value = '';
          notify('Failed to load certificate details', 'error');
        }
      });
  }
  window.showCertificateDetails = showCertificateDetails;

  function showDomainDetails(domain) {
    state.editingDomainId = domain.id;
    els.editDomainHostname.value = domain.hostname;
    populateProxySelect(els.editDomainProxySelect);
    els.editDomainProxySelect.value = domain.proxy_id;
    populateBackendSelect(els.editDomainBackendSelect);
    els.editDomainBackendSelect.value = domain.backend_id;
    switchView('domain-details');
  }

  function showProxyDetails(proxy) {
    state.editingProxyId = proxy.id;
    els.editProxyName.value = proxy.name;
    els.editProxyListenHost.value = proxy.listen_host;
    els.editProxyListenPort.value = proxy.listen_port;
    els.editProxyProtocol.value = proxy.protocol || 'tcp';
    populateBackendSelect(els.editProxyBackendSelect);

    const backend = state.backends.find(b =>
      b.target_host === proxy.target_host &&
      b.target_port === proxy.target_port &&
      (b.target_protocol || 'http') === (proxy.target_protocol || 'http')
    );
    els.editProxyBackendSelect.value = backend ? backend.id : "";
    switchView('proxy-details');
  }

  function showBackendDetails(backend) {
    state.editingBackendId = backend.id;
    els.editBackendName.value = backend.name;
    els.editBackendTargetHost.value = backend.target_host;
    els.editBackendTargetPort.value = backend.target_port;
    els.editBackendTargetProtocol.value = backend.target_protocol || 'http';
    switchView('backend-details');
  }

  async function handleDomainUpdate(e) {
    e.preventDefault();
    if (!state.editingDomainId) return;
    try {
      await requestJson(`/api/domains/${state.editingDomainId}`, {
        method: 'PUT',
        body: {
          hostname: els.editDomainHostname.value,
          proxyId: els.editDomainProxySelect.value,
          backendId: els.editDomainBackendSelect.value
        }
      });
      notify('Domain updated');
      await loadData('domains');
      navigateTo('/domains');
    } catch (err) { notify('Error updating domain', 'error'); }
  }

  async function handleProxyUpdate(e) {
    e.preventDefault();
    if (!state.editingProxyId) return;
    const backendId = els.editProxyBackendSelect.value;
    const payload = {
      name: els.editProxyName.value,
      listen_host: els.editProxyListenHost.value,
      listen_port: Number(els.editProxyListenPort.value),
      protocol: els.editProxyProtocol.value,
      enabled: true
    };

    if (backendId) {
      const backend = state.backends.find(b => String(b.id) === String(backendId));
      if (backend) {
        payload.target_host = backend.target_host;
        payload.target_port = Number(backend.target_port);
        payload.target_protocol = backend.target_protocol;
      }
    } else {
      payload.target_host = '127.0.0.1';
      payload.target_port = 80;
      payload.target_protocol = 'http';
    }

    try {
      await requestJson(`/api/proxies/${state.editingProxyId}`, { method: 'PUT', body: payload });
      notify('Proxy updated');
      await loadData('proxies');
      navigateTo('/proxies');
    } catch (err) { notify('Error updating proxy', 'error'); }
  }

  async function handleBackendUpdate(e) {
    e.preventDefault();
    if (!state.editingBackendId) return;
    try {
      await requestJson(`/api/backends/${state.editingBackendId}`, {
        method: 'PUT',
        body: {
          name: els.editBackendName.value,
          targetHost: els.editBackendTargetHost.value,
          targetPort: Number(els.editBackendTargetPort.value),
          targetProtocol: els.editBackendTargetProtocol.value
        }
      });
      notify('Backend updated');
      await loadData('backends');
      navigateTo('/backends');
    } catch (err) { notify('Error updating backend', 'error'); }
  }

  async function deleteDomain() {
    if (!state.editingDomainId || !confirm('Delete this domain?')) return;
    try {
      await requestJson(`/api/domains/${state.editingDomainId}`, { method: 'DELETE' });
      notify('Domain deleted');
      await loadData('domains');
      navigateTo('/domains');
    } catch (err) { notify('Error deleting domain', 'error'); }
  }

  async function deleteProxy() {
    if (!state.editingProxyId || !confirm('Delete this proxy?')) return;
    try {
      await requestJson(`/api/proxies/${state.editingProxyId}`, { method: 'DELETE' });
      notify('Proxy deleted');
      await loadData('proxies');
      navigateTo('/proxies');
    } catch (err) { notify('Error deleting proxy', 'error'); }
  }

  async function deleteBackend() {
    if (!state.editingBackendId || !confirm('Delete this backend?')) return;
    try {
      await requestJson(`/api/backends/${state.editingBackendId}`, { method: 'DELETE' });
      notify('Backend deleted');
      await loadData('backends');
      navigateTo('/backends');
    } catch (err) { notify('Error deleting backend', 'error'); }
  }

  // --- Creation Handlers ---
  async function handleProxySubmit(e) {
    e.preventDefault();
    const backendId = document.getElementById('proxyBackendSelect').value;
    const payload = {
      name: document.getElementById('proxyName').value,
      listen_host: document.getElementById('proxyListenHost').value,
      listen_port: Number(document.getElementById('proxyListenPort').value),
      protocol: document.getElementById('proxyProtocol').value,
      enabled: true
    };

    if (backendId) {
      const backend = state.backends.find(b => String(b.id) === String(backendId));
      if (backend) {
        payload.target_host = backend.target_host;
        payload.target_port = Number(backend.target_port);
        payload.target_protocol = backend.target_protocol;
      }
    } else {
      payload.target_host = '127.0.0.1';
      payload.target_port = 80;
      payload.target_protocol = 'http';
    }

    try {
      await requestJson('/api/proxies', { method: 'POST', body: payload });
      notify('Proxy created');
      closeModal('proxyModal');
      e.target.reset();
      loadData('proxies');
    } catch (err) { notify('Error creating proxy', 'error'); }
  }

  async function handleBackendSubmit(e) {
    e.preventDefault();
    try {
      await requestJson('/api/backends', {
        method: 'POST',
        body: {
          name: document.getElementById('backendName').value,
          targetHost: document.getElementById('backendTargetHost').value,
          targetPort: Number(document.getElementById('backendTargetPort').value),
          targetProtocol: document.getElementById('backendTargetProtocol').value
        }
      });
      notify('Backend created');
      closeModal('backendModal');
      e.target.reset();
      loadData('backends');
    } catch (err) { notify('Error creating backend', 'error'); }
  }

  async function handleDomainSubmit(e) {
    e.preventDefault();
    try {
      await requestJson('/api/domains', {
        method: 'POST',
        body: {
          hostname: document.getElementById('domainHostname').value,
          proxyId: document.getElementById('domainProxySelect').value,
          backendId: document.getElementById('domainBackendSelect').value
        }
      });
      notify('Domain created');
      closeModal('domainModal');
      e.target.reset();
      loadData('domains');
    } catch (err) { notify('Error creating domain', 'error'); }
  }

  window.generateCertificate = async function (domain) {
    if (!confirm(`Generate certificate for ${domain}? This may take a few moments.`)) return;
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
      await requestJson('/api/certificates/generate', { method: 'POST', body: { domain } });
      notify('Certificate generated successfully');
      await loadData('certificates');
    } catch (err) {
      notify('Generation failed: ' + err.message, 'error');
      btn.textContent = originalText;
      btn.disabled = false;
    }
  };

  // --- Utils ---
  async function requestJson(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (options.body) options.body = JSON.stringify(options.body);
    const res = await fetch(url, { headers, ...options });
    if (res.status === 401) {
      window.location.href = '/login.html';
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function isNetworkError(err) {
    return err.name === 'TypeError' && (err.message.includes('NetworkError') || err.message.includes('fetch'));
  }

  function notify(msg, type = 'success') {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function populateBackendSelect(select) {
    if (!select) return;
    select.innerHTML = '<option value="">Select Backend</option>';
    state.backends.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.name}(${b.target_host}: ${b.target_port})`;
      select.appendChild(opt);
    });
  }

  function populateProxySelect(select) {
    if (!select) return;
    select.innerHTML = '<option value="">Select Proxy</option>';
    state.proxies.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name}(${p.listen_host}: ${p.listen_port})`;
      select.appendChild(opt);
    });
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('open');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('open');
  }

})();
