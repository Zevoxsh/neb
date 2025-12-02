const pool = require('../config/db');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AuditLogger');

/**
 * Audit Logging Service
 * Tracks all administrative actions for compliance and security auditing
 */

class AuditLoggerService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Log an action
   * @param {Object} params - Action parameters
   * @param {string} params.action - Action type (CREATE, UPDATE, DELETE, LOGIN, etc.)
   * @param {string} params.resource - Resource type (proxy, backend, domain, user, etc.)
   * @param {number|string} params.resourceId - ID of the affected resource
   * @param {number} params.userId - ID of user performing action
   * @param {string} params.username - Username of user
   * @param {string} params.ipAddress - IP address of request
   * @param {Object} params.changes - Object with before/after values
   * @param {string} params.status - Action status (success, failure)
   * @param {string} params.errorMessage - Error message if status is failure
   * @param {Object} params.metadata - Additional metadata
   */
  async log({
    action,
    resource,
    resourceId = null,
    userId,
    username,
    ipAddress,
    changes = null,
    status = 'success',
    errorMessage = null,
    metadata = null
  }) {
    try {
      await pool.query(`
        INSERT INTO audit_logs (
          action, resource, resource_id, user_id, username,
          ip_address, changes, status, error_message, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        action,
        resource,
        resourceId,
        userId,
        username,
        ipAddress,
        changes ? JSON.stringify(changes) : null,
        status,
        errorMessage,
        metadata ? JSON.stringify(metadata) : null
      ]);

      logger.debug('Audit log recorded', {
        action,
        resource,
        resourceId,
        username,
        status
      });
    } catch (error) {
      // Silently ignore if audit_logs table doesn't exist yet
      if (error.code !== '42P01') {
        logger.error('Failed to write audit log', { error: error.message });
      }
    }
  }

  /**
   * Log a successful action
   */
  async logSuccess({ action, resource, resourceId, userId, username, ipAddress, changes, metadata }) {
    return this.log({
      action,
      resource,
      resourceId,
      userId,
      username,
      ipAddress,
      changes,
      status: 'success',
      metadata
    });
  }

  /**
   * Log a failed action
   */
  async logFailure({ action, resource, resourceId, userId, username, ipAddress, errorMessage, metadata }) {
    return this.log({
      action,
      resource,
      resourceId,
      userId,
      username,
      ipAddress,
      status: 'failure',
      errorMessage,
      metadata
    });
  }

  /**
   * Query audit logs
   * @param {Object} filters - Query filters
   * @param {string} filters.action - Filter by action
   * @param {string} filters.resource - Filter by resource
   * @param {number} filters.userId - Filter by user
   * @param {string} filters.username - Filter by username
   * @param {string} filters.status - Filter by status
   * @param {Date} filters.startDate - Filter by start date
   * @param {Date} filters.endDate - Filter by end date
   * @param {number} filters.limit - Limit results (default 100)
   * @param {number} filters.offset - Offset for pagination
   */
  async query({
    action = null,
    resource = null,
    userId = null,
    username = null,
    status = null,
    startDate = null,
    endDate = null,
    limit = 100,
    offset = 0
  } = {}) {
    try {
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      if (action) {
        query += ` AND action = $${paramIndex++}`;
        params.push(action);
      }

      if (resource) {
        query += ` AND resource = $${paramIndex++}`;
        params.push(resource);
      }

      if (userId) {
        query += ` AND user_id = $${paramIndex++}`;
        params.push(userId);
      }

      if (username) {
        query += ` AND username = $${paramIndex++}`;
        params.push(username);
      }

      if (status) {
        query += ` AND status = $${paramIndex++}`;
        params.push(status);
      }

      if (startDate) {
        query += ` AND created_at >= $${paramIndex++}`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND created_at <= $${paramIndex++}`;
        params.push(endDate);
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);

      return result.rows;
    } catch (error) {
      if (error.code === '42P01') {
        // Table doesn't exist yet
        return [];
      }
      throw error;
    }
  }

  /**
   * Get audit log statistics
   */
  async getStats({ startDate = null, endDate = null } = {}) {
    try {
      let dateFilter = '';
      const params = [];

      if (startDate) {
        dateFilter += ' AND created_at >= $1';
        params.push(startDate);
      }

      if (endDate) {
        dateFilter += params.length > 0 ? ' AND created_at <= $2' : ' AND created_at <= $1';
        params.push(endDate);
      }

      // Total actions
      const totalResult = await pool.query(
        `SELECT COUNT(*) as total FROM audit_logs WHERE 1=1 ${dateFilter}`,
        params
      );

      // By action type
      const byActionResult = await pool.query(
        `SELECT action, COUNT(*) as count FROM audit_logs WHERE 1=1 ${dateFilter} GROUP BY action ORDER BY count DESC`,
        params
      );

      // By resource type
      const byResourceResult = await pool.query(
        `SELECT resource, COUNT(*) as count FROM audit_logs WHERE 1=1 ${dateFilter} GROUP BY resource ORDER BY count DESC`,
        params
      );

      // By user
      const byUserResult = await pool.query(
        `SELECT username, COUNT(*) as count FROM audit_logs WHERE 1=1 ${dateFilter} GROUP BY username ORDER BY count DESC LIMIT 10`,
        params
      );

      // Success vs failure
      const byStatusResult = await pool.query(
        `SELECT status, COUNT(*) as count FROM audit_logs WHERE 1=1 ${dateFilter} GROUP BY status`,
        params
      );

      return {
        total: parseInt(totalResult.rows[0].total),
        byAction: byActionResult.rows,
        byResource: byResourceResult.rows,
        byUser: byUserResult.rows,
        byStatus: byStatusResult.rows
      };
    } catch (error) {
      if (error.code === '42P01') {
        return { total: 0, byAction: [], byResource: [], byUser: [], byStatus: [] };
      }
      throw error;
    }
  }

  /**
   * Export audit logs to CSV
   */
  async exportToCSV(filters = {}) {
    const logs = await this.query({ ...filters, limit: 10000 });

    // CSV header
    let csv = 'ID,Timestamp,Action,Resource,Resource ID,User ID,Username,IP Address,Status,Error Message\n';

    // CSV rows
    for (const log of logs) {
      csv += [
        log.id,
        log.created_at,
        log.action,
        log.resource,
        log.resource_id || '',
        log.user_id || '',
        log.username || '',
        log.ip_address || '',
        log.status,
        (log.error_message || '').replace(/"/g, '""')
      ].join(',') + '\n';
    }

    return csv;
  }

  /**
   * Delete old audit logs (retention policy)
   * @param {number} retentionDays - Keep logs for this many days
   */
  async cleanup(retentionDays = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await pool.query(
        'DELETE FROM audit_logs WHERE created_at < $1',
        [cutoffDate]
      );

      const deletedCount = result.rowCount;

      logger.info('Audit log cleanup completed', {
        retentionDays,
        deletedCount,
        cutoffDate: cutoffDate.toISOString()
      });

      return deletedCount;
    } catch (error) {
      if (error.code === '42P01') {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Get audit log by ID
   */
  async getById(id) {
    try {
      const result = await pool.query(
        'SELECT * FROM audit_logs WHERE id = $1',
        [id]
      );

      return result.rows[0];
    } catch (error) {
      if (error.code === '42P01') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get recent actions for a specific resource
   */
  async getResourceHistory(resource, resourceId, limit = 50) {
    try {
      const result = await pool.query(
        `SELECT * FROM audit_logs
         WHERE resource = $1 AND resource_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [resource, resourceId, limit]
      );

      return result.rows;
    } catch (error) {
      if (error.code === '42P01') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get recent actions for a specific user
   */
  async getUserActivity(userId, limit = 50) {
    try {
      const result = await pool.query(
        `SELECT * FROM audit_logs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error) {
      if (error.code === '42P01') {
        return [];
      }
      throw error;
    }
  }
}

// Singleton instance
const auditLogger = new AuditLoggerService();

module.exports = auditLogger;
