// Analytics Page Logic

(function () {
    let latencyChart = null;
    let statusChart = null;
    let currentRange = '24h';

    document.addEventListener('DOMContentLoaded', () => {
        initAnalytics();
    });

    function initAnalytics() {
        // Setup range buttons
        document.getElementById('btnView24h').addEventListener('click', () => setRange('24h'));
        document.getElementById('btnView7d').addEventListener('click', () => setRange('7d'));

        loadData();
        // Refresh every 60s
        setInterval(loadData, 60000);
    }

    function setRange(range) {
        currentRange = range;
        document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
        document.getElementById(`btnView${range}`).classList.add('active');
        loadData();
    }

    async function loadData() {
        try {
            const now = new Date();
            let from = new Date(now.getTime() - 24 * 3600 * 1000);
            if (currentRange === '7d') {
                from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
            }

            const res = await window.api.requestJson(`/api/metrics/advanced?from=${from.toISOString()}&to=${now.toISOString()}`);
            if (!res || res.status !== 200) throw new Error('Failed to fetch metrics');
            const data = res.body;
            renderCharts(data);
        } catch (e) {
            console.error('Analytics load failed', e);
        }
    }

    function renderCharts(data) {
        renderLatencyChart(data.latency);
        renderStatusChart(data.statusCodes);
    }

    function renderLatencyChart(latency) {
        const ctx = document.getElementById('latencyChart').getContext('2d');
        const p50 = latency.p50 || 0;
        const p95 = latency.p95 || 0;
        const p99 = latency.p99 || 0;

        if (latencyChart) latencyChart.destroy();

        latencyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['P50 (Median)', 'P95', 'P99'],
                datasets: [{
                    label: 'Latence (ms)',
                    data: [p50, p95, p99],
                    backgroundColor: [
                        'rgba(75, 192, 192, 0.5)',
                        'rgba(255, 206, 86, 0.5)',
                        'rgba(255, 99, 132, 0.5)'
                    ],
                    borderColor: [
                        'rgba(75, 192, 192, 1)',
                        'rgba(255, 206, 86, 1)',
                        'rgba(255, 99, 132, 1)'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'ms' } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    function renderStatusChart(statusCodes) {
        const ctx = document.getElementById('statusChart').getContext('2d');

        // Group by 2xx, 3xx, 4xx, 5xx
        const groups = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
        (statusCodes || []).forEach(item => {
            const code = item.status_code;
            const count = item.count;
            if (code >= 200 && code < 300) groups['2xx'] += count;
            else if (code >= 300 && code < 400) groups['3xx'] += count;
            else if (code >= 400 && code < 500) groups['4xx'] += count;
            else if (code >= 500) groups['5xx'] += count;
        });

        if (statusChart) statusChart.destroy();

        statusChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Success (2xx)', 'Redirects (3xx)', 'Client Errors (4xx)', 'Server Errors (5xx)'],
                datasets: [{
                    data: [groups['2xx'], groups['3xx'], groups['4xx'], groups['5xx']],
                    backgroundColor: [
                        '#10b981', // green
                        '#3b82f6', // blue
                        '#f59e0b', // amber
                        '#ef4444'  // red
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right' }
                }
            }
        });
    }
})();
