const pool = require('../config/db');
const monthlyReportModel = require('../models/monthlyReportModel');
const { logger } = require('../utils/logger');

class MonthlyReportService {
  /**
   * Generate a monthly report for the previous month
   * Called automatically on the 1st of each month
   */
  async generateMonthlyReport(targetMonth = null) {
    try {
      // Calculate previous month if no target specified
      const now = new Date();
      const reportDate = targetMonth ? new Date(targetMonth) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const reportMonthStr = reportDate.toISOString().split('T')[0]; // YYYY-MM-01
      
      logger.info(`Generating monthly report for ${reportMonthStr}`);

      // Get previous snapshot for comparison
      const previousSnapshot = await monthlyReportModel.getLatestSnapshot();

      // Collect current stats
      const currentStats = await this.collectCurrentStats();

      // Calculate deltas (added/deleted) by comparing with previous snapshot
      const deltas = this.calculateDeltas(currentStats, previousSnapshot);

      // Get time-based stats for the report month
      const monthlyStats = await this.collectMonthlyStats(reportDate);

      // Build report data
      const reportData = {
        reportMonth: reportMonthStr,
        domains: {
          total: currentStats.domains,
          added: deltas.domainsAdded,
          deleted: deltas.domainsDeleted
        },
        proxies: {
          total: currentStats.proxies,
          added: deltas.proxiesAdded,
          deleted: deltas.proxiesDeleted
        },
        backends: {
          total: currentStats.backends,
          added: deltas.backendsAdded,
          deleted: deltas.backendsDeleted
        },
        requests: {
          total: monthlyStats.totalRequests,
          uniqueIps: monthlyStats.uniqueIps,
          uniqueDomains: monthlyStats.uniqueDomains
        },
        security: {
          totalAlerts: monthlyStats.totalAlerts,
          blockedIps: currentStats.blockedIps,
          trustedIps: currentStats.trustedIps
        },
        certificates: {
          active: currentStats.certificates,
          issued: monthlyStats.certificatesIssued,
          renewed: monthlyStats.certificatesRenewed
        },
        users: {
          total: currentStats.users,
          active: monthlyStats.activeUsers
        },
        additionalData: {
          generatedAt: new Date().toISOString(),
          topDomains: monthlyStats.topDomains,
          topIPs: monthlyStats.topIPs
        }
      };

      // Save report
      const report = await monthlyReportModel.createMonthlyReport(reportData);

      // Create snapshot for next month's comparison
      await monthlyReportModel.createSnapshot(reportMonthStr, {
        domains: currentStats.domains,
        proxies: currentStats.proxies,
        backends: currentStats.backends,
        certificates: currentStats.certificates,
        users: currentStats.users
      });

      // Clear dismissed logs older than 90 days
      await this.clearOldDismissedLogs();

      logger.info(`Monthly report generated successfully for ${reportMonthStr}`);
      return report;

    } catch (error) {
      logger.error('Error generating monthly report:', error);
      throw error;
    }
  }

  /**
   * Collect current counts from all tables
   */
  async collectCurrentStats() {
    const stats = {};

    // Domains
    const domainsResult = await pool.query('SELECT COUNT(*) as count FROM domains');
    stats.domains = parseInt(domainsResult.rows[0]?.count || 0);

    // Proxies
    const proxiesResult = await pool.query('SELECT COUNT(*) as count FROM proxies');
    stats.proxies = parseInt(proxiesResult.rows[0]?.count || 0);

    // Backends
    const backendsResult = await pool.query('SELECT COUNT(*) as count FROM backends');
    stats.backends = parseInt(backendsResult.rows[0]?.count || 0);

    // Certificates
    const certsResult = await pool.query('SELECT COUNT(*) as count FROM certificates WHERE status = $1', ['valid']);
    stats.certificates = parseInt(certsResult.rows[0]?.count || 0);

    // Users
    const usersResult = await pool.query('SELECT COUNT(*) as count FROM users');
    stats.users = parseInt(usersResult.rows[0]?.count || 0);

    // Blocked IPs
    const blockedResult = await pool.query('SELECT COUNT(*) as count FROM blocked_ips');
    stats.blockedIps = parseInt(blockedResult.rows[0]?.count || 0);

    // Trusted IPs
    const trustedResult = await pool.query('SELECT COUNT(*) as count FROM trusted_ips');
    stats.trustedIps = parseInt(trustedResult.rows[0]?.count || 0);

    return stats;
  }

  /**
   * Calculate deltas (added/deleted) by comparing current with previous snapshot
   */
  calculateDeltas(current, previous) {
    if (!previous) {
      // First report - everything is "added"
      return {
        domainsAdded: current.domains,
        domainsDeleted: 0,
        proxiesAdded: current.proxies,
        proxiesDeleted: 0,
        backendsAdded: current.backends,
        backendsDeleted: 0
      };
    }

    return {
      domainsAdded: Math.max(0, current.domains - previous.domains_count),
      domainsDeleted: Math.max(0, previous.domains_count - current.domains),
      proxiesAdded: Math.max(0, current.proxies - previous.proxies_count),
      proxiesDeleted: Math.max(0, previous.proxies_count - current.proxies),
      backendsAdded: Math.max(0, current.backends - previous.backends_count),
      backendsDeleted: Math.max(0, previous.backends_count - current.backends)
    };
  }

  /**
   * Collect stats for a specific month from time-based tables
   */
  async collectMonthlyStats(reportDate) {
    const startDate = new Date(reportDate.getFullYear(), reportDate.getMonth(), 1);
    const endDate = new Date(reportDate.getFullYear(), reportDate.getMonth() + 1, 0, 23, 59, 59);

    const stats = {};

    // Total requests for the month
    const requestsResult = await pool.query(
      'SELECT COUNT(*) as count FROM request_logs WHERE timestamp >= $1 AND timestamp <= $2',
      [startDate, endDate]
    );
    stats.totalRequests = parseInt(requestsResult.rows[0]?.count || 0);

    // Unique IPs
    const uniqueIpsResult = await pool.query(
      'SELECT COUNT(DISTINCT client_ip) as count FROM request_logs WHERE timestamp >= $1 AND timestamp <= $2',
      [startDate, endDate]
    );
    stats.uniqueIps = parseInt(uniqueIpsResult.rows[0]?.count || 0);

    // Unique domains
    const uniqueDomainsResult = await pool.query(
      'SELECT COUNT(DISTINCT hostname) as count FROM request_logs WHERE timestamp >= $1 AND timestamp <= $2',
      [startDate, endDate]
    );
    stats.uniqueDomains = parseInt(uniqueDomainsResult.rows[0]?.count || 0);

    // Total alerts
    const alertsResult = await pool.query(
      'SELECT COUNT(*) as count FROM security_alerts WHERE timestamp >= $1 AND timestamp <= $2',
      [startDate, endDate]
    );
    stats.totalAlerts = parseInt(alertsResult.rows[0]?.count || 0);

    // Certificates issued/renewed
    const certsIssuedResult = await pool.query(
      'SELECT COUNT(*) as count FROM certificates WHERE created_at >= $1 AND created_at <= $2',
      [startDate, endDate]
    );
    stats.certificatesIssued = parseInt(certsIssuedResult.rows[0]?.count || 0);

    const certsRenewedResult = await pool.query(
      'SELECT COUNT(*) as count FROM certificates WHERE updated_at >= $1 AND updated_at <= $2 AND created_at < $1',
      [startDate, endDate]
    );
    stats.certificatesRenewed = parseInt(certsRenewedResult.rows[0]?.count || 0);

    // Active users (logged in during the month)
    const activeUsersResult = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE last_login >= $1 AND last_login <= $2',
      [startDate, endDate]
    );
    stats.activeUsers = parseInt(activeUsersResult.rows[0]?.count || 0);

    // Top 10 domains by requests
    const topDomainsResult = await pool.query(
      `SELECT hostname, COUNT(*) as count 
       FROM request_logs 
       WHERE timestamp >= $1 AND timestamp <= $2 
       GROUP BY hostname 
       ORDER BY count DESC 
       LIMIT 10`,
      [startDate, endDate]
    );
    stats.topDomains = topDomainsResult.rows;

    // Top 10 IPs by requests
    const topIPsResult = await pool.query(
      `SELECT client_ip, COUNT(*) as count 
       FROM request_logs 
       WHERE timestamp >= $1 AND timestamp <= $2 
       GROUP BY client_ip 
       ORDER BY count DESC 
       LIMIT 10`,
      [startDate, endDate]
    );
    stats.topIPs = topIPsResult.rows;

    return stats;
  }

  /**
   * Clear dismissed logs older than 90 days to keep database clean
   */
  async clearOldDismissedLogs() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    try {
      // Delete old dismissed request logs
      const requestsResult = await pool.query(
        'DELETE FROM request_logs WHERE dismissed_at IS NOT NULL AND dismissed_at < $1',
        [cutoffDate]
      );

      // Delete old dismissed alerts
      const alertsResult = await pool.query(
        'DELETE FROM security_alerts WHERE dismissed_at IS NOT NULL AND dismissed_at < $1',
        [cutoffDate]
      );

      logger.info(`Cleaned up old dismissed logs: ${requestsResult.rowCount} requests, ${alertsResult.rowCount} alerts`);
    } catch (error) {
      logger.error('Error cleaning up old dismissed logs:', error);
    }
  }
}

module.exports = new MonthlyReportService();
