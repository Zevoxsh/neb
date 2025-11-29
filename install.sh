#!/usr/bin/env bash
set -euo pipefail

# Nebula Universal Installer
# Supports: Debian/Ubuntu (apt), Alpine (apk), RHEL/Fedora (dnf/yum), Arch (pacman)
# Sets up project under /opt/neb and registers an autostart service (systemd or OpenRC)

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${BLUE}>>> Nebula Universal Installer (multi-distro) <<<${NC}"

if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Warning: It's recommended to run this script as root or with sudo. Some actions require root.${NC}"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
DEST_DIR="/opt/neb"
SERVICE_USER="nebula"
NODE_VERSION="18"

detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO_ID="$ID"
        DISTRO_LIKE="$ID_LIKE"
    else
        DISTRO_ID="unknown"
        DISTRO_LIKE=""
    fi
}

install_packages() {
    local pkgs="$*"
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y $pkgs
    elif command -v apk >/dev/null 2>&1; then
        apk update
        apk add --no-cache $pkgs
    elif command -v dnf >/dev/null 2>&1; then
        dnf install -y $pkgs
    elif command -v yum >/dev/null 2>&1; then
        yum install -y $pkgs
    elif command -v pacman >/dev/null 2>&1; then
        pacman -Sy --noconfirm $pkgs
    else
        echo -e "${YELLOW}Unsupported package manager, please install: $pkgs${NC}"
        return 1
    fi
}

install_node() {
    if command -v node >/dev/null 2>&1; then
        echo -e "${GREEN}Node is already installed: $(node -v)${NC}"
        return 0
    fi

    if command -v apt-get >/dev/null 2>&1 || command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
        echo -e "${GREEN}Installing Node.js ${NODE_VERSION}.x via NodeSource...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
        if command -v apt-get >/dev/null 2>&1; then
            apt-get install -y nodejs
        elif command -v dnf >/dev/null 2>&1; then
            dnf install -y nodejs
        else
            yum install -y nodejs
        fi
    elif command -v apk >/dev/null 2>&1; then
        echo -e "${GREEN}Installing Node.js via apk...${NC}"
        apk add --no-cache nodejs npm
    elif command -v pacman >/dev/null 2>&1; then
        echo -e "${GREEN}Installing Node.js via pacman...${NC}"
        pacman -Sy --noconfirm nodejs npm
    else
        echo -e "${YELLOW}Could not install Node automatically. Please install Node ${NODE_VERSION} manually.${NC}"
        return 1
    fi
}

install_postgres() {
    if command -v pg_ctl >/dev/null 2>&1 || command -v psql >/dev/null 2>&1; then
        echo -e "${GREEN}Postgres already available${NC}"
        return 0
    fi

    echo -e "${GREEN}Installing PostgreSQL (if available for this distro)...${NC}"
    if command -v apt-get >/dev/null 2>&1; then
        apt-get install -y postgresql postgresql-contrib
        systemctl enable --now postgresql || service postgresql start || true
    elif command -v apk >/dev/null 2>&1; then
        apk add --no-cache postgresql postgresql-contrib
        # Initialize DB for Alpine
        su - postgres -s /bin/sh -c "initdb --auth=trust -D /var/lib/postgresql/data" || true
        rc-service postgresql start || true
    elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
        if command -v dnf >/dev/null 2>&1; then
            dnf install -y postgresql-server
            postgresql-setup --initdb || true
            systemctl enable --now postgresql || true
        else
            yum install -y postgresql-server
            postgresql-setup initdb || true
            systemctl enable --now postgresql || true
        fi
    else
        echo -e "${YELLOW}Postgres install not supported automatically on this distro. Please install manually.${NC}"
    fi
}

create_service_systemd() {
    local nodebin
    nodebin="$(command -v node || echo /usr/bin/node)"
    cat > /etc/systemd/system/nebula.service <<EOF
[Unit]
Description=Nebula Dashboard Service
After=network.target postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${DEST_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${DEST_DIR}/.env
ExecStart=${nodebin} ${DEST_DIR}/backend/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable nebula.service
    systemctl start nebula.service || true
}

create_service_openrc() {
    cat > /etc/init.d/nebula <<'EOF'
#!/sbin/openrc-run
command="/usr/bin/node"
command_args="/opt/neb/backend/src/index.js"
pidfile="/var/run/nebula.pid"
name="nebula"
command_background=true
directory="/opt/neb"
user="nebula"
depend() {
    need net
}
EOF
    chmod +x /etc/init.d/nebula
    rc-update add nebula default || true
    rc-service nebula start || true
}

create_env() {
    if [ ! -f "${DEST_DIR}/.env" ]; then
        echo -e "${GREEN}Creating default .env in ${DEST_DIR}${NC}"
        cat > "${DEST_DIR}/.env" <<EOT
PORT=3000
DATABASE_URL=postgres://nebula:nebula_password@localhost:5432/nebula
JWT_SECRET=$(openssl rand -hex 32)
DEFAULT_ADMIN_USER=admin
DEFAULT_ADMIN_PASSWORD=admin
ACME_EMAIL=admin@example.com
PROXY_PORT80_PUBLIC=true
EOT
        chown ${SERVICE_USER}:${SERVICE_USER} "${DEST_DIR}/.env" || true
    else
        echo -e "${YELLOW}.env already exists at ${DEST_DIR}, skipping${NC}"
    fi
}

main() {
    detect_distro
    echo -e "Detected distro: ${DISTRO_ID} (like: ${DISTRO_LIKE})"

    # Basic tools
    if command -v apt-get >/dev/null 2>&1; then
        install_packages curl git openssl ca-certificates build-base || true
    elif command -v apk >/dev/null 2>&1; then
        install_packages curl git openssl ca-certificates build-base bash || true
    else
        install_packages curl git openssl ca-certificates || true
    fi

    install_node || true
    install_postgres || true

    # Create service user
    if ! id -u ${SERVICE_USER} >/dev/null 2>&1; then
        useradd -r -s /usr/sbin/nologin -m -d /home/${SERVICE_USER} ${SERVICE_USER} || true
        echo -e "${GREEN}Created system user: ${SERVICE_USER}${NC}"
    else
        echo -e "${YELLOW}User ${SERVICE_USER} already exists${NC}"
    fi

    # Copy project to DEST_DIR
    if [ "${SCRIPT_DIR}" = "${DEST_DIR}" ]; then
        echo -e "${GREEN}Installer running from ${DEST_DIR}, skipping copy${NC}"
    else
        if [ -d "${DEST_DIR}" ]; then
            echo -e "${YELLOW}${DEST_DIR} already exists. Backing up to ${DEST_DIR}.bak${NC}"
            rm -rf "${DEST_DIR}.bak" || true
            mv "${DEST_DIR}" "${DEST_DIR}.bak" || true
        fi
        echo -e "${GREEN}Copying project to ${DEST_DIR}${NC}"
        mkdir -p "${DEST_DIR}"
        rsync -a --delete "${SCRIPT_DIR}/" "${DEST_DIR}/"
        chown -R ${SERVICE_USER}:${SERVICE_USER} "${DEST_DIR}"
    fi

    # Install node deps
    echo -e "${GREEN}Installing npm dependencies in ${DEST_DIR}${NC}"
    if command -v npm >/dev/null 2>&1; then
        npm --prefix "${DEST_DIR}" install --production || npm --prefix "${DEST_DIR}" install || true
    else
        echo -e "${YELLOW}npm not found, skipping npm install${NC}"
    fi

    create_env

    # Register service according to init system
    if command -v systemctl >/dev/null 2>&1; then
        echo -e "${GREEN}Creating systemd service...${NC}"
        create_service_systemd
        echo -e "${GREEN}Systemd service created; check with: systemctl status nebula${NC}"
    elif command -v rc-service >/dev/null 2>&1 || [ -d /etc/init.d ]; then
        echo -e "${GREEN}Creating OpenRC service...${NC}"
        create_service_openrc
        echo -e "${GREEN}OpenRC service created; check with: rc-service nebula status${NC}"
    else
        echo -e "${YELLOW}No supported init system detected. You can run the app manually: ${NC}node ${DEST_DIR}/backend/src/index.js"
    fi

    echo -e "\n${BLUE}>>> Installation finished. Next steps:${NC}"
    echo -e " - View logs: ${GREEN}journalctl -u nebula -f${NC}  (systemd)"
    echo -e " - Service status: ${GREEN}systemctl status nebula${NC}  (systemd)"
    echo -e " - If using OpenRC: ${GREEN}rc-service nebula status${NC}"
}

main "$@"

