# Screenshot Service

Le service de screenshots permet de générer des aperçus visuels des domaines dans l'interface.

## Configuration Actuelle

Le service utilise **thum.io** (API externe gratuite) pour générer les screenshots. Cette solution fonctionne sans dépendances supplémentaires.

### Avantages
- ✅ Aucune installation requise
- ✅ Pas de dépendances système
- ✅ Fonctionne sur tous les OS
- ✅ Pas de consommation CPU/RAM locale

### Limitations
- ⚠️ Dépend d'un service externe
- ⚠️ Peut être plus lent (requête réseau)
- ⚠️ Limite de requêtes gratuite

## Option Alternative : Puppeteer Local

Si vous préférez générer les screenshots localement avec Puppeteer :

### Installation des dépendances (Linux/Ubuntu)

```bash
# Installer les dépendances système requises
sudo apt-get update
sudo apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils

# Installer Puppeteer
cd /path/to/neb
npm install puppeteer
```

### Modification du Code

Modifiez `backend/src/services/screenshotService.js` pour utiliser Puppeteer au lieu de l'API externe.

## Cache

Les screenshots sont mis en cache pendant **24 heures** dans :
- `backend/public/screenshots/domain-{id}.png`

Pour forcer le rafraîchissement d'un screenshot :
- API : `POST /api/domains/:id/screenshot/refresh`
- UI : Sera ajouté dans une future version

## Changement d'API

Pour utiliser une autre API de screenshot, modifiez la variable `this.screenshotAPI` dans le constructeur :

```javascript
// Exemples d'alternatives
this.screenshotAPI = 'https://shot.screenshotapi.net/screenshot?url=';
this.screenshotAPI = 'https://api.screenshotone.com/take?url=';
```

**Note:** Certaines API nécessitent une clé d'authentification.
