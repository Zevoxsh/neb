const pool = require('../config/db');

async function createMonthlyReport(reportData) {
  const query = `
    INSERT INTO monthly_reports (
      report_month,
      domains_total,
      domains_added,
      domains_deleted,
      proxies_total,
      proxies_added,
      proxies_deleted,
      backends_total,
      backends_added,
      backends_deleted,
      total_requests,
      unique_ips,
      unique_domains,
      total_alerts,
      blocked_ips,
      trusted_ips,
      active_certificates,
      certificates_issued,
      certificates_renewed,
      total_users,
      active_users,
      additional_data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    ON CONFLICT (report_month) 
    DO UPDATE SET
      generated_at = NOW(),
      domains_total = EXCLUDED.domains_total,
      domains_added = EXCLUDED.domains_added,
      domains_deleted = EXCLUDED.domains_deleted,
      proxies_total = EXCLUDED.proxies_total,
      proxies_added = EXCLUDED.proxies_added,
      proxies_deleted = EXCLUDED.proxies_deleted,
      backends_total = EXCLUDED.backends_total,
      backends_added = EXCLUDED.backends_added,
      backends_deleted = EXCLUDED.backends_deleted,
      total_requests = EXCLUDED.total_requests,
      unique_ips = EXCLUDED.unique_ips,
      unique_domains = EXCLUDED.unique_domains,
      total_alerts = EXCLUDED.total_alerts,
      blocked_ips = EXCLUDED.blocked_ips,
      trusted_ips = EXCLUDED.trusted_ips,
      active_certificates = EXCLUDED.active_certificates,
      certificates_issued = EXCLUDED.certificates_issued,
      certificates_renewed = EXCLUDED.certificates_renewed,
      total_users = EXCLUDED.total_users,
      active_users = EXCLUDED.active_users,
      additional_data = EXCLUDED.additional_data
    RETURNING *
  `;

  const result = await pool.query(query, [
    reportData.reportMonth,
    reportData.domains.total,
    reportData.domains.added,
    reportData.domains.deleted,
    reportData.proxies.total,
    reportData.proxies.added,
    reportData.proxies.deleted,
    reportData.backends.total,
    reportData.backends.added,
    reportData.backends.deleted,
    reportData.requests.total,
    reportData.requests.uniqueIps,
    reportData.requests.uniqueDomains,
    reportData.security.totalAlerts,
    reportData.security.blockedIps,
    reportData.security.trustedIps,
    reportData.certificates.active,
    reportData.certificates.issued,
    reportData.certificates.renewed,
    reportData.users.total,
    reportData.users.active,
    JSON.stringify(reportData.additionalData)
  ]);

  return result.rows[0];
}

async function getAllReports({ limit = 12, offset = 0 } = {}) {
  const query = `
    SELECT *
    FROM monthly_reports
    ORDER BY report_month DESC
    LIMIT $1 OFFSET $2
  `;

  const result = await pool.query(query, [limit, offset]);
  return result.rows;
}

async function getReportByMonth(reportMonth) {
  const query = `
    SELECT *
    FROM monthly_reports
    WHERE report_month = $1
  `;

  const result = await pool.query(query, [reportMonth]);
  return result.rows[0];
}

async function getTotalReportCount() {
  const query = `SELECT COUNT(*) as total FROM monthly_reports`;
  const result = await pool.query(query);
  return result.rows[0]?.total || 0;
}

// Snapshot functions
async function createSnapshot(snapshotDate, counts) {
  const query = `
    INSERT INTO monthly_snapshots (
      snapshot_date,
      domains_count,
      proxies_count,
      backends_count,
      certificates_count,
      users_count
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (snapshot_date)
    DO UPDATE SET
      domains_count = EXCLUDED.domains_count,
      proxies_count = EXCLUDED.proxies_count,
      backends_count = EXCLUDED.backends_count,
      certificates_count = EXCLUDED.certificates_count,
      users_count = EXCLUDED.users_count
    RETURNING *
  `;

  const result = await pool.query(query, [
    snapshotDate,
    counts.domains,
    counts.proxies,
    counts.backends,
    counts.certificates,
    counts.users
  ]);

  return result.rows[0];
}

async function getSnapshotByDate(snapshotDate) {
  const query = `
    SELECT *
    FROM monthly_snapshots
    WHERE snapshot_date = $1
  `;

  const result = await pool.query(query, [snapshotDate]);
  return result.rows[0];
}

async function getLatestSnapshot() {
  const query = `
    SELECT *
    FROM monthly_snapshots
    ORDER BY snapshot_date DESC
    LIMIT 1
  `;

  const result = await pool.query(query);
  return result.rows[0];
}

module.exports = {
  createMonthlyReport,
  getAllReports,
  getReportByMonth,
  getTotalReportCount,
  createSnapshot,
  getSnapshotByDate,
  getLatestSnapshot
};
