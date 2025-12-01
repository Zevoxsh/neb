/**
 * Logger Utility
 * Centralized logging with levels and formatting
 */

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

const COLORS = {
    ERROR: '\x1b[31m', // Red
    WARN: '\x1b[33m',  // Yellow
    INFO: '\x1b[36m',  // Cyan
    DEBUG: '\x1b[90m', // Gray
    RESET: '\x1b[0m'
};

class Logger {
    constructor(context = 'APP') {
        this.context = context;
        this.level = process.env.LOG_LEVEL || 'INFO';
        this.useColors = process.env.NO_COLOR !== 'true';
    }

    _shouldLog(level) {
        const levels = Object.keys(LOG_LEVELS);
        const currentIndex = levels.indexOf(this.level);
        const messageIndex = levels.indexOf(level);
        return messageIndex <= currentIndex;
    }

    _format(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const color = this.useColors ? COLORS[level] : '';
        const reset = this.useColors ? COLORS.RESET : '';

        let formatted = `${color}[${timestamp}] [${level}] [${this.context}]${reset} ${message}`;

        if (Object.keys(meta).length > 0) {
            formatted += ` ${JSON.stringify(meta)}`;
        }

        return formatted;
    }

    error(message, meta = {}) {
        if (!this._shouldLog('ERROR')) return;
        console.error(this._format('ERROR', message, meta));
    }

    warn(message, meta = {}) {
        if (!this._shouldLog('WARN')) return;
        console.warn(this._format('WARN', message, meta));
    }

    info(message, meta = {}) {
        if (!this._shouldLog('INFO')) return;
        console.log(this._format('INFO', message, meta));
    }

    debug(message, meta = {}) {
        if (!this._shouldLog('DEBUG')) return;
        console.log(this._format('DEBUG', message, meta));
    }
}

// Create default logger instance
const logger = new Logger();

// Export factory function and default instance
module.exports = {
    Logger,
    logger,
    createLogger: (context) => new Logger(context)
};
