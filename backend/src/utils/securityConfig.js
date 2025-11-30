const DEFAULT_SECURITY_CONFIG = {
  autoBlockIps: true,
  autoAlertDomains: true,
  ipBytesThreshold: 50 * 1024 * 1024,
  ipRequestsThreshold: 1000,
  domainBytesThreshold: 100 * 1024 * 1024,
  domainRequestsThreshold: 5000,
  smtp: {
    host: '',
    port: 465,
    user: '',
    pass: '',
    from: '',
    to: ''
  }
};

function normalizeSecurityConfig(raw) {
  let obj = {};
  if (typeof raw === 'string' && raw.trim()) {
    try { obj = JSON.parse(raw); } catch (e) { obj = {}; }
  } else if (raw && typeof raw === 'object') {
    obj = raw;
  }
  const smtp = obj.smtp || {};
  return {
    autoBlockIps: typeof obj.autoBlockIps === 'boolean' ? obj.autoBlockIps : DEFAULT_SECURITY_CONFIG.autoBlockIps,
    autoAlertDomains: typeof obj.autoAlertDomains === 'boolean' ? obj.autoAlertDomains : DEFAULT_SECURITY_CONFIG.autoAlertDomains,
    ipBytesThreshold: Number(obj.ipBytesThreshold) || DEFAULT_SECURITY_CONFIG.ipBytesThreshold,
    ipRequestsThreshold: Number(obj.ipRequestsThreshold) || DEFAULT_SECURITY_CONFIG.ipRequestsThreshold,
    domainBytesThreshold: Number(obj.domainBytesThreshold) || DEFAULT_SECURITY_CONFIG.domainBytesThreshold,
    domainRequestsThreshold: Number(obj.domainRequestsThreshold) || DEFAULT_SECURITY_CONFIG.domainRequestsThreshold,
    smtp: {
      host: smtp.host || DEFAULT_SECURITY_CONFIG.smtp.host,
      port: Number(smtp.port) || DEFAULT_SECURITY_CONFIG.smtp.port,
      user: smtp.user || DEFAULT_SECURITY_CONFIG.smtp.user,
      pass: smtp.pass || DEFAULT_SECURITY_CONFIG.smtp.pass,
      from: smtp.from || DEFAULT_SECURITY_CONFIG.smtp.from,
      to: smtp.to || DEFAULT_SECURITY_CONFIG.smtp.to
    }
  };
}

module.exports = { DEFAULT_SECURITY_CONFIG, normalizeSecurityConfig };
