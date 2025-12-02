const cron = require('node-cron');
const monthlyReportService = require('./monthlyReportService');
const logger = require('../utils/logger');

class SchedulerService {
  constructor() {
    this.jobs = [];
  }

  /**
   * Initialize all scheduled tasks
   */
  init() {
    logger.info('Initializing scheduled tasks...');

    // Generate monthly report on 1st day of each month at 00:05
    const monthlyReportJob = cron.schedule('5 0 1 * *', async () => {
      logger.info('Running scheduled monthly report generation...');
      try {
        await monthlyReportService.generateMonthlyReport();
        logger.info('Scheduled monthly report generation completed');
      } catch (error) {
        logger.error('Error in scheduled monthly report generation:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Europe/Paris' // Adjust to your timezone
    });

    this.jobs.push({
      name: 'Monthly Report Generation',
      schedule: '5 0 1 * *',
      job: monthlyReportJob
    });

    // Optional: Weekly cleanup of old dismissed logs (every Sunday at 03:00)
    const weeklyCleanupJob = cron.schedule('0 3 * * 0', async () => {
      logger.info('Running weekly cleanup of old dismissed logs...');
      try {
        await monthlyReportService.clearOldDismissedLogs();
        logger.info('Weekly cleanup completed');
      } catch (error) {
        logger.error('Error in weekly cleanup:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Europe/Paris'
    });

    this.jobs.push({
      name: 'Weekly Cleanup',
      schedule: '0 3 * * 0',
      job: weeklyCleanupJob
    });

    logger.info(`Initialized ${this.jobs.length} scheduled tasks`);
  }

  /**
   * Stop all scheduled tasks
   */
  stop() {
    logger.info('Stopping all scheduled tasks...');
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      logger.info(`Stopped scheduled task: ${name}`);
    });
  }

  /**
   * Get status of all scheduled tasks
   */
  getStatus() {
    return this.jobs.map(({ name, schedule, job }) => ({
      name,
      schedule,
      running: job.running
    }));
  }
}

module.exports = new SchedulerService();
