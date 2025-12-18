/**
 * NEBULA - Shared UI Components & Utilities
 * Reusable functions for building consistent interfaces
 */

// Toast Notifications
window.showToast = function(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('toast-show'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

// Loading Spinner
window.createLoadingSpinner = function(text = 'Loading...') {
  return `
    <div class="loading-state">
      <div class="spinner-large"></div>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
};

// Empty State
window.createEmptyState = function(icon, title, description, actionText, actionHref) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${actionText ? `<button class="btn primary" onclick="window.location.href='${actionHref}'">${escapeHtml(actionText)}</button>` : ''}
    </div>
  `;
};

// Error State
window.createErrorState = function(title, message, onRetry) {
  const retryBtn = onRetry ? `<button class="btn secondary" onclick="${onRetry}">Retry</button>` : '';
  return `
    <div class="error-state">
      <div class="error-icon">⚠️</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${retryBtn}
    </div>
  `;
};

// Badge Component
window.createBadge = function(text, variant = 'neutral') {
  return `<span class="badge badge-${variant}">${escapeHtml(text)}</span>`;
};

// Status Badge (for enabled/disabled states)
window.createStatusBadge = function(enabled) {
  if (enabled) {
    return '<span class="badge badge-success">✓ Active</span>';
  } else {
    return '<span class="badge badge-neutral">○ Inactive</span>';
  }
};

// Protocol Badge
window.createProtocolBadge = function(protocol) {
  const map = {
    'http': { icon: '🌐', variant: 'info', label: 'HTTP' },
    'https': { icon: '🔒', variant: 'success', label: 'HTTPS' },
    'tcp': { icon: '🔌', variant: 'primary', label: 'TCP' },
    'udp': { icon: '📡', variant: 'primary', label: 'UDP' }
  };
  const config = map[protocol?.toLowerCase()] || { icon: '○', variant: 'neutral', label: protocol };
  return `<span class="badge badge-${config.variant}">${config.icon} ${config.label}</span>`;
};

// Confirmation Dialog
window.confirmAction = async function(message, title = 'Confirm Action') {
  return confirm(`${title}\n\n${message}\n\nThis action cannot be undone.`);
};

// Format Date
window.formatDate = function(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Format Number with commas
window.formatNumber = function(num) {
  if (num === null || num === undefined) return '0';
  return num.toLocaleString();
};

// HTML Escape
window.escapeHtml = function(text) {
  if (text === null || text === undefined) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
};

// Copy to Clipboard
window.copyToClipboard = async function(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('✓ Copied to clipboard', 'success');
  } catch (err) {
    showToast('Failed to copy', 'error');
  }
};

// Modal Controller
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
};

// Click outside modal to close
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
    document.body.style.overflow = '';
  }
});

// API Helper with better error handling
window.apiRequest = async function(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return { success: true, data };
  } catch (error) {
    console.error(`API Error [${url}]:`, error);
    return { success: false, error: error.message };
  }
};

// Debounce function for search inputs
window.debounce = function(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Stats Card Component
window.createStatCard = function(icon, value, label, trend = null) {
  const trendHtml = trend ? `<span class="stat-trend stat-trend-${trend.direction}">${trend.value}</span>` : '';
  return `
    <div class="stat-card">
      <div class="stat-icon">${icon}</div>
      <div class="stat-content">
        <div class="stat-value">${escapeHtml(value)}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
        ${trendHtml}
      </div>
    </div>
  `;
};

// Table Component Helper
window.createTable = function(columns, rows, options = {}) {
  const headers = columns.map(col => `<th>${escapeHtml(col.label)}</th>`).join('');
  const rowsHtml = rows.map(row => {
    const cells = columns.map(col => {
      const value = col.render ? col.render(row) : row[col.key];
      return `<td>${value}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <div class="table-container">
      <table class="data-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
};

// Card Component
window.createCard = function(title, content, actions = '') {
  return `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">${escapeHtml(title)}</h2>
        ${actions ? `<div class="card-actions">${actions}</div>` : ''}
      </div>
      <div class="card-body">
        ${content}
      </div>
    </div>
  `;
};

console.log('[Components] Loaded successfully');
