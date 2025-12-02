#!/usr/bin/env node
/**
 * Script pour mettre vault.paxcia.net en mode non-protégé
 */

const db = require('../src/config/db');

async function setVaultUnprotected() {
    try {
        // Mettre vault.paxcia.net en mode unprotected
        const result = await db.query(
            `UPDATE domain_mappings 
             SET bot_protection = 'unprotected' 
             WHERE hostname = $1`,
            ['vault.paxcia.net']
        );
        
        if (result.rowCount > 0) {
            console.log('✅ vault.paxcia.net mis en mode non-protégé');
        } else {
            console.log('⚠️ Domaine vault.paxcia.net non trouvé dans la base');
            
            // Vérifier si le domaine existe
            const check = await db.query(
                'SELECT hostname, bot_protection FROM domain_mappings WHERE hostname LIKE $1',
                ['%vault%']
            );
            
            if (check.rows.length > 0) {
                console.log('Domaines trouvés:', check.rows);
            } else {
                console.log('Aucun domaine contenant "vault" trouvé');
            }
        }
        
        // Afficher tous les domaines paxcia.net
        const paxciaDomains = await db.query(
            `SELECT hostname, bot_protection 
             FROM domain_mappings 
             WHERE hostname LIKE '%paxcia.net' 
             ORDER BY hostname`
        );
        
        console.log('\n📋 Domaines paxcia.net:');
        paxciaDomains.rows.forEach(d => {
            const protection = d.bot_protection || 'default';
            const emoji = protection === 'protected' ? '' : 
                         protection === 'unprotected' ? '' : '';
            console.log(`${emoji} ${d.hostname}: ${protection}`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        process.exit(1);
    }
}

setVaultUnprotected();
