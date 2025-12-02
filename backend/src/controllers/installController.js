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
                console.log(`📦 Creating database "${dbName}"...`);
                // Utiliser des identifiants quotés pour gérer les caractères spéciaux
                await client.query(`CREATE DATABASE "${dbName}"`);
                console.log(`✅ Database "${dbName}" created successfully`);
            } else {
                console.log(`ℹ️  Database "${dbName}" already exists`);
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

            // 4. Exécuter le script d'initialisation SQL
            console.log('📄 Executing init.sql script...');
            const initSqlPath = path.join(__dirname, '../../db/init.sql');
            const initSql = await fs.readFile(initSqlPath, 'utf8');
            await appClient.query(initSql);

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
                { key: 'database.host', value: database.host },
                { key: 'database.port', value: database.port.toString() },
                { key: 'database.user', value: database.user },
                { key: 'database.password', value: database.password },
                { key: 'database.name', value: dbName },
                // Security
                { key: 'security.jwtSecret', value: security.jwtSecret },
                { key: 'security.cookieSecure', value: security.cookieSecure.toString() },
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
