require('dotenv').config();
const pool = require('../src/config/db');

async function resetAlerts() {
    try {
        console.log('🗑️  Suppression de toutes les alertes de sécurité...');
        
        const result = await pool.query('DELETE FROM security_alerts');
        
        console.log(`✅ ${result.rowCount} alertes supprimées avec succès!`);
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        await pool.end();
        process.exit(1);
    }
}

resetAlerts();
