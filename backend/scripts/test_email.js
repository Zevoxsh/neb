require('dotenv').config();
const nodemailer = require('nodemailer');
const pool = require('../src/config/db');

async function getSettingsFromDB() {
    try {
        // Test database connection
        await pool.query('SELECT 1');
        
        const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['security_config']);
        if (result.rows.length > 0 && result.rows[0].value) {
            const config = JSON.parse(result.rows[0].value);
            console.log('   ✅ Configuration trouvée dans la base de données');
            return config.smtp || {};
        } else {
            console.log('   ℹ️  Aucune configuration SMTP trouvée dans la base de données');
        }
    } catch (error) {
        console.log('   ❌ Erreur lors de la lecture de la DB:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('   💡 La base de données PostgreSQL n\'est pas accessible');
            console.log('      Vérifiez que PostgreSQL est démarré et que DATABASE_URL est correct');
        }
    }
    return {};
}

async function testEmailConnection() {
    console.log('=== Test de connexion SMTP ===\n');

    // Try to read from database first
    console.log('Lecture de la configuration...');
    const dbConfig = await getSettingsFromDB();

    // Merge with environment variables (env takes priority)
    const smtpConfig = {
        host: process.env.ALERT_SMTP_HOST || dbConfig.host || '',
        port: Number(process.env.ALERT_SMTP_PORT || dbConfig.port || 465),
        user: process.env.ALERT_SMTP_USER || dbConfig.user || '',
        pass: process.env.ALERT_SMTP_PASS || dbConfig.pass || '',
        from: process.env.ALERT_EMAIL_FROM || dbConfig.from || '',
        to: process.env.ALERT_EMAIL_TO || dbConfig.to || ''
    };

    console.log('\nConfiguration SMTP:');
    console.log(`  Host: ${smtpConfig.host || '(non configuré)'}`);
    console.log(`  Port: ${smtpConfig.port}`);
    console.log(`  User: ${smtpConfig.user || '(non configuré)'}`);
    console.log(`  Pass: ${smtpConfig.pass ? '***' + smtpConfig.pass.slice(-3) : '(non configuré)'}`);
    console.log(`  From: ${smtpConfig.from || '(non configuré)'}`);
    console.log(`  To: ${smtpConfig.to || '(non configuré)'}`);
    
    // Suggest alternative port if 465 fails
    if (smtpConfig.port === 465) {
        console.log(`\n  💡 Si le port 465 ne fonctionne pas, essayez le port 587 (STARTTLS)`);
    }
    console.log();

    // Validate configuration
    if (!smtpConfig.host || !smtpConfig.from || !smtpConfig.to) {
        console.error('❌ Configuration incomplète!\n');
        console.error('Veuillez configurer le SMTP dans la page Paramètres du panel web');
        console.error('ou ajouter ces variables dans votre fichier .env:');
        console.error('  ALERT_SMTP_HOST=mail.example.com');
        console.error('  ALERT_SMTP_PORT=465');
        console.error('  ALERT_SMTP_USER=user@example.com');
        console.error('  ALERT_SMTP_PASS=your_password');
        console.error('  ALERT_EMAIL_FROM=alerts@example.com');
        console.error('  ALERT_EMAIL_TO=admin@example.com');
        await pool.end();
        process.exit(1);
    }

    // Create transporter
    console.log('Création du transporteur SMTP...');
    const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.port === 465, // true for 465, false for other ports
        auth: smtpConfig.user ? {
            user: smtpConfig.user,
            pass: smtpConfig.pass
        } : undefined,
        connectionTimeout: 10000, // 10 seconds timeout
        greetingTimeout: 10000,
        socketTimeout: 10000,
        debug: true, // Enable debug output
        logger: true // Log to console
    });

    try {
        // Step 1: Verify connection
        console.log('\n1️⃣  Vérification de la connexion SMTP...');
        await transporter.verify();
        console.log('✅ Connexion SMTP réussie!\n');

        // Step 2: Send test email
        console.log('2️⃣  Envoi d\'un email de test...');
        const testMessage = {
            from: smtpConfig.from,
            to: smtpConfig.to,
            subject: '[NEBULA] 🧪 Test de connexion email',
            text: `Ceci est un email de test envoyé depuis Nebula Reverse Proxy.

Date: ${new Date().toISOString()}
Serveur: ${smtpConfig.host}:${smtpConfig.port}

Si vous recevez cet email, la configuration SMTP fonctionne correctement! ✅

---
Nebula Reverse Proxy - System Test
`,
            html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #0a0a0a; color: #fff; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
        .success { color: #4CAF50; font-weight: bold; }
        .info { background: #e3f2fd; padding: 10px; border-left: 4px solid #2196F3; margin: 15px 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 Test de connexion email</h1>
        </div>
        <div class="content">
            <p class="success">✅ Configuration SMTP fonctionnelle!</p>
            
            <div class="info">
                <strong>📧 Détails de la connexion:</strong><br>
                Date: ${new Date().toISOString()}<br>
                Serveur: ${smtpConfig.host}:${smtpConfig.port}<br>
                De: ${smtpConfig.from}<br>
                À: ${smtpConfig.to}
            </div>
            
            <p>Si vous recevez cet email, la configuration SMTP de votre reverse proxy Nebula fonctionne correctement.</p>
            
            <p>Vous recevrez maintenant des alertes de sécurité par email pour les événements critiques et importants.</p>
            
            <div class="footer">
                <p>Nebula Reverse Proxy - System Test</p>
            </div>
        </div>
    </div>
</body>
</html>
`
        };

        const info = await transporter.sendMail(testMessage);
        console.log('✅ Email envoyé avec succès!');
        console.log('   Message ID:', info.messageId);
        console.log('   Accepted:', info.accepted);
        console.log('   Response:', info.response);

        console.log('\n🎉 Test terminé avec succès!');
        console.log('Vérifiez votre boîte mail:', smtpConfig.to);
        
        await pool.end();

    } catch (error) {
        console.error('\n❌ Erreur lors du test:');
        console.error('   Code:', error.code);
        console.error('   Message:', error.message);
        
        if (error.code === 'EAUTH') {
            console.error('\n💡 Suggestions:');
            console.error('   - Vérifiez que vos identifiants SMTP sont corrects');
            console.error('   - Si vous utilisez Gmail, activez l\'authentification à 2 facteurs');
            console.error('     et créez un "Mot de passe d\'application"');
            console.error('   - Vérifiez que votre compte autorise les connexions SMTP');
        } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
            console.error('\n💡 Suggestions:');
            console.error('   - Vérifiez l\'adresse du serveur SMTP');
            console.error('   - Vérifiez le port (465 pour SSL, 587 pour TLS)');
            console.error('   - Vérifiez votre pare-feu et connexion Internet');
        }
        
        await pool.end();
        process.exit(1);
    }
}

// Run test
testEmailConnection().catch(err => {
    console.error('Erreur inattendue:', err);
    pool.end().then(() => process.exit(1));
});
