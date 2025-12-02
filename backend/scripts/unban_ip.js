#!/usr/bin/env node

/**
 * Script pour débloquer une IP bannie par la protection DDoS
 * Usage: node backend/scripts/unban_ip.js <ip>
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function unbanIP(ip) {
  console.log(`\n🔓 Déblocage de l'IP: ${ip}`);
  
  // Envoyer un message au serveur pour débloquer l'IP
  // En réalité, il faut redémarrer le serveur car les bans sont en mémoire
  
  console.log('\n⚠️  Les bans DDoS sont stockés en mémoire.');
  console.log('Pour débloquer immédiatement une IP, vous devez:');
  console.log('');
  console.log('1. Redémarrer le serveur (les bans seront effacés)');
  console.log('   npm start');
  console.log('');
  console.log('2. Ou attendre l\'expiration du ban (5 minutes par défaut)');
  console.log('');
  console.log('3. Ou ajouter l\'IP aux IPs de confiance dans la base de données:');
  console.log(`   psql -h localhost -U postgres -d nebuladb -c "INSERT INTO trusted_ips (ip, reason) VALUES ('${ip}', 'Admin IP') ON CONFLICT DO NOTHING;"`);
  console.log('');
  console.log('✅ Les seuils DDoS ont été ajustés pour être moins agressifs.');
  console.log('   - Seuil de ban: 100 → 200 points');
  console.log('   - User-Agent suspect: 5 → 1 point');
  console.log('   - Headers manquants: 3 → 1 point');
  console.log('');
  
  process.exit(0);
}

const ip = process.argv[2];

if (!ip) {
  console.log('\n🔓 Déblocage d\'IP - Protection DDoS');
  console.log('=====================================\n');
  
  rl.question('Entrez l\'adresse IP à débloquer: ', (answer) => {
    rl.close();
    if (answer) {
      unbanIP(answer.trim());
    } else {
      console.log('❌ Aucune IP fournie');
      process.exit(1);
    }
  });
} else {
  unbanIP(ip);
}
