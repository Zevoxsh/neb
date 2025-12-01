const nodemailer = require('nodemailer');

let transporter = null;
let currentSettings = {
  host: process.env.ALERT_SMTP_HOST || '',
  port: Number(process.env.ALERT_SMTP_PORT) || 465,
  user: process.env.ALERT_SMTP_USER || '',
  pass: process.env.ALERT_SMTP_PASS || '',
  from: process.env.ALERT_EMAIL_FROM || '',
  to: process.env.ALERT_EMAIL_TO || ''
};

// Email throttling to prevent spam
const emailThrottle = new Map(); // type+ip => last email timestamp
const EMAIL_COOLDOWN = 5 * 60 * 1000; // 5 minutes between emails for same type+IP

// Alert deduplication cache
const recentAlerts = new Map(); // type+ip+severity => { count, firstSeen, lastSeen }
const ALERT_DEDUP_WINDOW = 60 * 1000; // 1 minute window for deduplication

function configure(settings = {}) {
  currentSettings = Object.assign({}, currentSettings, settings);
  transporter = null;
}

function getTransporter() {
  if (!currentSettings.host || !currentSettings.from || !currentSettings.to) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: currentSettings.host,
    port: Number(currentSettings.port) || 465,
    secure: true,
    auth: currentSettings.user ? {
      user: currentSettings.user,
      pass: currentSettings.pass || ''
    } : undefined
  });
  return transporter;
}

async function sendTrafficAlert(subject, message) {
  try {
    const tx = getTransporter();
    if (!tx) {
      // Silent skip if SMTP not configured
      return false;
    }
    await tx.sendMail({
      from: currentSettings.from,
      to: currentSettings.to,
      subject,
      text: message
    });
    return true;
  } catch (e) {
    // Only log error once per minute to avoid spam
    const now = Date.now();
    const lastLog = emailThrottle.get('smtp_error') || 0;
    if (now - lastLog > 60000) {
      console.error('alertService: SMTP error (will retry in 1 min):', e.message);
      emailThrottle.set('smtp_error', now);
    }
    return false;
  }
}

function shouldSendEmail(type, ipAddress, severity) {
  // Don't send emails for medium/low severity
  if (severity !== 'critical' && severity !== 'high') {
    return false;
  }
  
  const throttleKey = `${type}:${ipAddress}`;
  const now = Date.now();
  const lastEmail = emailThrottle.get(throttleKey);
  
  // Check if we sent an email recently for this type+IP
  if (lastEmail && (now - lastEmail) < EMAIL_COOLDOWN) {
    return false;
  }
  
  // Update last email time
  emailThrottle.set(throttleKey, now);
  return true;
}

async function createSecurityAlert({ type, severity, ipAddress, hostname, message, details }) {
  try {
    const now = Date.now();
    const dedupKey = `${type}:${ipAddress}:${severity}`;
    
    // Check if we already have a recent similar alert
    const recent = recentAlerts.get(dedupKey);
    if (recent) {
      // Update count and last seen
      recent.count++;
      recent.lastSeen = now;
      
      // Only create DB entry every 10 occurrences during dedup window
      if (recent.count % 10 !== 0) {
        return true;
      }
      
      // Update message to include count
      message = `${message} (${recent.count} occurrences in last minute)`;
    } else {
      // New alert, start tracking
      recentAlerts.set(dedupKey, {
        count: 1,
        firstSeen: now,
        lastSeen: now
      });
      
      // Clean old entries
      for (const [key, data] of recentAlerts.entries()) {
        if (now - data.lastSeen > ALERT_DEDUP_WINDOW) {
          recentAlerts.delete(key);
        }
      }
    }
    
    const alertModel = require('../models/alertModel');
    await alertModel.createAlert({
      type,
      severity,
      ipAddress,
      hostname,
      message,
      details
    });
    
    // Send email only if throttle allows it
    if (shouldSendEmail(type, ipAddress, severity)) {
      const occurrences = recent ? recent.count : 1;
      await sendTrafficAlert(
        `[NEBULA] ${severity.toUpperCase()} Security Alert: ${type}`,
        `${message}\n\nIP: ${ipAddress || 'N/A'}\nHostname: ${hostname || 'N/A'}\nTime: ${new Date().toISOString()}\nOccurrences: ${occurrences}\n\nDetails: ${JSON.stringify(details, null, 2)}`
      );
    }
    
    return true;
  } catch (error) {
    console.error('Failed to create security alert:', error.message);
    return false;
  }
}

configure(currentSettings);

module.exports = { sendTrafficAlert, configure, createSecurityAlert };
