#!/usr/bin/env node
/**
 * Script de gestion de la protection bot pour les domaines
 * Usage: node manage_domain_protection.js <action> <domain>
 * Actions: protect, unprotect, default, list
 */

const db = require('../src/config/db');

async function listDomains() {
    const result = await db.query(
        `SELECT hostname, bot_protection 
         FROM domain_mappings 
         ORDER BY hostname`
    );
    
    console.log('\n📋 Configuration de protection des domaines:\n');
    console.log('Domaine                          | Protection');
    console.log('-------------------------------- | -------------');
    
    result.rows.forEach(d => {
        const protection = (d.bot_protection || 'default').padEnd(13);
        const emoji = d.bot_protection === 'protected' ? '🛡️' : 
                     d.bot_protection === 'unprotected' ? '✅' : '⚙️';
        console.log(`${emoji} ${d.hostname.padEnd(28)} | ${protection}`);
    });
    
    console.log('\n🛡️  protected    = Challenge systématique si trafic élevé');
    console.log('✅ unprotected  = Pas de challenge bot (bypass complet)');
    console.log('⚙️  default     = Protection standard (rate limiting uniquement)');
}

async function setProtection(domain, mode) {
    if (!['protected', 'unprotected', 'default'].includes(mode)) {
        console.error('❌ Mode invalide. Utilisez: protected, unprotected ou default');
        return;
    }
    
    const result = await db.query(
        `UPDATE domain_mappings 
         SET bot_protection = $1 
         WHERE hostname = $2`,
        [mode, domain]
    );
    
    if (result.rowCount > 0) {
        const emoji = mode === 'protected' ? '🛡️' : 
                     mode === 'unprotected' ? '✅' : '⚙️';
        console.log(`${emoji} ${domain} mis en mode: ${mode}`);
    } else {
        console.log(`⚠️ Domaine ${domain} non trouvé`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const action = args[0];
    const domain = args[1];
    
    try {
        if (!action || action === 'list') {
            await listDomains();
        } else if (action === 'protect' && domain) {
            await setProtection(domain, 'protected');
            await listDomains();
        } else if (action === 'unprotect' && domain) {
            await setProtection(domain, 'unprotected');
            await listDomains();
        } else if (action === 'default' && domain) {
            await setProtection(domain, 'default');
            await listDomains();
        } else {
            console.log('Usage: node manage_domain_protection.js <action> [domain]');
            console.log('\nActions:');
            console.log('  list                    - Afficher tous les domaines');
            console.log('  protect <domain>        - Activer protection stricte');
            console.log('  unprotect <domain>      - Désactiver protection (bypass)');
            console.log('  default <domain>        - Réinitialiser en mode standard');
            console.log('\nExemples:');
            console.log('  node manage_domain_protection.js list');
            console.log('  node manage_domain_protection.js unprotect vault.paxcia.net');
            console.log('  node manage_domain_protection.js protect api.example.com');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        process.exit(1);
    }
}

main();
