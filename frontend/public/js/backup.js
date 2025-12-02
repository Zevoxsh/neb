// Backup & Restore handlers
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const btnExPort = document.getElementById('btnExPortConfig');
        const btnImPort = document.getElementById('btnImPortConfig');
        const fileInput = document.getElementById('imPortFile');

        if (btnExPort) {
            btnExPort.addEventListener('click', async () => {
                try {
                    btnExPort.disabled = true;
                    btnExPort.textContent = '⏳ ExPort en cours...';

                    const response = await fetch('/api/backup/exPort', {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    if (response.ok) {
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `neb-backup-${new Date().toISOString().split('T')[0]}.json`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);

                        if (window.showToast) window.showToast('Configuration exported!');
                    } else {
                        throw new Error('ExPort failed');
                    }
                } catch (err) {
                    console.error('ExPort error', err);
                    if (window.showToast) window.showToast('Error exPort', 'error');
                } finally {
                    btnExPort.disabled = false;
                    btnExPort.textContent = 'Download backup';
                }
            });
        }

        if (btnImPort && fileInput) {
            btnImPort.addEventListener('click', () => {
                fileInput.click();
            });

            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (!confirm('⚠️ Warning: This action will add backup items to your current configuration. Continue?')) {
                    fileInput.value = '';
                    return;
                }

                try {
                    btnImPort.disabled = true;
                    btnImPort.textContent = '⏳ ImPort en cours...';

                    const text = await file.text();
                    const backup = JSON.parse(text);

                    const response = await fetch('/api/backup/imPort', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(backup)
                    });

                    if (response.ok) {
                        const result = await response.json();
                        if (window.showToast) {
                            const msg = `ImPort OK: ${result.stats.proxiesCreated} proxies, ${result.stats.backendsCreated} backends, ${result.stats.domainsCreated} Domains`;
                            window.showToast(msg);
                        }

                        // Reload page after 2s
                        setTimeout(() => window.location.reload(), 2000);
                    } else {
                        const error = await response.json();
                        throw new Error(error.message || 'ImPort failed');
                    }
                } catch (err) {
                    console.error('ImPort error', err);
                    if (window.showToast) window.showToast('Error imPort: ' + err.message, 'error');
                } finally {
                    btnImPort.disabled = false;
                    btnImPort.textContent = '📤 ImPorter backup';
                    fileInput.value = '';
                }
            });
        }
    });
})();
