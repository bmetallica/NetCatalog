#!/bin/bash

################################################################################
#                         NetCatalog Quick Install                            #
#                      Automated Installation Script                          #
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="${INSTALL_DIR:-.}"
DB_USER="netcatalog"
DB_NAME="netcatalog"
DEFAULT_SCAN_NETWORK="192.168.1.0/24"
DEFAULT_SCAN_INTERVAL="30"
DEFAULT_PORT="3000"

################################################################################
#                            Helper Functions                                 #
################################################################################

print_header() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}  $1"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

print_step() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}→${NC} $1"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

ask_yes_no() {
    local prompt="$1"
    local response
    
    while true; do
        read -p "$(echo -e ${YELLOW}$prompt${NC}) (ja/nein): " response
        case "$response" in
            [jJ][aA]|[yY][eE][sS]) return 0 ;;
            [nN][eE][iI]|[nN][oO]) return 1 ;;
            *) echo "Bitte antworte mit ja oder nein." ;;
        esac
    done
}

ask_input() {
    local prompt="$1"
    local default="$2"
    local response
    
    if [ -z "$default" ]; then
        read -p "$(echo -e ${YELLOW}$prompt${NC}): " response
    else
        read -p "$(echo -e ${YELLOW}$prompt${NC}) [${GREEN}$default${NC}]: " response
        response="${response:-$default}"
    fi
    echo "$response"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

################################################################################
#                         System Checks                                       #
################################################################################

check_os() {
    print_step "Überprüfe Betriebssystem"
    
    if [[ ! "$OSTYPE" == "linux-gnu"* ]]; then
        print_error "Dieses Script funktioniert nur auf Linux"
        exit 1
    fi
    
    if command_exists apt-get; then
        PACKAGE_MANAGER="apt-get"
        INSTALL_CMD="sudo apt-get install -y"
        UPDATE_CMD="sudo apt-get update"
    elif command_exists yum; then
        PACKAGE_MANAGER="yum"
        INSTALL_CMD="sudo yum install -y"
        UPDATE_CMD="sudo yum update -y"
    else
        print_error "Unsupported package manager"
        exit 1
    fi
    
    print_success "OS erkannt: $OSTYPE ($PACKAGE_MANAGER)"
}

check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_error "Bitte führe dieses Script NICHT als root aus"
        exit 1
    fi
    print_success "Nicht als root ausgeführt ✓"
}

check_dependencies() {
    print_step "Überprüfe Abhängigkeiten"
    
    local missing=()
    
    for cmd in git curl; do
        if ! command_exists "$cmd"; then
            missing+=("$cmd")
        else
            print_success "$cmd vorhanden"
        fi
    done
    
    # Node.js check
    if ! command_exists node; then
        missing+=("nodejs")
        print_error "Node.js fehlt"
    else
        local node_version=$(node -v)
        local node_major=$(echo $node_version | cut -d. -f1 | sed 's/v//')
        if [ "$node_major" -lt 18 ]; then
            print_error "Node.js >= 18 erforderlich, hast: $node_version"
            missing+=("nodejs-upgrade")
        else
            print_success "Node.js $node_version vorhanden"
        fi
    fi
    
    # PostgreSQL check
    if ! command_exists psql; then
        print_error "PostgreSQL fehlt"
        if ask_yes_no "PostgreSQL installieren?"; then
            install_postgresql
        else
            print_error "PostgreSQL wird benötigt. Abbruch."
            exit 1
        fi
    else
        local pg_version=$(psql --version)
        print_success "$pg_version vorhanden"
    fi
    
    # nmap check
    if ! command_exists nmap; then
        print_error "nmap fehlt"
        missing+=("nmap")
    else
        print_success "nmap vorhanden"
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        print_step "Installiere fehlende Abhängigkeiten"
        
        if [[ " ${missing[@]} " =~ " nodejs " ]]; then
            if [ "$PACKAGE_MANAGER" = "apt-get" ]; then
                curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            fi
        fi
        
        for pkg in "${missing[@]}"; do
            if [ "$pkg" != "nodejs-upgrade" ]; then
                print_info "Installiere $pkg..."
                $INSTALL_CMD "$pkg" || print_error "Konnte $pkg nicht installieren"
            fi
        done
    fi
}

install_postgresql() {
    print_step "Installiere und konfiguriere PostgreSQL"
    
    if [ "$PACKAGE_MANAGER" = "apt-get" ]; then
        $UPDATE_CMD
        $INSTALL_CMD postgresql postgresql-contrib
    else
        $INSTALL_CMD postgresql-server postgresql-contrib
        sudo systemctl start postgresql
    fi
    
    # Start PostgreSQL
    sudo systemctl enable postgresql
    sudo systemctl start postgresql
    
    print_success "PostgreSQL installiert und gestartet"
}

################################################################################
#                      Database Setup                                          #
################################################################################

setup_database() {
    print_step "Richte PostgreSQL Datenbank ein"
    
    # Check if user exists
    if sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename = '$DB_USER'" | grep -q 1; then
        print_info "PostgreSQL User '$DB_USER' existiert bereits"
        
        if ask_yes_no "Existierenden User und Datenbank verwenden?"; then
            # Test connection
            if ask_yes_no "PostgreSQL Passwort eingeben zum Testen?"; then
                read -sp "Passwort für $DB_USER: " db_password
                echo
                if PGPASSWORD="$db_password" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
                    print_success "Datenbankverbindung erfolgreich"
                    DB_PASSWORD="$db_password"
                else
                    print_error "Datenbankverbindung fehlgeschlagen"
                    exit 1
                fi
            fi
            return 0
        else
            print_error "Kann nicht fortfahren. Datenbank manuell löschen oder anderen User verwenden."
            exit 1
        fi
    fi
    
    # Create new user and database
    print_info "Erstelle neuen PostgreSQL User und Datenbank..."
    
    local db_password=$(openssl rand -base64 12)
    
    sudo -u postgres psql <<EOF
CREATE USER $DB_USER WITH PASSWORD '$db_password';
CREATE DATABASE $DB_NAME OWNER $DB_USER;

\c $DB_NAME
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "inet";
EOF
    
    print_success "Datenbank erstellt: $DB_NAME"
    print_success "Benutzer erstellt: $DB_USER"
    print_info "Passwort: $db_password"
    
    DB_PASSWORD="$db_password"
}

################################################################################
#                      Repository Setup                                        #
################################################################################

setup_repository() {
    print_step "Richte Repository ein"
    
    if [ -d "$INSTALL_DIR/.git" ]; then
        print_info "Git Repository existiert bereits"
        cd "$INSTALL_DIR"
    else
        if [ "$INSTALL_DIR" = "." ]; then
            print_info "Initialisiere lokales Repository"
            cd /opt/netcatalog
        else
            print_error "Repository nicht gefunden und INSTALL_DIR nicht /opt/netcatalog"
            exit 1
        fi
    fi
    
    print_success "Im Verzeichnis: $(pwd)"
}

################################################################################
#                      Environment Setup                                       #
################################################################################

setup_environment() {
    print_step "Konfiguriere Umgebungsvariablen"
    
    local env_file=".env"
    
    if [ -f "$env_file" ]; then
        print_info ".env Datei existiert bereits"
        if ask_yes_no "Überschreiben?"; then
            rm "$env_file"
        else
            print_success "Verwende bestehende .env"
            return 0
        fi
    fi
    
    # Get configuration from user
    local scan_network=$(ask_input "Scan-Netzwerk" "$DEFAULT_SCAN_NETWORK")
    local scan_interval=$(ask_input "Scan-Intervall (Minuten)" "$DEFAULT_SCAN_INTERVAL")
    local port=$(ask_input "Server Port" "$DEFAULT_PORT")
    
    # Create .env file
    cat > "$env_file" <<EOF
# ===== DATABASE =====
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# ===== NETWORK SCANNING =====
SCAN_NETWORK=$scan_network
SCAN_INTERVAL=$scan_interval
SCAN_PORTS=1-10000

# ===== SERVER =====
PORT=$port
NODE_ENV=production

# ===== OPTIONAL: Enterprise Integrations =====
# Credentials für Deep Discovery (FritzBox, Proxmox, UniFi) werden
# per Host in der Web-UI eingegeben, NICHT hier!
# Das ermöglicht mehrere FritzBox/Proxmox Server mit unterschiedlichen Credentials

# Beispiel für zukünftige zentrale Integrationen (optional):
# UNIFI_URL=
# UNIFI_API_TOKEN=
EOF
    
    chmod 600 "$env_file"
    print_success ".env Datei erstellt"
    print_info "Wichtig: Deep Discovery Credentials (FritzBox, Proxmox) werden pro Host in der Web-UI eingegeben!"
}

################################################################################
#                      Installation                                           #
################################################################################

install_dependencies() {
    print_step "Installiere Node.js Dependencies"
    
    print_info "Backend Dependencies..."
    npm install || {
        print_error "npm install fehlgeschlagen"
        exit 1
    }
    
    print_info "Frontend Dependencies..."
    cd frontend
    npm install || {
        print_error "Frontend npm install fehlgeschlagen"
        exit 1
    }
    cd ..
    
    print_success "Dependencies installiert"
}

initialize_database() {
    print_step "Initialisiere Datenbank"
    
    npm run db:init || {
        print_error "Datenbankinitialisierung fehlgeschlagen"
        exit 1
    }
    
    print_success "Datenbank initialisiert"
}

build_frontend() {
    print_step "Baue Frontend"
    
    npm run build:frontend || {
        print_error "Frontend Build fehlgeschlagen"
        exit 1
    }
    
    print_success "Frontend gebaut"
}

################################################################################
#                      Service Setup (Optional)                                #
################################################################################

setup_systemd_service() {
    print_step "Systemd Service einrichten (optional)"
    
    if ! ask_yes_no "Systemd Service installieren?"; then
        return 0
    fi
    
    local install_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Create user for service
    if ! id "$DB_USER" >/dev/null 2>&1; then
        print_info "Erstelle System-User '$DB_USER'..."
        sudo useradd -r -s /bin/false "$DB_USER"
    fi
    
    # Set permissions
    sudo chown -R "$DB_USER:$DB_USER" "$install_dir"
    sudo chmod 700 "$install_dir/.env"
    
    # Create systemd service
    local service_file="/etc/systemd/system/netcatalog.service"
    
    print_info "Erstelle $service_file..."
    
    sudo tee "$service_file" > /dev/null <<EOF
[Unit]
Description=NetCatalog - Network Inventory & Discovery
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=$install_dir
Environment="NODE_ENV=production"
EnvironmentFile=$install_dir/.env
ExecStart=/usr/bin/node $install_dir/src/server.js

Restart=always
RestartSec=10
StartLimitInterval=600
StartLimitBurst=3

StandardOutput=journal
StandardError=journal
SyslogIdentifier=netcatalog

PrivateTmp=yes
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
    
    sudo systemctl daemon-reload
    sudo systemctl enable netcatalog
    
    print_success "Systemd Service installiert"
    print_info "Starte mit: sudo systemctl start netcatalog"
}

################################################################################
#                      Verification                                            #
################################################################################

verify_installation() {
    print_step "Überprüfe Installation"
    
    # Check .env
    if [ ! -f ".env" ]; then
        print_error ".env Datei nicht gefunden"
        return 1
    fi
    print_success ".env Datei existiert"
    
    # Check node_modules
    if [ ! -d "node_modules" ]; then
        print_error "node_modules nicht gefunden"
        return 1
    fi
    print_success "node_modules existiert"
    
    # Check frontend dist
    if [ ! -d "frontend/dist" ]; then
        print_error "frontend/dist nicht gefunden"
        return 1
    fi
    print_success "frontend/dist existiert"
    
    # Check database
    if ! PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
        print_error "Datenbankverbindung fehlgeschlagen"
        return 1
    fi
    print_success "Datenbankverbindung funktioniert"
    
    return 0
}

################################################################################
#                      Final Steps                                             #
################################################################################

print_summary() {
    print_header "Installation abgeschlossen! ✨"
    
    echo ""
    echo -e "${GREEN}NetCatalog ist ready${NC}"
    echo ""
    echo "Nächste Schritte:"
    echo ""
    echo "  1. Service starten:"
    echo "     ${BLUE}npm start${NC}"
    echo ""
    echo "  2. Dashboard öffnen:"
    echo "     ${BLUE}http://localhost:$(grep '^PORT=' .env | cut -d= -f2)${NC}"
    echo ""
    echo "  3. Netzwerk scannen:"
    echo "     - Dashboard öffnen"
    echo "     - 'Scan starten' klicken"
    echo "     - Warten auf Scan-Ende"
    echo ""
    echo "  4. FritzBox/Proxmox hinzufügen:"
    echo "     - InfrastrukturMAP öffnen"
    echo "     - Host klicken"
    echo "     - Credentials eingeben"
    echo ""
    echo "  5. Logs sehen (wenn Systemd installiert):"
    echo "     ${BLUE}journalctl -u netcatalog -f${NC}"
    echo ""
    echo "Dokumentation:"
    echo "  - Schnellstart:      ./QUICKSTART.md"
    echo "  - Installation:      ./INSTALLATION_GUIDE.md"
    echo "  - Datenbank:         ./DATABASE_SCHEMA.md"
    echo "  - FritzBox Setup:    ./FRITZBOX_DEEP_DISCOVERY.md"
    echo ""
}

################################################################################
#                      Main Execution                                          #
################################################################################

main() {
    print_header "NetCatalog Quick Installation"
    
    echo ""
    print_info "Dieses Script installiert NetCatalog mit allen Abhängigkeiten"
    echo ""
    
    if ! ask_yes_no "Installation starten?"; then
        print_error "Abgebrochen"
        exit 0
    fi
    
    # Pre-checks
    check_root
    check_os
    check_dependencies
    
    # Setup
    setup_repository
    setup_database
    setup_environment
    
    # Install
    install_dependencies
    initialize_database
    build_frontend
    
    # Optional service
    setup_systemd_service
    
    # Verify
    if verify_installation; then
        print_summary
    else
        print_error "Installation konnte nicht vollständig verifiziert werden"
        exit 1
    fi
}

# Run main function
main "$@"
