// Backup & Restore handlers
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const btnExport = document.getElementById('btnExportConfig');
        const btnImport = document.getElementById('btnImportConfig');
        const fileInput = document.getElementById('importFile');

        if (btnExport) {
            btnExport.addEventListener('click', async () => {
                try {
                    btnExport.disabled = true;
                    btnExport.textContent = '⏳ Export en cours...';

                    const response = await fetch('/api/backup/export', {
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

                        if (window.showToast) window.showToast('Configuration exportée !');
                    } else {
                        throw new Error('Export failed');
                    }
                } catch (err) {
                    console.error('Export error', err);
                    if (window.showToast) window.showToast('Erreur export', 'error');
                } finally {
                    btnExport.disabled = false;
                    btnExport.textContent = '📥 Télécharger backup';
                }
            });
        }

        if (btnImport && fileInput) {
            btnImport.addEventListener('click', () => {
                fileInput.click();
            });

            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (!confirm('⚠️ ATTENTION: Cette action va AJOUTER les éléments du backup à votre configuration actuelle. Continuer ?')) {
                    fileInput.value = '';
                    return;
                }

                try {
                    btnImport.disabled = true;
                    btnImport.textContent = '⏳ Import en cours...';

                    const text = await file.text();
                    const backup = JSON.parse(text);

                    const response = await fetch('/api/backup/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(backup)
                    });

                    if (response.ok) {
                        const result = await response.json();
                        if (window.showToast) {
                            const msg = `Import OK: ${result.stats.proxiesCreated} proxies, ${result.stats.backendsCreated} backends, ${result.stats.domainsCreated} domaines`;
                            window.showToast(msg);
                        }

                        // Reload page after 2s
                        setTimeout(() => window.location.reload(), 2000);
                    } else {
                        const error = await response.json();
                        throw new Error(error.message || 'Import failed');
                    }
                } catch (err) {
                    console.error('Import error', err);
                    if (window.showToast) window.showToast('Erreur import: ' + err.message, 'error');
                } finally {
                    btnImport.disabled = false;
                    btnImport.textContent = '📤 Importer backup';
                    fileInput.value = '';
                }
            });
        }
    });
})();
