// Utilitaire pour créer toutes les tables nécessaires
async function ensureAllTables(pool) {
        // users
        await pool.query(`CREATE TABLE IF NOT EXISTS users(
            id SERIAL PRIMARY KEY,
            username VARCHAR(191) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // proxies
        await pool.query(`CREATE TABLE IF NOT EXISTS proxies(
            id SERIAL PRIMARY KEY,
            name VARCHAR(191) NOT NULL,
            protocol VARCHAR(10) NOT NULL DEFAULT 'tcp',
            listen_protocol VARCHAR(10) NOT NULL DEFAULT 'tcp',
            target_protocol VARCHAR(10) NOT NULL DEFAULT 'tcp',
            listen_host VARCHAR(100) NOT NULL,
            listen_port INT NOT NULL,
            target_host VARCHAR(255) NOT NULL,
            target_port INT NOT NULL,
            vhosts JSONB,
            passthrough_tls BOOLEAN DEFAULT FALSE,
            enabled BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // backends
        await pool.query(`CREATE TABLE IF NOT EXISTS backends(
            id SERIAL PRIMARY KEY,
            name VARCHAR(191) NOT NULL UNIQUE,
            target_host VARCHAR(255) NOT NULL,
            target_port INT NOT NULL,
            target_protocol VARCHAR(10) NOT NULL DEFAULT 'http',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // domain_mappings
        await pool.query(`CREATE TABLE IF NOT EXISTS domain_mappings(
            id SERIAL PRIMARY KEY,
            hostname VARCHAR(255) NOT NULL UNIQUE,
            proxy_id INT NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
            backend_id INT NOT NULL REFERENCES backends(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // metrics
        await pool.query(`CREATE TABLE IF NOT EXISTS metrics(
            id SERIAL PRIMARY KEY,
            proxy_id INT REFERENCES proxies(id) ON DELETE CASCADE,
            ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            bytes_in BIGINT DEFAULT 0,
            bytes_out BIGINT DEFAULT 0,
            requests INT DEFAULT 0,
            latency_ms INT DEFAULT 0,
            status_code INT DEFAULT 0
        );`);
        // settings
        await pool.query(`CREATE TABLE IF NOT EXISTS settings(
            key VARCHAR(191) PRIMARY KEY,
            value TEXT
        );`);
        // blocked_ips
        await pool.query(`CREATE TABLE IF NOT EXISTS blocked_ips(
            id SERIAL PRIMARY KEY,
            ip VARCHAR(191) NOT NULL UNIQUE,
            reason TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // trusted_ips
        await pool.query(`CREATE TABLE IF NOT EXISTS trusted_ips(
            id SERIAL PRIMARY KEY,
            ip VARCHAR(191) NOT NULL UNIQUE,
            label TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // request_logs
        await pool.query(`CREATE TABLE IF NOT EXISTS request_logs(
            id SERIAL PRIMARY KEY,
            client_ip VARCHAR(191) NOT NULL,
            hostname VARCHAR(255),
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // security_alerts
        await pool.query(`CREATE TABLE IF NOT EXISTS security_alerts(
            id SERIAL PRIMARY KEY,
            alert_type VARCHAR(50) NOT NULL,
            severity VARCHAR(20) NOT NULL,
            ip_address VARCHAR(191),
            hostname VARCHAR(255),
            message TEXT NOT NULL,
            details JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // certificates
        await pool.query(`CREATE TABLE IF NOT EXISTS certificates(
            id SERIAL PRIMARY KEY,
            domain VARCHAR(255) NOT NULL UNIQUE,
            private_key TEXT NOT NULL,
            certificate TEXT NOT NULL,
            chain TEXT,
            expires_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`);
        // monthly_reports
        await pool.query(`CREATE TABLE IF NOT EXISTS monthly_reports (
            id SERIAL PRIMARY KEY,
            report_month DATE NOT NULL UNIQUE,
            generated_at TIMESTAMP DEFAULT NOW(),
            domains_total INTEGER DEFAULT 0,
            domains_added INTEGER DEFAULT 0,
            domains_deleted INTEGER DEFAULT 0,
            proxies_total INTEGER DEFAULT 0,
            proxies_added INTEGER DEFAULT 0,
            proxies_deleted INTEGER DEFAULT 0,
            backends_total INTEGER DEFAULT 0,
            backends_added INTEGER DEFAULT 0,
            backends_deleted INTEGER DEFAULT 0,
            total_requests BIGINT DEFAULT 0,
            unique_ips INTEGER DEFAULT 0,
            unique_domains INTEGER DEFAULT 0,
            total_alerts INTEGER DEFAULT 0,
            blocked_ips INTEGER DEFAULT 0,
            trusted_ips INTEGER DEFAULT 0,
            active_certificates INTEGER DEFAULT 0,
            certificates_issued INTEGER DEFAULT 0,
            certificates_renewed INTEGER DEFAULT 0,
            total_users INTEGER DEFAULT 0,
            active_users INTEGER DEFAULT 0,
            additional_data JSONB DEFAULT '{}'::jsonb
        );`);
        // monthly_snapshots
        await pool.query(`CREATE TABLE IF NOT EXISTS monthly_snapshots (
            id SERIAL PRIMARY KEY,
            snapshot_date DATE NOT NULL UNIQUE,
            domains_count INTEGER DEFAULT 0,
            proxies_count INTEGER DEFAULT 0,
            backends_count INTEGER DEFAULT 0,
            certificates_count INTEGER DEFAULT 0,
            users_count INTEGER DEFAULT 0
        );`);
        // backend_pools
        await pool.query(`CREATE TABLE IF NOT EXISTS backend_pools(
            id SERIAL PRIMARY KEY,
            name VARCHAR(191) NOT NULL UNIQUE,
            lb_algorithm VARCHAR(50) NOT NULL DEFAULT 'round-robin',
            health_check_enabled BOOLEAN DEFAULT TRUE,
            health_check_interval_ms INT DEFAULT 30000,
            health_check_path VARCHAR(255) DEFAULT '/',
            health_check_timeout_ms INT DEFAULT 2000,
            max_failures INT DEFAULT 3,
            failure_timeout_ms INT DEFAULT 60000,
            sticky_sessions BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )`);
        // backend_pool_members
        await pool.query(`CREATE TABLE IF NOT EXISTS backend_pool_members(
            id SERIAL PRIMARY KEY,
            pool_id INT NOT NULL REFERENCES backend_pools(id) ON DELETE CASCADE,
            backend_id INT NOT NULL REFERENCES backends(id) ON DELETE CASCADE,
            enabled BOOLEAN DEFAULT TRUE,
            priority INT DEFAULT 100,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            UNIQUE(pool_id, backend_id)
        )`);
}
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');

class InstallController {
    // Test de connexion à la base de données
    async testDatabaseConnection(req, res) {
        const { host, port, user, password, name } = req.body;

        try {
            // Test de connexion sans spécifier de base de données d'abord
            const testPool = new Pool({
                host,
                port,
                user,
                password,
                database: 'postgres', // Connexion à la base système
                connectionTimeoutMillis: 5000
            });

            // Test de connexion
            const client = await testPool.connect();
            
            // Vérifier si la base existe
            const dbCheckResult = await client.query(
                "SELECT 1 FROM pg_database WHERE datname = $1",
                [name]
            );

            const dbExists = dbCheckResult.rows.length > 0;
            
            client.release();
            await testPool.end();

            res.json({
                success: true,
                message: dbExists 
                    ? `Base de données "${name}" trouvée`
                    : `Connection successful. Database "${name}" will be created during installation`,
                databaseExists: dbExists
            });
        } catch (error) {
            console.error('❌ Connection test failed:', error);
            res.json({
                success: false,
                error: error.message
            });
        }
    }

    // Installation complète
    async completeInstallation(req, res) {
        const { database, security, admin } = req.body;

        try {
            // 1. Se connecter à PostgreSQL
            const pool = new Pool({
                host: database.host,
                port: database.port,
                user: database.user,
                password: database.password,
                database: 'postgres'
            });

            const client = await pool.connect();

            // 2. Créer la base de données si elle n'existe pas
            const dbName = database.name.trim(); // Nettoyer les espaces
            const dbCheckResult = await client.query(
                "SELECT 1 FROM pg_database WHERE datname = $1",
                [dbName]
            );

            if (dbCheckResult.rows.length === 0) {
                console.log(`📦 Creating database \"${dbName}\"...`);
                // Utiliser des identifiants quotés pour gérer les caractères spéciaux
                await client.query(`CREATE DATABASE \"${dbName}\"`);
                console.log(`✅ Database \"${dbName}\" created successfully`);
            } else {
                console.log(`ℹ️  Database \"${dbName}\" already exists`);
            }

            client.release();
            await pool.end();

            // 3. Se reconnecter à la nouvelle base de données
            const appPool = new Pool({
                host: database.host,
                port: database.port,
                user: database.user,
                password: database.password,
                database: dbName
            });

            const appClient = await appPool.connect();

            // 4. Créer toutes les tables nécessaires
            console.log('🛠️  Checking/creating all required tables...');
            await ensureAllTables(appClient);
            console.log('✅ All tables checked/created.');

            // 5. Créer l'utilisateur admin
            console.log('👤 Creating admin user...');
            const hashedPassword = await bcrypt.hash(admin.password, 10);
            await appClient.query(
                `INSERT INTO users (username, password_hash) 
                 VALUES ($1, $2) 
                 ON CONFLICT (username) DO UPDATE 
                 SET password_hash = $2`,
                [admin.username, hashedPassword]
            );

            // 6. Enregistrer la configuration dans la table settings
            console.log('⚙️ Saving configuration...');
            
            const settings = [
                // Database
                { key: 'database.host', value: database.host || 'localhost' },
                { key: 'database.port', value: String(database.port || 5432) },
                { key: 'database.user', value: database.user || 'postgres' },
                { key: 'database.password', value: database.password || '' },
                { key: 'database.name', value: dbName },
                // Security
                { key: 'security.jwtSecret', value: security.jwtSecret || '' },
                { key: 'security.cookieSecure', value: String(security.cookieSecure || false) },
                { key: 'security.acmeEmail', value: security.acmeEmail || '' },
                // Installation flag
                { key: 'system.installed', value: 'true' }
            ];

            for (const setting of settings) {
                await appClient.query(
                    `INSERT INTO settings (key, value) 
                     VALUES ($1, $2) 
                     ON CONFLICT (key) DO UPDATE SET value = $2`,
                    [setting.key, setting.value]
                );
            }

            appClient.release();
            await appPool.end();

            // 7. Créer un fichier .env local avec les informations de connexion
            const envContent = `# Configuration générée automatiquement lors de l'installation
# Base de données PostgreSQL
DB_HOST=${database.host}
DB_PORT=${database.port}
DB_USER=${database.user}
DB_PASSWORD=${database.password}
DB_NAME=${dbName}

# Sécurité
JWT_SECRET=${security.jwtSecret}
COOKIE_SECURE=${security.cookieSecure}
${security.acmeEmail ? `ACME_EMAIL=${security.acmeEmail}` : '# ACME_EMAIL='}

# Port de l'application
PORT=3000
`;

            const envPath = path.join(__dirname, '../../../.env');
            await fs.writeFile(envPath, envContent);

            console.log('✅ Installation completed successfully!');

            res.json({
                success: true,
                message: 'Installation completed successfully'
            });

        } catch (error) {
            console.error('❌ Error during installation:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Vérifier si l'installation est requise
    async checkInstallationStatus(req, res) {
        try {
            // Vérifier si le fichier .env existe et contient les informations DB
            const envPath = path.join(__dirname, '../../../.env');
            
            try {
                const envContent = await fs.readFile(envPath, 'utf8');
                const hasDbConfig = envContent.includes('DB_HOST') && 
                                   envContent.includes('DB_NAME');
                
                if (!hasDbConfig) {
                    return res.json({ 
                        installed: false,
                        reason: 'Configuration de base de données manquante'
                    });
                }

                // Essayer de se connecter à la base
                try {
                    const dbConfig = require('../../config/db');
                    const pool = new Pool(dbConfig);
                    
                    const client = await pool.connect();
                    
                    // Vérifier si la table settings existe et contient le flag d'installation
                    try {
                        const result = await client.query(
                            "SELECT value FROM settings WHERE key = 'system.installed' LIMIT 1"
                        );
                        
                        client.release();
                        await pool.end();

                        const isInstalled = result.rows.length > 0 && result.rows[0].value === 'true';

                        return res.json({ 
                            installed: isInstalled,
                            reason: isInstalled ? null : 'Installation non finalisée'
                        });
                    } catch (tableError) {
                        client.release();
                        await pool.end();
                        
                        return res.json({ 
                            installed: false,
                            reason: 'Settings table not found - installation required'
                        });
                    }

                } catch (dbError) {
                    return res.json({ 
                        installed: false,
                        reason: 'Impossible de se connecter à la base de données'
                    });
                }

            } catch (fileError) {
                return res.json({ 
                    installed: false,
                    reason: 'Fichier .env non trouvé'
                });
            }

        } catch (error) {
            console.error('❌ Error during verification:', error);
            res.json({ 
                installed: false,
                reason: error.message
            });
        }
    }
}

module.exports = new InstallController();
