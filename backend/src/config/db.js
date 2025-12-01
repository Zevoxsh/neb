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
  database: process.env.DB_NAME || 'test',
  
  // Optimisations de pool
  max: 20, // Max 20 connexions
  min: 2, // Min 2 connexions toujours actives
  idleTimeoutMillis: 30000, // Ferme après 30s d\'inactivité
  connectionTimeoutMillis: 5000, // Timeout de connexion 5s
  
  // Optimisations de performance
  statement_timeout: 10000, // 10s max par requête
  query_timeout: 10000,
  
  // Gestion des erreurs
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// Gestion des événements
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

pool.on('connect', (client) => {
  // Optimisations PostgreSQL par connexion
  client.query('SET work_mem = \'64MB\'').catch(e => {});
  client.query('SET maintenance_work_mem = \'128MB\'').catch(e => {});
});

module.exports = pool;
