#!/bin/bash

# Installation des dépendances Nebula Proxy
# Usage: bash install-dependencies.sh

set -e  # Exit on error

echo "=========================================="
echo "  Nebula Proxy - Installation Script"
echo "=========================================="
echo ""

# Couleurs pour output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Vérifier que nous sommes dans le bon répertoire
if [ ! -f "package.json" ]; then
    echo -e "${RED}Erreur: package.json non trouvé${NC}"
    echo "Veuillez exécuter ce script depuis le répertoire racine du projet"
    exit 1
fi

echo -e "${GREEN}✓${NC} Répertoire du projet détecté"
echo ""

# Installer les dépendances npm
echo "📦 Installation des dépendances npm..."
npm install

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Dépendances npm installées avec succès"
else
    echo -e "${RED}✗${NC} Échec de l'installation des dépendances"
    exit 1
fi
echo ""

# Vérifier si Redis est installé
echo "🔍 Vérification de Redis..."
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo -e "${GREEN}✓${NC} Redis est installé et fonctionne"
        REDIS_STATUS="installed"
    else
        echo -e "${YELLOW}⚠${NC}  Redis est installé mais ne fonctionne pas"
        REDIS_STATUS="stopped"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Redis n'est pas installé"
    REDIS_STATUS="not_installed"
fi
echo ""

# Configuration Redis
if [ "$REDIS_STATUS" = "not_installed" ] || [ "$REDIS_STATUS" = "stopped" ]; then
    echo "Configuration Redis requise:"
    echo ""
    echo "Option 1: Désactiver Redis (recommandé pour un démarrage rapide)"
    echo "  - Le cache utilisera la mémoire à la place"
    echo "  - Ajoutez 'REDIS_ENABLED=false' dans votre fichier .env"
    echo ""
    echo "Option 2: Installer Redis"
    if [ -f /etc/debian_version ]; then
        echo "  sudo apt update && sudo apt install -y redis-server"
        echo "  sudo systemctl start redis-server"
        echo "  sudo systemctl enable redis-server"
    elif [ -f /etc/redhat-release ]; then
        echo "  sudo yum install -y redis"
        echo "  sudo systemctl start redis"
        echo "  sudo systemctl enable redis"
    fi
    echo ""

    read -p "Voulez-vous désactiver Redis maintenant? (o/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[OoYy]$ ]]; then
        if [ -f .env ]; then
            # Vérifier si REDIS_ENABLED existe déjà
            if grep -q "REDIS_ENABLED=" .env; then
                sed -i 's/REDIS_ENABLED=.*/REDIS_ENABLED=false/' .env
            else
                echo "" >> .env
                echo "# Redis disabled" >> .env
                echo "REDIS_ENABLED=false" >> .env
            fi
            echo -e "${GREEN}✓${NC} Redis désactivé dans .env"
        else
            echo -e "${YELLOW}⚠${NC}  Fichier .env non trouvé. Créez-le à partir de .env.example"
            echo "  cp .env.example .env"
            echo "  Puis ajoutez: REDIS_ENABLED=false"
        fi
    fi
fi
echo ""

# Vérifier PostgreSQL
echo "🔍 Vérification de PostgreSQL..."
if command -v psql &> /dev/null; then
    echo -e "${GREEN}✓${NC} PostgreSQL est installé"
else
    echo -e "${RED}✗${NC} PostgreSQL n'est pas détecté"
    echo "  Assurez-vous que PostgreSQL est installé et configuré"
fi
echo ""

# Vérifier le fichier .env
if [ -f .env ]; then
    echo -e "${GREEN}✓${NC} Fichier .env trouvé"

    # Vérifier les variables critiques
    if grep -q "^JWT_SECRET=GENERATE_RANDOM_SECRET" .env; then
        echo -e "${RED}⚠${NC}  ATTENTION: JWT_SECRET utilise la valeur par défaut!"
        echo "  Générez un secret fort avec: openssl rand -hex 32"
    fi

    if grep -q "^DEFAULT_ADMIN_PASSWORD=CHANGE_THIS" .env; then
        echo -e "${RED}⚠${NC}  ATTENTION: Mot de passe admin par défaut détecté!"
        echo "  Changez DEFAULT_ADMIN_PASSWORD dans .env"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Fichier .env non trouvé"
    echo "  Créez-le à partir de .env.example:"
    echo "  cp .env.example .env"
fi
echo ""

# Résumé
echo "=========================================="
echo "  Installation terminée!"
echo "=========================================="
echo ""
echo "Prochaines étapes:"
echo ""
echo "1. Configurez votre fichier .env si ce n'est pas déjà fait:"
echo "   cp .env.example .env"
echo "   nano .env"
echo ""
echo "2. Assurez-vous que PostgreSQL fonctionne:"
echo "   sudo systemctl status postgresql"
echo ""
echo "3. Démarrez le serveur:"
echo "   npm start"
echo ""
echo "4. La migration de la base de données s'exécutera automatiquement"
echo "   au premier démarrage"
echo ""
echo "Documentation:"
echo "  - INSTALLATION_GUIDE.md"
echo "  - IMPLEMENTATION_SUMMARY.md"
echo ""
echo -e "${GREEN}✓${NC} Installation réussie!"
