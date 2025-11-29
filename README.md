# Express JWT + MySQL Auth (minimal)

Instructions rapide pour lancer le backend localement.

1) Copier `.env.example` en `.env` et remplir les paramètres MySQL et `JWT_SECRET`.

2) Installer les dépendances:

```powershell
cd c:\Users\Zevox\Documents\proxy
npm install
```

Commandes pour un serveur Linux (bash)
```bash
cd /path/to/project
npm install
# Copier .env.example -> .env et éditer
cp .env.example .env
# (Éditer .env avec vos valeurs DB et DEFAULT_ADMIN_* si besoin)
npm start
```

Déploiement recommandé sur Linux
- Exécutez derrière un reverse-proxy (nginx) qui gère TLS, ou lancez directement avec TLS.
- Si TLS est géré par le reverse-proxy, exportez `NODE_ENV=production` et `COOKIE_SECURE=true` dans l'environnement pour que le cookie JWT soit marqué `Secure`.

Exemple de service `systemd` (optionnel)
1. Créez `/etc/systemd/system/proxy-auth.service` avec le contenu suivant (adaptez les chemins et l'utilisateur):

```ini
[Unit]
Description=Express JWT Auth
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/project
Environment=NODE_ENV=production
Environment=COOKIE_SECURE=true
Environment=DB_HOST=localhost
Environment=DB_PORT=5432
Environment=DB_USER=postgres
Environment=DB_PASSWORD=yourpassword
Environment=DB_NAME=test
Environment=JWT_SECRET=your_jwt_secret
ExecStart=/usr/bin/node /path/to/project/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

2. Activer et démarrer le service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now proxy-auth.service
sudo journalctl -u proxy-auth.service -f
```

Remarques de sécurité
- Changez `JWT_SECRET` et le mot de passe admin par défaut avant un déploiement public.
- Assurez-vous que PostgreSQL n'est pas exposé publiquement sans contrôle d'accès.
3) Créer la table (exécuter `db/init.sql`) dans votre base PostgreSQL.

	Exemple avec `psql`:

```powershell
psql -h <host> -p <port> -U <user> -d <db> -f db/init.sql
```

Note: le serveur initialise maintenant la table `users` automatiquement au démarrage si elle n'existe pas, et crée un utilisateur administrateur par défaut (nom et mot de passe venant de `DEFAULT_ADMIN_USER` / `DEFAULT_ADMIN_PASSWORD` dans `.env`). Si ces variables ne sont pas définies, le serveur créera l'utilisateur `admin` avec le mot de passe `admin123`. Changez ces valeurs dans `.env` avant le premier démarrage en production.

4) Créer un utilisateur:

```powershell
npm run create-user -- <username> <password>
```

5) Lancer le serveur:

```powershell
npm start
```

6) Ouvrir `http://localhost:3000/login`, se connecter, vous serez redirigé vers l'`index.html` protégé.

- Pour la production, utilisez HTTPS et réglez `cookie.secure=true`.
- Changez `JWT_SECRET` pour une valeur robuste.
 - Ce dépôt utilise maintenant PostgreSQL; installez `postgres` et créez la base/les accès avant d'exécuter `db/init.sql`.
Project structure

```
proxy/                    # repo root
├─ backend/               # server code, DB init and helpers
│  ├─ server.js
│  ├─ create-user.js
│  ├─ proxy-manager.js
│  └─ db/init.sql
├─ frontend/              # simple static frontend
│  └─ public/
│     ├─ login.html
│     └─ index.html
├─ .env.example
├─ package.json           # scripts point to backend/*
└─ README.md
```

Notes: run `npm install` at repo root and `npm start` will launch `backend/server.js`.
- Pour la production, utilisez HTTPS et réglez `cookie.secure=true`.
- Changez `JWT_SECRET` pour une valeur robuste.
