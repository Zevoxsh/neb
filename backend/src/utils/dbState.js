// Global database connection state
let isConnected = false;

module.exports = {
  setConnected(value) {
    isConnected = value;
  },
  
  isConnected() {
    return isConnected;
  },
  
  // Returns a standard error for DB unavailable
  getUnavailableError() {
    return new Error('Database not connected - running in configuration mode');
  }
};
