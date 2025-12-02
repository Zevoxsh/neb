@echo off
echo 🚀 Installation de Nebula Proxy
echo ================================
echo.

REM Vérifier si Node.js est installé
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js n'est pas installé. Veuillez installer Node.js 14+ avant de continuer.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js version: %NODE_VERSION%

REM Vérifier si npm est installé
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ npm n'est pas installé. Veuillez installer npm avant de continuer.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo ✅ npm version: %NPM_VERSION%

echo.
echo 📦 Installation des dépendances...
call npm install

if %errorlevel% neq 0 (
    echo ❌ Erreur lors de l'installation des dépendances
    pause
    exit /b 1
)

echo.
echo ✅ Dépendances installées avec succès
echo.
echo 🌐 Démarrage du serveur d'installation...
echo.

REM Démarrer le serveur
call npm start

echo.
echo 📝 Suivez les instructions à l'écran pour configurer votre installation
pause
