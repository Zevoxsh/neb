#!/bin/bash

echo "🚀 Installation de Nebula Proxy"
echo "================================"
echo ""

# Vérifier si Node.js est installé
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé. Veuillez installer Node.js 14+ avant de continuer."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Vérifier si npm est installé
if ! command -v npm &> /dev/null; then
    echo "❌ npm n'est pas installé. Veuillez installer npm avant de continuer."
    exit 1
fi

echo "✅ npm version: $(npm --version)"

# Installer les dépendances
echo ""
echo "📦 Installation des dépendances..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Erreur lors de l'installation des dépendances"
    exit 1
fi

echo ""
echo "✅ Dépendances installées avec succès"
echo ""
echo "🌐 Démarrage du serveur d'installation..."
echo ""

# Démarrer le serveur
npm start

# Si le serveur démarre correctement, il affichera l'URL d'installation
echo ""
echo "📝 Suivez les instructions à l'écran pour configurer votre installation"
