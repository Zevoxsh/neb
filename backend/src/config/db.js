const { Pool } = require('pg');
require('dotenv').config();

const rawPassword = process.env.DB_PASSWORD;
// coerce to string and strip accidental code-fence wrappers that can appear
// when .env was edited with markdown fences (e.g. ```dotenv ... ```)
let password = '';
if (rawPassword === undefined || rawPassword === null) {
  password = '';
} else {
  password = String(rawPassword).trim();
  // remove leading ```lang or ``` and trailing ``` markers
  password = password.replace(/^```[^\n]*\n?/, '');
  password = password.replace(/\n?```$/g, '');
  password = password.trim();
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  user: process.env.DB_USER || 'postgres',
  password: password,
  database: process.env.DB_NAME || 'test'
});

module.exports = pool;
