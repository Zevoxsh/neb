const { Pool } = require('pg');
require('dotenv').config();

let pool = null;

function createPool() {
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

  const newPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    user: process.env.DB_USER || 'postgres',
    password: password,
    database: process.env.DB_NAME || 'test',
    
    // Optimisations de pool
    max: 20, // Max 20 connexions
    min: 2, // Min 2 connexions toujours actives
    idleTimeoutMillis: 30000, // Ferme après 30s d'inactivité
    connectionTimeoutMillis: 5000, // Timeout de connexion 5s
    
    // Optimisations de performance
    statement_timeout: 10000, // 10s max par requête
    query_timeout: 10000,
    
    // Gestion des erreurs
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
  });

  // Gestion des événements
  newPool.on('error', (err, client) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });

  newPool.on('connect', (client) => {
    // Optimisations PostgreSQL par connexion
    client.query('SET work_mem = \'64MB\'').catch(e => {});
    client.query('SET maintenance_work_mem = \'128MB\'').catch(e => {});
  });
  
  return newPool;
}

// Créer le pool initial
pool = createPool();

// Fonction pour recréer le pool avec les nouvelles variables d'environnement
async function recreatePool() {
  if (pool) {
    try {
      await pool.end();
      console.log('Old database pool closed');
    } catch (error) {
      console.error('Error closing old pool:', error.message);
    }
  }
  
  pool = createPool();
  console.log('New database pool created with updated configuration');
  return pool;
}

// Exporter le pool et la fonction de recréation
module.exports = pool;
module.exports.recreatePool = recreatePool;
