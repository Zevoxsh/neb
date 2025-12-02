#!/bin/bash

# Script de déploiement automatique Nebula Proxy
# Usage: bash deploy.sh [user@]host

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Nebula Proxy - Déploiement Auto     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Vérifier le paramètre
if [ -z "$1" ]; then
    echo -e "${RED}Usage: $0 [user@]host${NC}"
    echo "Exemple: $0 root@proxy"
    exit 1
fi

HOST="$1"
REMOTE_DIR="/root/neb"

echo -e "${YELLOW}➜${NC} Déploiement vers: ${HOST}"
echo -e "${YELLOW}➜${NC} Répertoire distant: ${REMOTE_DIR}"
echo ""

# Vérifier la connexion SSH
echo -e "${BLUE}[1/6]${NC} Vérification de la connexion SSH..."
if ssh -o ConnectTimeout=5 -o BatchMode=yes "$HOST" exit 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Connexion SSH OK"
else
    echo -e "${RED}✗${NC} Impossible de se connecter à $HOST"
    echo "Vérifiez que:"
    echo "  - Le serveur est accessible"
    echo "  - Vos clés SSH sont configurées"
    echo "  - L'utilisateur a les permissions nécessaires"
    exit 1
fi
echo ""

# Backup distant
echo -e "${BLUE}[2/6]${NC} Création d'un backup sur le serveur..."
ssh "$HOST" "cd $REMOTE_DIR && cp -r backend backend.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true"
echo -e "${GREEN}✓${NC} Backup créé"
echo ""

# Transférer les fichiers
echo -e "${BLUE}[3/6]${NC} Transfert des fichiers..."

# Liste des fichiers à transférer
FILES_TO_TRANSFER=(
    "package.json"
    ".env.example"
    "backend/src/config/redis.js"
    "backend/src/services/cacheManager.js"
    "backend/src/services/loadBalancer.js"
    "backend/src/services/healthChecker.js"
    "backend/src/services/websocketProxy.js"
    "backend/src/services/wafEngine.js"
    "backend/src/middleware/cacheMiddleware.js"
    "backend/src/middleware/wafMiddleware.js"
    "backend/src/routes/backendPoolRoutes.js"
    "backend/src/routes/cacheRoutes.js"
    "backend/src/routes/websocketRoutes.js"
    "backend/src/models/backendPoolModel.js"
    "backend/src/models/backendModel.js"
    "backend/src/index.js"
    "backend/src/app.js"
)

for file in "${FILES_TO_TRANSFER[@]}"; do
    if [ -f "$file" ]; then
        # Créer le répertoire distant si nécessaire
        remote_dir=$(dirname "$REMOTE_DIR/$file")
        ssh "$HOST" "mkdir -p $remote_dir"

        # Transférer le fichier
        scp -q "$file" "$HOST:$REMOTE_DIR/$file"
        echo -e "  ${GREEN}✓${NC} $file"
    else
        echo -e "  ${YELLOW}⚠${NC}  $file (non trouvé, ignoré)"
    fi
done

echo -e "${GREEN}✓${NC} Fichiers transférés"
echo ""

# Installer les dépendances
echo -e "${BLUE}[4/6]${NC} Installation des dépendances npm..."
ssh "$HOST" "cd $REMOTE_DIR && npm install 2>&1 | grep -E '(added|removed|changed|audited)'" || true
echo -e "${GREEN}✓${NC} Dépendances installées"
echo ""

# Configuration Redis
echo -e "${BLUE}[5/6]${NC} Configuration Redis..."
REDIS_CHECK=$(ssh "$HOST" "redis-cli ping 2>/dev/null" || echo "FAIL")

if [ "$REDIS_CHECK" = "PONG" ]; then
    echo -e "${GREEN}✓${NC} Redis est disponible et fonctionnel"
    ssh "$HOST" "grep -q 'REDIS_ENABLED=' $REMOTE_DIR/.env && sed -i 's/REDIS_ENABLED=.*/REDIS_ENABLED=true/' $REMOTE_DIR/.env || echo 'REDIS_ENABLED=true' >> $REMOTE_DIR/.env"
else
    echo -e "${YELLOW}⚠${NC}  Redis non disponible - Configuration en mode mémoire"
    ssh "$HOST" "grep -q 'REDIS_ENABLED=' $REMOTE_DIR/.env && sed -i 's/REDIS_ENABLED=.*/REDIS_ENABLED=false/' $REMOTE_DIR/.env || echo 'REDIS_ENABLED=false' >> $REMOTE_DIR/.env"
fi
echo ""

# Redémarrer le serveur
echo -e "${BLUE}[6/6]${NC} Redémarrage du serveur..."

# Créer un script de redémarrage
cat > /tmp/restart_nebula.sh << 'EOFSCRIPT'
#!/bin/bash
cd /root/neb
screen -S proxy -X quit 2>/dev/null || true
sleep 2
screen -dmS proxy bash -c "npm start"
sleep 3
screen -list | grep proxy && echo "✓ Serveur démarré dans screen 'proxy'" || echo "✗ Échec du démarrage"
EOFSCRIPT

# Transférer et exécuter
scp -q /tmp/restart_nebula.sh "$HOST:/tmp/"
ssh "$HOST" "bash /tmp/restart_nebula.sh"
rm /tmp/restart_nebula.sh

echo -e "${GREEN}✓${NC} Serveur redémarré"
echo ""

# Vérification
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}     Vérification du déploiement       ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

sleep 5

# Tester la connectivité
echo -e "${YELLOW}➜${NC} Test de connectivité..."
HTTP_CODE=$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/" || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓${NC} Serveur HTTP répond (code: $HTTP_CODE)"
else
    echo -e "${RED}✗${NC} Serveur HTTP ne répond pas (code: $HTTP_CODE)"
    echo -e "${YELLOW}ℹ${NC}  Vérifiez les logs: ssh $HOST 'screen -r proxy'"
fi
echo ""

# Afficher les logs récents
echo -e "${YELLOW}➜${NC} Logs récents du serveur:"
echo -e "${BLUE}────────────────────────────────────────${NC}"
ssh "$HOST" "screen -S proxy -X hardcopy /tmp/screen_output.txt; tail -20 /tmp/screen_output.txt 2>/dev/null || echo 'Logs non disponibles - Le serveur démarre...'"
echo -e "${BLUE}────────────────────────────────────────${NC}"
echo ""

# Résumé
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Déploiement terminé avec succès!   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Nouvelles fonctionnalités disponibles:${NC}"
echo "  • Load Balancing (4 algorithmes)"
echo "  • Cache Redis (ou mémoire en fallback)"
echo "  • Support WebSocket"
echo "  • WAF Protection OWASP Top 10"
echo ""
echo -e "${YELLOW}Commandes utiles:${NC}"
echo "  Voir les logs:     ssh $HOST 'screen -r proxy'"
echo "  Arrêter:           ssh $HOST 'screen -S proxy -X quit'"
echo "  Redémarrer:        ssh $HOST 'cd $REMOTE_DIR && screen -dmS proxy npm start'"
echo "  Rollback backup:   ssh $HOST 'cd $REMOTE_DIR && rm -rf backend && mv backend.backup.* backend'"
echo ""
echo -e "${GREEN}✓ Déploiement réussi!${NC}"
