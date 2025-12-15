const pool = require('./src/config/db');

(async () => {
  try {
    const res = await pool.query('SELECT id, name, listen_port, target_host, target_port, target_protocol, vhosts FROM proxies WHERE listen_port = 443');
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
