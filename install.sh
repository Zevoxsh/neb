#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}>>> Nebula All-in-One Installer for Linux (Ubuntu/Debian) <<<${NC}"

# 1. System Updates & Dependencies
echo -e "\n${GREEN}--- 1. Updating system and installing dependencies ---${NC}"
sudo apt-get update
sudo apt-get install -y curl git postgresql postgresql-contrib certbot build-essential

# 2. Install Node.js (v18.x LTS) if not present
if ! command -v node &> /dev/null; then
    echo -e "\n${GREEN}--- 2. Installing Node.js 18.x ---${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo -e "\n${GREEN}--- 2. Node.js is already installed ($(node -v)) ---${NC}"
fi

# 3. Setup Database
echo -e "\n${GREEN}--- 3. Setting up PostgreSQL ---${NC}"
sudo service postgresql start

# Create user 'nebula' if not exists
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='nebula'" | grep -q 1; then
    echo "Creating database user 'nebula'..."
    sudo -u postgres psql -c "CREATE USER nebula WITH PASSWORD 'nebula_password';"
    sudo -u postgres psql -c "ALTER USER nebula WITH SUPERUSER;" # Optional: needed if creating extensions
else
    echo "Database user 'nebula' already exists."
fi

# Create db 'nebula' if not exists
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='nebula'" | grep -q 1; then
    echo "Creating database 'nebula'..."
    sudo -u postgres psql -c "CREATE DATABASE nebula OWNER nebula;"
else
    echo "Database 'nebula' already exists."
fi

# 4. Project Setup
echo -e "\n${GREEN}--- 4. Installing Project Dependencies ---${NC}"
# Navigate to backend directory (assuming script is run from project root)
if [ -d "backend" ]; then
    cd backend
else
    echo "Error: 'backend' directory not found. Please run this script from the project root."
    exit 1
fi

npm install

# 5. Environment Configuration
echo -e "\n${GREEN}--- 5. Configuring Environment ---${NC}"
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat <<EOT > .env
PORT=3000
DATABASE_URL=postgres://nebula:nebula_password@localhost:5432/nebula
JWT_SECRET=$(openssl rand -hex 32)
DEFAULT_ADMIN_USER=admin
DEFAULT_ADMIN_PASSWORD=admin
ACME_EMAIL=admin@example.com
PROXY_PORT80_PUBLIC=true
EOT
    echo ".env created with default settings."
else
    echo ".env already exists, skipping creation."
fi

# 6. Permissions for Certbot (Webroot)
echo -e "\n${GREEN}--- 6. Setting up Let's Encrypt Webroot ---${NC}"
sudo mkdir -p /var/www/letsencrypt
sudo chown -R $USER:$USER /var/www/letsencrypt
sudo chmod -R 755 /var/www/letsencrypt

echo -e "\n${BLUE}>>> Installation Complete! <<<${NC}"
echo -e "To start the server:"
echo -e "  ${GREEN}cd backend${NC}"
echo -e "  ${GREEN}sudo npm start${NC}  (sudo is required for binding to port 80/443)"
echo -e ""
echo -e "Default Credentials:"
echo -e "  User: ${GREEN}admin${NC}"
echo -e "  Pass: ${GREEN}admin${NC}"
