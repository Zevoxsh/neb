#!/usr/bin/env node
/**
 * Migration des variables .env vers la base de données
 * Ce script lit le fichier .env et importe tous les paramètres dans la table settings
 */

require('dotenv').config();
const db = require('../src/config/db');
const fs = require('fs');
const path = require('path');

// Mapping des variables d'environnement vers les clés de configuration
const ENV_MAPPING = {
    // Database
    'DB_HOST': 'database.host',
    'DB_PORT': 'database.port',
    'DB_USER': 'database.user',
    'DB_PASSWORD': 'database.password',
    'DB_NAME': 'database.name',
    
    // Security
    'JWT_SECRET': 'security.jwtSecret',
    'COOKIE_SECURE': 'security.cookieSecure',
    'BOT_SECRET': 'security.botSecret',
    
    // ACME
    'ACME_EMAIL': 'acme.email',
    
    // Backends
    'BACKEND_FAILURE_THRESHOLD': 'backends.failureThreshold',
    
    // Alerts
    'ALERT_COOLDOWN_MS': 'alerts.cooldown'
};

async function migrateEnvToDatabase() {
    console.log('🔄 Migration .env → Database\n');
    
    const migrated = [];
    const skipped = [];
    
    try {
        // Migrer chaque variable d'environnement
        for (const [envKey, dbKey] of Object.entries(ENV_MAPPING)) {
            const value = process.env[envKey];
            
            if (value !== undefined && value !== null && value !== '') {
                try {
                    await db.query(
                        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
                        [dbKey, String(value)]
                    );
                    migrated.push({ envKey, dbKey, value: value.includes('SECRET') || value.includes('PASSWORD') ? '***' : value });
                } catch (error) {
                    console.error(`❌ Erreur migration ${envKey}:`, error.message);
                }
            } else {
                skipped.push(envKey);
            }
        }
        
        console.log('✅ Variables migrées:\n');
        migrated.forEach(m => {
            console.log(`   ${m.envKey} → ${m.dbKey} = ${m.value}`);
        });
        
        if (skipped.length > 0) {
            console.log('\n⚠️  Variables ignorées (non définies):\n');
            skipped.forEach(s => console.log(`   ${s}`));
        }
        
        console.log(`\n📊 Résumé: ${migrated.length} migrées, ${skipped.length} ignorées`);
        console.log('\n💡 Vous pouvez maintenant gérer ces paramètres depuis /config.html');
        console.log('💡 Les valeurs en base de données ont priorité sur le .env');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur de migration:', error);
        process.exit(1);
    }
}

// Vérifier que la table settings existe
async function checkSettingsTable() {
    try {
        await db.query('SELECT 1 FROM settings LIMIT 1');
        return true;
    } catch (error) {
        console.error('❌ La table settings n\'existe pas encore');
        console.log('💡 Créez-la d\'abord avec:');
        console.log('   CREATE TABLE IF NOT EXISTS settings (');
        console.log('     key VARCHAR(191) PRIMARY KEY,');
        console.log('     value TEXT');
        console.log('   );');
        return false;
    }
}

async function main() {
    console.log('Vérification de la table settings...');
    const tableExists = await checkSettingsTable();
    
    if (!tableExists) {
        process.exit(1);
    }
    
    await migrateEnvToDatabase();
}

main();
