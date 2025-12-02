(function(){
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

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '0 B';
    bytes = Number(bytes) || 0;
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

  function populateBackendSelect(select, backends) {
    if (!select) return;
    select.innerHTML = '<option value="">Select Backend</option>';
    (backends || window.state && window.state.backends || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.name}(${b.target_host}: ${b.target_Port})`;
      select.appendChild(opt);
    });
  }

  function populateProxySelect(select, proxies) {
    if (!select) return;
    select.innerHTML = '<option value="">Select Proxy</option>';
    (proxies || window.state && window.state.proxies || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name}(${p.listen_host}: ${p.listen_Port})`;
      select.appendChild(opt);
    });
  }

  window.ui = { notify, escapeHtml, formatBytes, openModal, closeModal, populateBackendSelect, populateProxySelect };
  // Backwards compat
  window.notify = notify;
  window.escapeHtml = escapeHtml;
  window.formatBytes = formatBytes;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.populateBackendSelect = populateBackendSelect;
  window.populateProxySelect = populateProxySelect;
})();
