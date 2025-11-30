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
      console.warn('alertService: SMTP not configured, skipping alert');
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
    console.error('alertService: failed to send alert', e);
    return false;
  }
}

configure(currentSettings);

module.exports = { sendTrafficAlert, configure };
