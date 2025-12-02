(function(){
  // Metrics module: responsible for fetching, smoothing and rendering charts
  const metrics = {
    state: null,
    els: null,
    animationId: null,
    dpr: 1
  };

  function init(stateObj, elements) {
    metrics.state = stateObj;
    metrics.els = elements;
    metrics.dpr = window.devicePixelRatio || 1;
  }

  async function loadMetrics() {
    try {
      const state = metrics.state;
      const els = metrics.els;
      const url = state.viewMode === 'realtime'
        ? `/api/metrics/combined?last=65&interval=1`
        : `/api/metrics/combined?last=86400&interval=3600`;

      const res = await window.api.requestJson(url);
      if (res && res.metrics) {
        try { console.debug('metrics.loadMetrics: metrics count', Array.isArray(res.metrics) ? res.metrics.length : 'not-array'); } catch(e){}

        let metricsRows = res.metrics;
        if (Array.isArray(metricsRows) && metricsRows.length && metricsRows[0].hasOwnProperty('proxy_id')) {
          const map = new Map();
          for (const r of metricsRows) {
            const key = new Date(r.bucket).toISOString();
            if (!map.has(key)) map.set(key, { bucket: key, bytes_in: 0, bytes_out: 0, requests: 0 });
            const cur = map.get(key);
            cur.bytes_in += Number(r.bytes_in) || 0;
            cur.bytes_out += Number(r.bytes_out) || 0;
            cur.requests += Number(r.requests) || 0;
          }
          metricsRows = Array.from(map.values()).sort((a,b)=>new Date(a.bucket)-new Date(b.bucket));
        }

        const incoming = metricsRows.map(m => ({
          bucket: m.bucket,
          timestamp: m.bucket,
          requests_per_second: Number(m.requests),
          traffic_in: Number(m.bytes_in),
          traffic_out: Number(m.bytes_out)
        }));

        const alpha = 0.25;
        if (!state.metricsSmoothed || state.metricsSmoothed.length === 0) {
          state.metricsSmoothed = incoming.map(d => Object.assign({}, d));
        } else {
          const prevMap = new Map(state.metricsSmoothed.map(d => [new Date(d.bucket).getTime(), d]));
          const next = [];
          for (const inc of incoming) {
            const t = new Date(inc.bucket).getTime();
            if (prevMap.has(t)) {
              const prev = prevMap.get(t);
              next.push({
                bucket: inc.bucket,
                timestamp: inc.timestamp,
                requests_per_second: prev.requests_per_second * (1 - alpha) + inc.requests_per_second * alpha,
                traffic_in: prev.traffic_in * (1 - alpha) + inc.traffic_in * alpha,
                traffic_out: prev.traffic_out * (1 - alpha) + inc.traffic_out * alpha
              });
            } else {
              const keys = Array.from(prevMap.keys()).sort((a,b)=>a-b);
              const lastKey = keys.length ? keys[keys.length-1] : null;
              if (lastKey) {
                const prev = prevMap.get(lastKey);
                next.push({
                  bucket: inc.bucket,
                  timestamp: inc.timestamp,
                  requests_per_second: prev.requests_per_second * (1 - alpha) + inc.requests_per_second * alpha,
                  traffic_in: prev.traffic_in * (1 - alpha) + inc.traffic_in * alpha,
                  traffic_out: prev.traffic_out * (1 - alpha) + inc.traffic_out * alpha
                });
              } else {
                next.push(Object.assign({}, inc));
              }
            }
          }
          state.metricsSmoothed = next;
        }
        state.metricsData = incoming;

        if (state.viewMode === 'realtime' && res.serverTime && state.serverTimeOffset === 0) {
          state.serverTimeOffset = new Date(res.serverTime).getTime() - Date.now();
        } else if (state.viewMode !== 'realtime') {
          try {
            const canvas = els.trafficChart;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              const dpr = metrics.dpr;
              const rect = canvas.getBoundingClientRect();
              canvas.width = rect.width * dpr;
              canvas.height = rect.height * dpr;
              try { ctx.setTransform(1,0,0,1,0,0); } catch(e){}
              ctx.scale(dpr, dpr);
              render24hChart(ctx, rect.width, rect.height);
            }
          } catch (e) { console.error('metrics.loadMetrics draw24h error', e); }
        }
      } else {
        try { console.debug('metrics.loadMetrics: no metrics in response', res); } catch(e){}
      }
    } catch (e) {
      if (window.api.isNetworkError(e)) console.log('Metrics connection lost, retrying...');
      else console.error('metrics.loadMetrics error', e);
    }
  }

  function startAnimation() {
    if (metrics.animationId) return;
    let lastTime = performance.now();
    function loop(now) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      updateChart(dt);
      metrics.animationId = requestAnimationFrame(loop);
    }
    metrics.animationId = requestAnimationFrame(loop);
  }

  function stopAnimation() {
    if (metrics.animationId) {
      cancelAnimationFrame(metrics.animationId);
      metrics.animationId = null;
    }
  }

  function updateChart(dt) {
    const els = metrics.els; const state = metrics.state;
    const canvas = els.trafficChart; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = metrics.dpr;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    try { ctx.setTransform(1,0,0,1,0,0); } catch(e){}
    ctx.scale(dpr, dpr);
    const width = rect.width; const height = rect.height;
    ctx.clearRect(0,0,width,height);
    if (state.viewMode === 'realtime') renderRealtimeChart(ctx, width, height);
    else render24hChart(ctx, width, height);
  }

  function renderRealtimeChart(ctx, width, height) {
    const state = metrics.state;
    const dataSrc = state.metricsSmoothed && state.metricsSmoothed.length ? state.metricsSmoothed : state.metricsData;
    if (!dataSrc || dataSrc.length === 0) return;
    const now = Date.now() + state.serverTimeOffset;
    const timeWindow = 60 * 1000;
    const startTime = now - timeWindow;

    const dataPoints = [];
    const startAligned = Math.ceil(startTime / 1000) * 1000;
    const endAligned = Math.floor(now / 1000) * 1000;
    for (let t = startAligned; t <= endAligned; t += 1000) {
      const m = dataSrc.find(d => new Date(d.bucket).getTime() === t);
      dataPoints.push({ x: ((t - startTime)/timeWindow)*width, trafficIn: m?Number(m.traffic_in||m.trafficIn):0, trafficOut: m?Number(m.traffic_out||m.trafficOut):0, rps: m?Number(m.requests_per_second||m.requests):0, timestamp: t });
    }
    if (dataPoints.length < 2) return;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i=0;i<6;i++){ const y = height - (height/5)*i; ctx.moveTo(0,y); ctx.lineTo(width,y); }
    ctx.stroke();

    const maxVal = Math.max(...dataPoints.map(p=>Math.max(p.trafficIn,p.trafficOut)), 1024);
    const scaleY = (height-40)/maxVal;
    const maxRps = Math.max(...dataPoints.map(p=>p.rps), 5);
    const scaleRps = (height-40)/maxRps;

    const drawLine = (accessor, color, fill, scale) => {
      const s = scale || scaleY;
      ctx.beginPath(); ctx.moveTo(dataPoints[0].x, height - (accessor(dataPoints[0]) * s));
      for (let i=0;i<dataPoints.length-1;i++){ const p0=dataPoints[i], p1=dataPoints[i+1]; const y0=height-(accessor(p0)*s); const y1=height-(accessor(p1)*s); const midX=(p0.x+p1.x)/2; const midY=(y0+y1)/2; ctx.quadraticCurveTo(p0.x,y0,midX,midY); ctx.quadraticCurveTo(midX,midY,p1.x,y1); }
      if (fill){ ctx.lineTo(dataPoints[dataPoints.length-1].x, height); ctx.lineTo(dataPoints[0].x, height); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
      else { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.shadowColor=color; ctx.shadowBlur=10; ctx.stroke(); ctx.shadowBlur=0; }
    };

    const createGradient = (color) => { const g = ctx.createLinearGradient(0,0,0,height); g.addColorStop(0, color.replace('0.4','0.2')); g.addColorStop(1, color.replace('0.4','0.0')); return g; };

    drawLine(d=>d.trafficOut,'#a855f7', createGradient('rgba(168, 85, 247, 0.4)'));
    drawLine(d=>d.trafficOut,'#a855f7');
    drawLine(d=>d.trafficIn,'#22c55e', createGradient('rgba(34, 197, 94, 0.4)'));
    drawLine(d=>d.trafficIn,'#22c55e');
    drawLine(d=>d.rps,'#3b82f6', createGradient('rgba(59, 130, 246, 0.4)'), scaleRps);
    drawLine(d=>d.rps,'#3b82f6', null, scaleRps);

    if (state.isHovering && state.mouseX !== null) {
      const hoverTime = startTime + (state.mouseX / width) * timeWindow;
      const point = dataPoints.reduce((prev,curr)=> Math.abs(curr.timestamp - hoverTime) < Math.abs(prev.timestamp-hoverTime) ? curr : prev);
      if (point) {
        const x = point.x;
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.setLineDash([5,5]); ctx.stroke(); ctx.setLineDash([]);
        const drawDot = (val, color, scale) => { const y = height - (val * (scale || scaleY)); ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke(); };
        drawDot(point.trafficOut, '#a855f7'); drawDot(point.trafficIn, '#22c55e'); drawDot(point.rps, '#3b82f6', scaleRps);
        const boxWidth = 140; const boxHeight = 85; let tx = x+15; if (tx + boxWidth > width) tx = x - boxWidth - 15;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)'; ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=1; ctx.roundRect(tx,20,boxWidth,boxHeight,6); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#fff'; ctx.font='bold 12px Inter'; ctx.fillText(new Date(point.timestamp).toLocaleTimeString(), tx+10, 40);
        ctx.font='11px Inter'; ctx.fillStyle='#22c55e'; ctx.fillText(`In: ${window.ui.formatBytes(point.trafficIn)}/s`, tx+10, 60); ctx.fillStyle='#a855f7'; ctx.fillText(`Out: ${window.ui.formatBytes(point.trafficOut)}/s`, tx+10, 75); ctx.fillStyle='#3b82f6'; ctx.fillText(`${point.rps.toFixed(1)} RPS`, tx+10, 90);
      }
    }

    const lastPoint = dataPoints[dataPoints.length-1];
    updateStats({ requests_per_second: lastPoint.rps, traffic_in: lastPoint.trafficIn, traffic_out: lastPoint.trafficOut });
  }

  function render24hChart(ctx, width, height) {
    const state = metrics.state;
    const dataSrc = state.metricsSmoothed && state.metricsSmoothed.length ? state.metricsSmoothed : state.metricsData;
    if (!dataSrc || dataSrc.length === 0) {
      ctx.fillStyle = '#94a3b8'; ctx.font='14px Inter'; ctx.textAlign='center'; ctx.fillText('No data available for the last 24h', width/2, height/2); return; }
    const now = Date.now() + state.serverTimeOffset; const timeWindow = 24*60*60*1000; const startTime = now - timeWindow;
    const validData = dataSrc.filter(d => { const t = new Date(d.bucket).getTime(); return t >= startTime && t <= now; });
    if (validData.length < 2) { ctx.fillStyle='#94a3b8'; ctx.font='14px Inter'; ctx.textAlign='center'; ctx.fillText('Insufficient data for 24h view', width/2, height/2); return; }
    const dataPoints = validData.map(d=>{ const t=new Date(d.bucket).getTime(); return { x: ((t-startTime)/timeWindow)*width, trafficIn: Number(d.traffic_in||d.trafficIn), trafficOut: Number(d.traffic_out||d.trafficOut), rps: Number(d.requests_per_second||d.requests), timestamp: t }; }).sort((a,b)=>a.timestamp-b.timestamp);
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1; ctx.beginPath(); for (let i=0;i<6;i++){ const y = height - (height/5)*i; ctx.moveTo(0,y); ctx.lineTo(width,y);} ctx.stroke();
    const maxVal = Math.max(...dataPoints.map(p=>Math.max(p.trafficIn,p.trafficOut)), 1024); const scaleY = (height-40)/maxVal; const maxRps = Math.max(...dataPoints.map(p=>p.rps),5); const scaleRps = (height-40)/maxRps;
    const drawLine = (accessor, color, fill, scale) => { const s = scale || scaleY; ctx.beginPath(); ctx.moveTo(dataPoints[0].x, height - (accessor(dataPoints[0]) * s)); for (let i=0;i<dataPoints.length-1;i++){ const p0=dataPoints[i], p1=dataPoints[i+1]; const y0 = height - (accessor(p0) * s); const y1 = height - (accessor(p1) * s); const midX = (p0.x + p1.x)/2; const midY = (y0 + y1)/2; ctx.quadraticCurveTo(p0.x,y0,midX,midY); ctx.quadraticCurveTo(midX,midY,p1.x,y1);} if (fill){ ctx.lineTo(dataPoints[dataPoints.length-1].x, height); ctx.lineTo(dataPoints[0].x, height); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); } else { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.shadowColor=color; ctx.shadowBlur=10; ctx.stroke(); ctx.shadowBlur=0; } };
    const createGradient = (color)=>{ const g = ctx.createLinearGradient(0,0,0,height); g.addColorStop(0, color.replace('0.4','0.2')); g.addColorStop(1, color.replace('0.4','0.0')); return g; };
    drawLine(d=>d.trafficOut,'#a855f7', createGradient('rgba(168, 85, 247, 0.4)')); drawLine(d=>d.trafficOut,'#a855f7'); drawLine(d=>d.trafficIn,'#22c55e', createGradient('rgba(34, 197, 94, 0.4)')); drawLine(d=>d.trafficIn,'#22c55e'); drawLine(d=>d.rps,'#3b82f6', createGradient('rgba(59, 130, 246, 0.4)'), scaleRps); drawLine(d=>d.rps,'#3b82f6', null, scaleRps);
    if (state.isHovering && state.mouseX !== null) {
      const hoverTime = startTime + (state.mouseX/width)*timeWindow; const point = dataPoints.reduce((prev,curr)=> Math.abs(curr.timestamp-hoverTime) < Math.abs(prev.timestamp-hoverTime) ? curr : prev);
      if (point) {
        const x = point.x; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.setLineDash([5,5]); ctx.stroke(); ctx.setLineDash([]);
        const drawDot = (val, color, scale)=>{ const y = height - (val * (scale || scaleY)); ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke(); };
        drawDot(point.trafficOut,'#a855f7'); drawDot(point.trafficIn,'#22c55e'); drawDot(point.rps,'#3b82f6', scaleRps);
        const boxWidth=150, boxHeight=85; let tx=x+15; if (tx+boxWidth>width) tx = x - boxWidth - 15; ctx.fillStyle='rgba(15, 23, 42, 0.95)'; ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=1; ctx.roundRect(tx,20,boxWidth,boxHeight,6); ctx.fill(); ctx.stroke(); ctx.fillStyle='#fff'; ctx.font='bold 12px Inter'; ctx.fillText(new Date(point.timestamp).toLocaleString(), tx+10, 40); ctx.font='11px Inter'; ctx.fillStyle='#22c55e'; ctx.fillText(`In: ${window.ui.formatBytes(point.trafficIn)}/s`, tx+10,60); ctx.fillStyle='#a855f7'; ctx.fillText(`Out: ${window.ui.formatBytes(point.trafficOut)}/s`, tx+10,75); ctx.fillStyle='#3b82f6'; ctx.fillText(`${point.rps.toFixed(1)} RPS`, tx+10,90);
      }
    }
  }

  function updateStats(metric) {
    if (!metric) return;
    if (document.getElementById('stat-rps')) document.getElementById('stat-rps').textContent = Number(metric.requests_per_second).toFixed(1);
    if (document.getElementById('stat-traffic-in')) document.getElementById('stat-traffic-in').textContent = window.ui.formatBytes(metric.traffic_in) + '/s';
    if (document.getElementById('stat-traffic-out')) document.getElementById('stat-traffic-out').textContent = window.ui.formatBytes(metric.traffic_out) + '/s';
  }

  window.metrics = { init, loadMetrics, startAnimation, stopAnimation };
})();
