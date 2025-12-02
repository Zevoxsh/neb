# 🔧 Système de Configuration Centralisé

## 📋 Vue d'ensemble

Tous les paramètres du système sont maintenant gérables depuis l'interface web `/config.html`.
**Plus besoin de fichier .env !** Tous les paramètres sont stockés en base de données.

## ✨ Fonctionnalités

- ✅ **Interface Web Complète** : Gestion visuelle de tous les paramètres
- ✅ **Sauvegarde Automatique** : Auto-save après 1 seconde de modification
- ✅ **Catégories Organisées** : Paramètres groupés par fonctionnalité
- ✅ **Validation** : Contrôle des limites min/max
- ✅ **Export .env** : Génération automatique de fichier .env
- ✅ **Réinitialisation** : Reset par catégorie aux valeurs par défaut
- ✅ **Temps Réel** : Changements appliqués immédiatement sans redémarrage

## 📂 Catégories de Configuration

### 🗄️ Base de Données
- Hôte, port, utilisateur, mot de passe
- Nom de la base de données

### 🔒 Sécurité & JWT
- Secret JWT (minimum 32 caractères)
- Cookie sécurisé (HTTPS)
- Secret Bot Protection

### 🔐 SSL / Let's Encrypt
- Email ACME pour Let's Encrypt
- TLDs locaux (domaines qui ne génèrent pas de certificat)

### 🛡️ Protection Bot / DDoS
- **Activation** : Mode Under Attack
- **Seuils** :
  - Limite globale (req/seconde)
  - Limite par IP (req/minute)
  - Limite domaines protégés (req/minute)
  - Limite IP vérifiées (req/minute)
  - Limite burst (req/10 secondes)
- **Connexions** : Max connexions par IP
- **Challenge** :
  - Tentatives max
  - Durée de vérification (heures)
  - Challenge première visite

### 🖥️ Backends & Health Check
- Intervalle health check (ms)
- Seuil d'échecs avant marquage DOWN
- Timeout health check (ms)

### 🚨 Alertes
- Activation des alertes
- Délai entre alertes (cooldown)

### 🚫 Sécurité IP
- Blocage automatique IPs
- Seuil bytes par IP
- Seuil requêtes par IP

### 📊 Métriques
- Intervalle flush vers DB
- Taille max buffer

## 🚀 Migration depuis .env

### 1. Migrer les variables existantes

```bash
node backend/scripts/migrate_env_to_db.js
```

Ce script va :
- ✅ Lire votre fichier .env actuel
- ✅ Importer toutes les variables dans la base de données
- ✅ Afficher un résumé de la migration

### 2. Accéder à l'interface

Ouvrez votre navigateur : `http://votre-serveur:3000/config.html`

### 3. Configurer vos paramètres

- 🎨 Interface visuelle intuitive
- 💾 Sauvegarde automatique
- ✅ Validation en temps réel

### 4. (Optionnel) Supprimer le .env

Une fois la migration effectuée, vous pouvez supprimer le fichier `.env`.
Les paramètres en base de données ont priorité.

## 📖 Utilisation de l'Interface

### Navigation
- **Onglets** : Cliquez sur une catégorie pour afficher ses paramètres
- **Modification** : Changez une valeur → Sauvegarde auto après 1s
- **Indicateur** : Notification de sauvegarde en bas à droite

### Actions Disponibles

#### 💾 Sauvegarder Tout
Sauvegarde manuelle de tous les changements en attente

#### 📥 Exporter .env
Télécharge un fichier `.env` avec toutes les variables configurées

#### 🔄 Réinitialiser
Remet une catégorie entière aux valeurs par défaut

### Champs Spéciaux

- **🔒 Mots de passe** : Affichés en mode masqué
- **🔢 Nombres** : Validation min/max automatique
- **☑️ Booléens** : Checkbox on/off
- **📝 Arrays** : Valeurs séparées par virgules

## 🔧 API Backend

### Endpoints Disponibles

#### GET /api/config
Récupère toute la configuration + schéma

```json
{
  "config": {
    "botProtection": {
      "enabled": false,
      "perIpLimit": 60,
      ...
    },
    ...
  },
  "schema": { ... }
}
```

#### PUT /api/config
Met à jour un paramètre

```json
{
  "category": "botProtection",
  "key": "perIpLimit",
  "value": 100
}
```

#### POST /api/config/bulk
Met à jour plusieurs paramètres

```json
{
  "updates": [
    { "category": "botProtection", "key": "enabled", "value": true },
    { "category": "botProtection", "key": "perIpLimit", "value": 100 }
  ]
}
```

#### POST /api/config/reset
Réinitialise une catégorie

```json
{
  "category": "botProtection"
}
```

#### GET /api/config/export
Télécharge un fichier .env généré

## ⚡ Application au Runtime

Les changements sont appliqués **immédiatement** sans redémarrage :

- ✅ Bot Protection : Limites, seuils, durée
- ✅ Backends : Intervalle health check
- ✅ Métriques : Intervalle flush
- ✅ ACME : TLDs locaux
- ✅ Sécurité IP : Seuils auto-block

## 🔐 Sécurité

- ✅ **Authentification requise** : Tous les endpoints protégés par JWT
- ✅ **Validation stricte** : Vérification des types et limites
- ✅ **Mots de passe masqués** : Secrets jamais affichés en clair dans l'interface
- ✅ **Audit trail** : Tous les changements loggés

## 💡 Bonnes Pratiques

### 1. Secret JWT
- **Minimum 32 caractères**
- Utilisez un générateur de secret fort
- Ne partagez jamais ce secret

### 2. Protection Bot
- Commencez avec `perIpLimit: 60` (req/min)
- Augmentez `verifiedIpLimit: 600` pour IPs validées
- Activez `challengeFirstVisit` uniquement si attaque

### 3. Backends
- `healthCheckInterval`: 30000ms (30s) par défaut
- `failureThreshold`: 3 échecs avant marquage DOWN
- Ajustez selon votre infrastructure

### 4. Sauvegarde
- Exportez régulièrement votre configuration (📥 Exporter .env)
- Sauvegardez le fichier .env généré
- Backup automatique de la table `settings` en DB

## 🐛 Dépannage

### La configuration ne charge pas
```bash
# Vérifier la table settings
psql -d nebuladb -c "SELECT * FROM settings;"

# Recréer la table si nécessaire
psql -d nebuladb -c "CREATE TABLE IF NOT EXISTS settings (key VARCHAR(191) PRIMARY KEY, value TEXT);"
```

### Les changements ne s'appliquent pas
- Vérifiez les logs backend pour erreurs
- Certains paramètres (DB) nécessitent un redémarrage
- Actualisez la page `/config.html`

### Migration échoue
```bash
# Vérifier les permissions DB
node -e "require('./backend/src/config/db').query('SELECT 1').then(() => console.log('OK')).catch(e => console.error(e))"
```

## 📚 Fichiers Modifiés

### Backend
- `backend/src/controllers/configController.js` (NOUVEAU) - Contrôleur principal
- `backend/src/routes/configRoutes.js` (NOUVEAU) - Routes API
- `backend/src/app.js` - Ajout des routes
- `backend/src/index.js` - Chargement config au démarrage

### Frontend
- `frontend/public/config.html` (NOUVEAU) - Interface web
- `frontend/public/partials/header.html` - Menu avec lien Configuration

### Scripts
- `backend/scripts/migrate_env_to_db.js` (NOUVEAU) - Migration .env → DB

## 🎯 Prochaines Étapes

1. ✅ Migrer votre .env actuel
2. ✅ Configurer vos paramètres via `/config.html`
3. ✅ Exporter et sauvegarder un .env de backup
4. ✅ (Optionnel) Supprimer le fichier .env original

---

**🎉 Félicitations !** Votre système est maintenant 100% configurable depuis l'interface web !
