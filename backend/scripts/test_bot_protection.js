/**
 * Script de test pour la protection anti-bot
 * Teste les limites par IP et par seconde
 */

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TARGET_URL = process.env.TARGET_URL || 'http://vault.paxcia.net';

async function makeRequest(url) {
    try {
        const response = await axios.get(url, {
            timeout: 5000,
            maxRedirects: 5, // Follow redirects to actually hit the server
            validateStatus: null // Accept all status codes
        });
        return {
            status: response.status,
            challenged: response.status === 503 || (response.data && response.data.includes('Vérification de sécurité'))
        };
    } catch (error) {
        if (error.response) {
            return {
                status: error.response.status,
                challenged: error.response.status === 503 || (error.response.data && error.response.data.includes('Vérification de sécurité'))
            };
        }
        return { status: 'ERROR', error: error.message };
    }
}

async function testRateLimit() {
    console.log('🚀 Test de protection anti-bot');
    console.log('================================\n');
    console.log(`📍 URL cible: ${TARGET_URL}`);
    console.log(`⏱️  Démarrage: ${new Date().toLocaleTimeString()}\n`);

    let totalRequests = 0;
    let challengeReceived = false;
    let challengeAtRequest = 0;
    const startTime = Date.now();

    // Faire 120 requêtes avec un petit délai pour rester sous 1 minute
    const numRequests = 120;
    const delayMs = 400; // 400ms entre chaque requête = environ 2.5 req/s
    console.log(`📊 Envoi de ${numRequests} requêtes espacées de ${delayMs}ms...\n`);

    for (let i = 1; i <= numRequests; i++) {
        const result = await makeRequest(TARGET_URL);
        totalRequests++;

        if (result.challenged && !challengeReceived) {
            challengeReceived = true;
            challengeAtRequest = i;
            console.log(`\n🛡️  CHALLENGE REÇU à la requête #${i}`);
            console.log(`Status: ${result.status}`);
        }

        // Afficher la progression tous les 10 requêtes
        if (i % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            const rps = (i / elapsed).toFixed(2);
            process.stdout.write(`\r✓ ${i}/${numRequests} requêtes | ${rps} req/s | Temps: ${elapsed}s`);
        }

        // Pause pour espacer les requêtes
        if (i < numRequests) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    console.log('\n\n================================');
    console.log('📈 RÉSULTATS');
    console.log('================================');
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgRps = (totalRequests / totalTime).toFixed(2);

    console.log(`Total de requêtes: ${totalRequests}`);
    console.log(`Temps total: ${totalTime}s`);
    console.log(`Moyenne: ${avgRps} requêtes/seconde`);
    
    if (challengeReceived) {
        console.log(`\n✅ Protection activée à la requête #${challengeAtRequest}`);
    } else {
        console.log('\n⚠️  Aucun challenge reçu - La protection ne s\'est pas déclenchée');
        console.log('💡 Vérifiez que:');
        console.log('   - Le serveur backend est démarré');
        console.log('   - Le middleware botChallenge est actif');
        console.log('   - La limite est configurée (défaut: 100 req/min)');
    }

    console.log('\n================================\n');
}

async function testBurstRequests() {
    console.log('💥 Test de rafale (burst)');
    console.log('================================\n');
    console.log('Envoi de 120 requêtes simultanées...\n');

    const startTime = Date.now();
    const promises = [];

    for (let i = 0; i < 120; i++) {
        promises.push(makeRequest(TARGET_URL));
    }

    const results = await Promise.all(promises);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    const challenged = results.filter(r => r.challenged).length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    console.log(`✓ 120 requêtes envoyées en ${totalTime}s`);
    console.log(`  Challenges reçus: ${challenged}`);
    console.log(`  Erreurs: ${errors}`);
    console.log('\n================================\n');
}

async function testSequentialOverTime() {
    console.log('⏰ Test séquentiel sur 1 minute');
    console.log('================================\n');
    console.log('Envoi de 110 requêtes en 60 secondes...\n');

    const startTime = Date.now();
    const duration = 60000; // 60 secondes
    const numRequests = 110;
    const interval = duration / numRequests;

    let challenged = false;
    let challengeAt = 0;

    for (let i = 1; i <= numRequests; i++) {
        const result = await makeRequest(TARGET_URL);
        
        if (result.challenged && !challenged) {
            challenged = true;
            challengeAt = i;
            console.log(`\n🛡️  CHALLENGE REÇU à la requête #${i}`);
        }

        if (i % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            process.stdout.write(`\r✓ ${i}/${numRequests} requêtes | ${elapsed}s écoulées`);
        }

        // Attendre pour espacer les requêtes
        await new Promise(resolve => setTimeout(resolve, interval));
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n\n✓ Terminé en ${totalTime}s`);
    if (challenged) {
        console.log(`✅ Protection activée à la requête #${challengeAt}`);
    } else {
        console.log('⚠️  Aucun challenge reçu');
    }
    console.log('\n================================\n');
}

// Programme principal
async function main() {
    const testType = process.argv[2] || 'rate';

    switch (testType) {
        case 'rate':
            await testRateLimit();
            break;
        case 'burst':
            await testBurstRequests();
            break;
        case 'sequential':
            await testSequentialOverTime();
            break;
        case 'all':
            await testRateLimit();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await testBurstRequests();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await testSequentialOverTime();
            break;
        default:
            console.log('Usage: node test_bot_protection.js [rate|burst|sequential|all]');
            console.log('');
            console.log('Options:');
            console.log('  rate       - Test rapide de 150 requêtes (défaut)');
            console.log('  burst      - Test de 120 requêtes simultanées');
            console.log('  sequential - Test de 110 requêtes sur 1 minute');
            console.log('  all        - Exécuter tous les tests');
            console.log('');
            console.log('Variables d\'environnement:');
            console.log('  TARGET_URL - URL à tester (défaut: http://vault.paxcia.net)');
            process.exit(1);
    }
}

main().catch(console.error);
