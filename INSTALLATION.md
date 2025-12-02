# 🚀 Guide d'Installation - Nebula Proxy

## Installation Rapide (Recommandé)

### 1. Prérequis

Avant de commencer, assurez-vous d'avoir :

- **Node.js** 14 ou supérieur ([télécharger](https://nodejs.org/))
- **PostgreSQL** 12 ou supérieur ([télécharger](https://www.postgresql.org/download/))
- PostgreSQL doit être démarré et accessible

### 2. Vérification de PostgreSQL

Vérifiez que PostgreSQL fonctionne :

```bash
# Windows
pg_ctl status

# Linux/Mac
sudo systemctl status postgresql
```

Si PostgreSQL n'est pas démarré :

```bash
# Windows
pg_ctl start

# Linux
sudo systemctl start postgresql

# Mac
brew services start postgresql
```

### 3. Installation Automatique

#### Windows

1. Ouvrez PowerShell ou CMD dans le dossier du projet
2. Exécutez :
   ```powershell
   .\install.bat
   ```

Ou double-cliquez simplement sur `install.bat`

#### Linux/Mac

```bash
chmod +x install.sh
./install.sh
```

### 4. Configuration via l'Interface Web

Une fois le serveur démarré, ouvrez votre navigateur sur :

```
http://localhost:3000/install
```

Suivez l'assistant d'installation en 4 étapes :

#### Étape 1 : Configuration PostgreSQL

- **Hôte** : `localhost` (ou l'adresse de votre serveur PostgreSQL)
- **Port** : `5432` (port par défaut)
- **Utilisateur** : `postgres` (ou votre utilisateur PostgreSQL)
- **Mot de passe** : Mot de passe de votre utilisateur PostgreSQL
- **Nom de la base** : `nebuladb` (ou le nom que vous souhaitez)

💡 **Astuce** : Utilisez le bouton "🔌 Tester la connexion" pour vérifier vos paramètres avant de continuer.

#### Étape 2 : Sécurité

- **Secret JWT** : Cliquez sur "🎲 Générer un secret aléatoire" pour obtenir un secret fort
- **Email ACME** : Votre email pour les notifications Let's Encrypt (optionnel)
- **HTTPS uniquement** : Coché par défaut pour plus de sécurité

⚠️ **Important** : Conservez le secret JWT généré en lieu sûr !

#### Étape 3 : Compte Administrateur

- **Nom d'utilisateur** : `admin` (ou le nom que vous souhaitez)
- **Mot de passe** : Choisissez un mot de passe fort (minimum 8 caractères)
- **Confirmer** : Re-saisissez le mot de passe

#### Étape 4 : Finalisation

L'installation se fait automatiquement :
- Création de la base de données (si nécessaire)
- Initialisation des tables
- Création de l'utilisateur admin
- Enregistrement de la configuration

Une fois terminé, cliquez sur "🚀 Accéder au panneau d'administration" pour vous connecter.

## Installation Manuelle

Si vous préférez installer manuellement :

### 1. Installer les dépendances

```bash
npm install
```

### 2. Démarrer le serveur

```bash
npm start
```

Le serveur détectera automatiquement qu'aucune configuration n'existe et vous redirigera vers `/install`.

## Que fait l'installation ?

L'installation automatique effectue les actions suivantes :

1. **Création de la base de données** (si elle n'existe pas)
2. **Exécution du script SQL** (`backend/db/init.sql`) pour créer toutes les tables :
   - `users` - Utilisateurs et authentification
   - `proxies` - Configuration des proxies
   - `backends` - Serveurs backend
   - `domain_mappings` - Association domaines/backends
   - `metrics` - Métriques et analytics
   - `certificates` - Gestion SSL/TLS
   - `settings` - Configuration globale
   - `blocked_ips` - Protection DDoS
   - `trusted_ips` - IPs de confiance
   - Et autres tables nécessaires

3. **Création de l'utilisateur admin** avec mot de passe hashé (bcrypt)

4. **Enregistrement de la configuration** dans la table `settings`

5. **Création du fichier .env** avec les paramètres de connexion

## Vérification Post-Installation

Après l'installation, vérifiez que tout fonctionne :

1. Accédez à `http://localhost:3000/login`
2. Connectez-vous avec vos identifiants admin
3. Vous devriez voir le dashboard

## Dépannage

### Erreur : "ECONNREFUSED" lors du test de connexion

PostgreSQL n'est pas démarré ou n'écoute pas sur le port spécifié.

**Solution** :
```bash
# Vérifier le statut
sudo systemctl status postgresql

# Démarrer PostgreSQL
sudo systemctl start postgresql
```

### Erreur : "password authentication failed"

Le mot de passe PostgreSQL est incorrect.

**Solution** :
1. Vérifiez votre mot de passe PostgreSQL
2. Si vous ne connaissez pas le mot de passe, réinitialisez-le :

```bash
# Linux
sudo -u postgres psql
postgres=# \password postgres

# Windows (dans psql)
\password postgres
```

### Erreur : "permission denied to create database"

L'utilisateur PostgreSQL n'a pas les droits de création de base de données.

**Solution** :
```sql
-- Connectez-vous en tant que superuser
ALTER USER votre_utilisateur CREATEDB;
```

### Le port 3000 est déjà utilisé

**Solution** :
```bash
# Changer le port temporairement
PORT=8080 npm start
```

Puis accédez à `http://localhost:8080/install`

### Erreur : "Cannot find module"

Les dépendances ne sont pas installées.

**Solution** :
```bash
npm install
```

## Accès à la Base de Données

Pour accéder directement à votre base de données PostgreSQL :

```bash
# Connexion
psql -h localhost -U postgres -d nebuladb

# Lister les tables
\dt

# Voir les utilisateurs
SELECT * FROM users;

# Quitter
\q
```

## Réinstallation

Pour réinstaller complètement :

1. **Supprimer le fichier .env** :
   ```bash
   rm .env
   ```

2. **Supprimer la base de données** (optionnel) :
   ```bash
   psql -h localhost -U postgres -c "DROP DATABASE nebuladb;"
   ```

3. **Redémarrer le serveur** :
   ```bash
   npm start
   ```

Vous serez redirigé vers l'assistant d'installation.

## Prochaines Étapes

Après l'installation réussie :

1. 📚 Consultez le [README.md](README.md) pour l'utilisation
2. 🔧 Configurez vos paramètres dans `/config.html`
3. 🌐 Créez votre premier proxy dans `/proxies.html`
4. 📊 Consultez les métriques dans `/analytics.html`

## Support

Pour toute question ou problème :
- Consultez la [documentation](README.md)
- Vérifiez les logs du serveur
- Créez une issue sur GitHub
