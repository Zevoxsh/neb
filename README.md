# Nebula Proxy - Reverse Proxy & Load Balancer

Nebula Proxy est un reverse proxy moderne avec protection DDoS, SSL/TLS automatique, et interface d'administration web.

## 🚀 Installation Rapide

### Prérequis

- **Node.js** 14+ ([télécharger](https://nodejs.org/))
- **PostgreSQL** 12+ ([télécharger](https://www.postgresql.org/download/))

### Installation Automatique

#### Sur Windows

1. Double-cliquez sur `install.bat`
2. Suivez les instructions à l'écran
3. Ouvrez votre navigateur sur `http://localhost:3000/install`

#### Sur Linux/Mac

```bash
chmod +x install.sh
./install.sh
```

Puis ouvrez `http://localhost:3000/install` dans votre navigateur.

### Installation Manuelle

1. **Installer les dépendances**

```bash
npm install
```

2. **Démarrer le serveur**

```bash
npm start
```

3. **Configurer via l'interface web**

Ouvrez `http://localhost:3000/install` et suivez l'assistant d'installation en 4 étapes:

- **Étape 1**: Configuration PostgreSQL (hôte, port, utilisateur, mot de passe, base de données)
- **Étape 2**: Sécurité (secret JWT, email ACME pour Let's Encrypt)
- **Étape 3**: Compte administrateur (nom d'utilisateur et mot de passe)
- **Étape 4**: Finalisation automatique

## 📋 Configuration de PostgreSQL

L'assistant d'installation créera automatiquement:
- La base de données spécifiée (si elle n'existe pas)
- Toutes les tables nécessaires
- L'utilisateur administrateur
- La configuration initiale

**Important**: Votre utilisateur PostgreSQL doit avoir les droits de création de base de données.

## 🔧 Configuration

Après l'installation, toute la configuration se fait via l'interface web à `/config.html`. Plus besoin de modifier le fichier `.env` !

Les paramètres configurables incluent:
- Base de données
- Sécurité (JWT, cookies)
- Certificats SSL/TLS (ACME/Let's Encrypt)
- Protection bot/DDoS
- Backends et load balancing
- Alertes
- Métriques

## 🛡️ Fonctionnalités

- **Reverse Proxy**: HTTP/HTTPS, TCP/TLS avec SNI
- **Protection DDoS**: Rate limiting, bot challenge, IP blocking
- **SSL/TLS Automatique**: Let's Encrypt avec renouvellement auto
- **Load Balancing**: Round-robin, least connections, IP hash
- **Métriques en temps réel**: Dashboard avec analytics
- **Gestion centralisée**: Interface web moderne
- **Sauvegardes**: Export/import de configuration
- **Alertes**: Notifications pour événements critiques

## 📁 Structure du Projet

```
neb/
├── backend/
│   ├── db/
│   │   └── init.sql              # Schéma de base de données
│   ├── src/
│   │   ├── controllers/          # Logique métier
│   │   ├── models/               # Modèles de données
│   │   ├── routes/               # Routes API
│   │   ├── services/             # Services (proxy, ACME, etc.)
│   │   ├── middleware/           # Middleware (auth, bot protection)
│   │   └── utils/                # Utilitaires
│   └── scripts/                  # Scripts utilitaires
├── frontend/
│   └── public/                   # Interface web
│       ├── install.html          # Assistant d'installation
│       ├── dashboard.html        # Tableau de bord
│       ├── config.html           # Configuration
│       └── ...
├── install.bat                   # Script d'installation Windows
├── install.sh                    # Script d'installation Linux/Mac
└── package.json
```

## 🔐 Sécurité

- **Authentification JWT**: Tokens sécurisés avec expiration
- **Hachage bcrypt**: Mots de passe stockés de manière sécurisée
- **Rate Limiting**: Protection contre les attaques par force brute
- **Bot Challenge**: Challenge JavaScript pour bloquer les bots
- **Headers de sécurité**: CSP, X-Frame-Options, etc.
- **Protection SQL Injection**: Requêtes paramétrées
- **Protection XSS**: Validation et échappement des entrées

## 📊 Utilisation

1. **Connexion**: Accédez à `/login` avec vos identifiants admin
2. **Dashboard**: Vue d'ensemble de vos proxies et métriques
3. **Proxies**: Créez et gérez vos reverse proxies
4. **Backends**: Configurez vos serveurs backend
5. **Domaines**: Associez des domaines à vos backends
6. **Certificats**: Gérez vos certificats SSL/TLS
7. **Sécurité**: Configurez la protection bot/DDoS
8. **Analytics**: Consultez les métriques en temps réel

## 🚀 Production

### Recommandations

1. **HTTPS**: Activez le mode sécurisé pour les cookies
2. **Secret JWT**: Utilisez un secret fort (32+ caractères)
3. **Base de données**: Utilisez une base PostgreSQL dédiée
4. **Sauvegardes**: Configurez des sauvegardes régulières
5. **Monitoring**: Activez les alertes pour les événements critiques

### Service systemd (Linux)

Créez `/etc/systemd/system/nebula-proxy.service`:

```ini
[Unit]
Description=Nebula Proxy
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/neb
ExecStart=/usr/bin/node backend/src/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Activez et démarrez:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nebula-proxy
sudo systemctl start nebula-proxy
sudo journalctl -u nebula-proxy -f
```

## 📝 Scripts Utilitaires

```bash
# Réinitialiser le mot de passe admin
node backend/scripts/reset_admin_password.js

# Gérer la protection des domaines
node backend/scripts/manage_domain_protection.js list
node backend/scripts/manage_domain_protection.js protect <domain>
node backend/scripts/manage_domain_protection.js unprotect <domain>

# Réinitialiser les métriques
node backend/scripts/reset-metrics.js

# Migrer la configuration .env vers la base de données
node backend/scripts/migrate_env_to_db.js
```

## 🐛 Dépannage

### L'installation ne démarre pas

Vérifiez que PostgreSQL est démarré et accessible:
```bash
psql -h localhost -U postgres -c "SELECT version();"
```

### Erreur de connexion à la base

Vérifiez les paramètres de connexion dans l'assistant d'installation.

### Port déjà utilisé

Changez le port dans les variables d'environnement:
```bash
PORT=8080 npm start
```

## 📄 Licence

MIT

## 🤝 Support

Pour toute question ou problème, consultez la documentation ou créez une issue.
