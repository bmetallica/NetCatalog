# NetCatalog - Detaillierte Installationsanleitung

Schritt-für-Schritt Guide für die Installation auf einem frischen Linux-System.

---

## Voraussetzungen überprüfen

```bash
# Node.js Version
node --version        # Sollte >= 18 sein

# PostgreSQL Version
psql --version        # Sollte >= 13 sein

# nmap installiert?
which nmap

# curl installiert?
which curl

# git installiert?
which git
```

Falls Software fehlt:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y nodejs npm postgresql postgresql-contrib nmap curl git

# Node.js aktualisieren falls nötig
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Red Hat/CentOS:**
```bash
sudo yum install -y nodejs postgresql postgresql-devel nmap curl git
sudo systemctl start postgresql
```

---

## Schritt 1: PostgreSQL Datenbank einrichten

### 1a. PostgreSQL Service starten

```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Status prüfen
sudo systemctl status postgresql
```

### 1b. Benutzer und Datenbank erstellen

**Option A: Mit sudo (empfohlen)**
```bash
sudo -u postgres psql <<'EOF'
-- Benutzer erstellen
CREATE USER netcatalog WITH PASSWORD 'change_me_to_secure_password';

-- Datenbank erstellen
CREATE DATABASE netcatalog OWNER netcatalog;

-- Extensions aktivieren (optional, aber empfohlen)
\c netcatalog
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "inet";

-- Berechtigungen überprüfen
\du netcatalog
EOF
```

**Option B: Interaktiv**
```bash
sudo -u postgres psql
postgres=# CREATE USER netcatalog WITH PASSWORD 'change_me_to_secure_password';
postgres=# CREATE DATABASE netcatalog OWNER netcatalog;
postgres=# \c netcatalog
netcatalog=# CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
netcatalog=# CREATE EXTENSION IF NOT EXISTS "inet";
postgres=# \q
```

### 1c. Verbindung testen

```bash
PGPASSWORD="change_me_to_secure_password" psql -h localhost -U netcatalog -d netcatalog -c "SELECT 1 AS connection_test;"

# Output sollte sein:
# connection_test
# ----------------
#              1
```

---

## Schritt 2: NetCatalog installieren

### 2a. Repository klonen

```bash
cd /opt
sudo git clone https://github.com/bmetallica/NetCatalog.git
sudo chown -R $USER:$USER /opt/netcatalog
cd /opt/netcatalog
```

### 2b. Umgebungsvariablen konfigurieren

```bash
# .env erstellen
cat > .env <<'EOF'
# === DATABASE ===
DB_HOST=localhost
DB_PORT=5432
DB_NAME=netcatalog
DB_USER=netcatalog
DB_PASSWORD=change_me_to_secure_password

# === NETZWERK SCANNING ===
SCAN_NETWORK=192.168.66.0/24
SCAN_INTERVAL=30
SCAN_PORTS=1-10000

# === SERVER ===
PORT=3000
NODE_ENV=production

# === OPTIONAL: Integrationen ===
PROXMOX_API_URL=
PROXMOX_API_TOKEN=
UNIFI_URL=
UNIFI_API_TOKEN=
EOF

# Berechtigungen setzen
chmod 600 .env
```

**⚠️ Wichtig:** Passen Sie Werte an:
- `DB_PASSWORD` - Verwenden Sie ein sicheres Passwort!
- `SCAN_NETWORK` - Ihr Target-Netzwerk
- `SCAN_INTERVAL` - Wie oft gescannt wird (Minuten)

### 2c. Node.js Abhängigkeiten installieren

```bash
# Backend + Frontend installieren
npm run install:all

# Dies macht:
# 1. npm install (Backend-Pakete)
# 2. cd frontend && npm install (Frontend-Pakete)
# 3. cd .. zurück
```

Falls es Fehler gibt:

```bash
# Cache löschen
npm cache clean --force

# Nochmal versuchen
npm install
cd frontend && npm install && cd ..
```

### 2d. Datenbank initialisieren

```bash
npm run db:init
```

Dies erstellt automatisch:
- Alle Tabellen (`hosts`, `services`, `scans`, `settings`, `host_availability`)
- Indizes für Performance
- Default-Settings

**Überprüfen der Datenbank:**
```bash
PGPASSWORD="change_me_to_secure_password" psql -h localhost -U netcatalog -d netcatalog -c "\dt"

# Output sollte zeigen:
#                  List of relations
#  Schema |         Name          | Type  |  Owner
# --------+-----------------------+-------+----------
#  public | host_availability     | table | netcatalog
#  public | hosts                 | table | netcatalog
#  public | scans                 | table | netcatalog
#  public | services              | table | netcatalog
#  public | settings              | table | netcatalog
```

### 2e. Frontend bauen

```bash
npm run build:frontend
```

Dies erstellt optimierte Produktions-Assets in `frontend/dist/`.

---

## Schritt 3: Lokaler Test

### 3a. Service starten (Development)

```bash
# Im Terminal starten:
npm start

# Output sollte zeigen:
# [Server] Server running on port 3000
# [Scheduler] Started
# [Database] Connected
```

### 3b. Dashboard testen

```bash
# In Browser öffnen:
http://localhost:3000

# Oder:
curl -s http://localhost:3000 | head -20
```

### 3c. Ersten Scan durchführen

```bash
# Via curl:
curl -X POST http://localhost:3000/api/scan

# Oder im Dashboard:
# 1. "Dashboard" → "Scan starten" klicken
# 2. Fortschritt verfolgen
# 3. Nach Completion Hosts anschauen
```

---

## Schritt 4: Production Setup

### 4a. Systemd Service erstellen

```bash
sudo tee /etc/systemd/system/netcatalog.service > /dev/null <<'EOF'
[Unit]
Description=NetCatalog - Network Inventory & Discovery
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=netcatalog
WorkingDirectory=/opt/netcatalog
Environment="NODE_ENV=production"
EnvironmentFile=/opt/netcatalog/.env
ExecStart=/usr/bin/node /opt/netcatalog/src/server.js

# Restart Policy
Restart=always
RestartSec=10
StartLimitInterval=600
StartLimitBurst=3

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=netcatalog

# Security
PrivateTmp=yes
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
```

### 4b. Benutzer für Service erstellen

```bash
# Benutzer erstellen
sudo useradd -r -s /bin/false netcatalog 2>/dev/null || true

# Berechtigungen setzen
sudo chown -R netcatalog:netcatalog /opt/netcatalog
sudo chmod 700 /opt/netcatalog/.env

# .env lesbar für Service machen
sudo chmod 640 /opt/netcatalog/.env
```

### 4c. Service aktivieren und starten

```bash
# Daemon reload
sudo systemctl daemon-reload

# Auto-Start aktivieren
sudo systemctl enable netcatalog

# Service starten
sudo systemctl start netcatalog

# Status prüfen
sudo systemctl status netcatalog

# Logs sehen
journalctl -u netcatalog -f              # Live-Logs
journalctl -u netcatalog -n 50           # Letzte 50 Zeilen
journalctl -u netcatalog --since "5 min ago"
```

---

## Schritt 5: Reverse Proxy (optional aber empfohlen)

### 5a. Nginx Installation

```bash
sudo apt-get install -y nginx
```

### 5b. Nginx Konfiguration

```bash
sudo tee /etc/nginx/sites-available/netcatalog > /dev/null <<'EOF'
# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name netcatalog.example.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name netcatalog.example.com;

    # SSL Certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/netcatalog.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/netcatalog.example.com/privkey.pem;

    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Proxy zu Node.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # Längeres Timeout für lange Scans
    location /api/scan {
        proxy_pass http://localhost:3000/api/scan;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # Caching für statische Assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico)$ {
        proxy_pass http://localhost:3000;
        proxy_cache_valid 200 1d;
        expires 1d;
    }
}
EOF

# Site aktivieren
sudo ln -s /etc/nginx/sites-available/netcatalog /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null || true

# SSL Zertifikat bekommen (Let's Encrypt)
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot certonly --nginx -d netcatalog.example.com

# Nginx testen & starten
sudo nginx -t
sudo systemctl restart nginx
```

---

## Schritt 6: Firewall-Regeln (UFW)

```bash
# Port 80 & 443 öffnen (für Nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Optional: Port 3000 auf localhost beschränken
sudo ufw allow from 127.0.0.1 to 127.0.0.1 port 3000

# UFW aktivieren
sudo ufw enable
sudo ufw status
```

---

## Schritt 7: Basis-Konfiguration

### 7a. Scan-Netzwerk konfigurieren

```bash
curl -X PUT http://localhost:3000/api/settings/scan_network \
  -H "Content-Type: application/json" \
  -d '{"value": "192.168.66.0/24"}'
```

### 7b. SNMP aktivieren (optional)

```bash
curl -X PUT http://localhost:3000/api/settings/snmp_community \
  -H "Content-Type: application/json" \
  -d '{"value": "public"}'
```

### 7c. Deep Discovery aktivieren

```bash
curl -X PUT http://localhost:3000/api/settings/deep_discovery_enabled \
  -H "Content-Type: application/json" \
  -d '{"value": "true"}'
```

---

## Schritt 8: FritzBox/Proxmox konfigurieren (optional)

### 8a. FritzBox Credentials hinzufügen

Im Dashboard:
1. **InfrastrukturMAP** → FritzBox Host anklicken
2. **FritzBox Credentials** Sektion
3. Host-URL, Username, Passwort eingeben
4. **Test Connection** klicken

```bash
# Oder via API:
curl -X PUT http://localhost:3000/api/hosts/{id}/fritzbox \
  -H "Content-Type: application/json" \
  -d '{
    "fritzbox_host": "http://192.168.66.91",
    "fritzbox_username": "admin",
    "fritzbox_password": "your_password"
  }'
```

---

## Troubleshooting

### Problem: "Datenbank-Verbindung fehlgeschlagen"

```bash
# 1. PostgreSQL läuft?
sudo systemctl status postgresql

# 2. Credentials korrekt?
PGPASSWORD="your_password" psql -h localhost -U netcatalog -d netcatalog -c "SELECT 1"

# 3. Logs ansehen
journalctl -u netcatalog -n 20 | grep -i "database\|error"
```

### Problem: "Permission denied" beim Scan

```bash
# nmap braucht sudo für SYN-Scan
# Lösung 1: Mit sudo starten
sudo npm start

# Lösung 2: CAP_NET_RAW setzen
sudo setcap cap_net_raw=+ep /usr/bin/nmap
```

### Problem: "Port 3000 already in use"

```bash
# Anderen Prozess finden
sudo lsof -i :3000

# Oder anderen Port nutzen
PORT=3001 npm start
```

### Problem: Frontend lädt nicht

```bash
# Frontend neu bauen
npm run build:frontend

# Oder Cache löschen
rm -rf frontend/dist
npm run build:frontend
```

---

## Upgrade von älteren Versionen

```bash
# Backup erstellen
sudo -u postgres pg_dump netcatalog > /tmp/netcatalog_backup.sql

# Neue Version pullen
cd /opt/netcatalog
git pull origin main

# Abhängigkeiten installieren
npm run install:all

# DB Schema aktualisieren
npm run db:init

# Service neu starten
sudo systemctl restart netcatalog
```

---

## Monitoring & Maintenance

### Regelmäßige Datenbank-Wartung

```bash
# Weekly: Alte Daten archivieren
PGPASSWORD="your_password" psql -h localhost -U netcatalog -d netcatalog <<EOF
-- Scans älter als 90 Tage löschen
DELETE FROM scans WHERE finished_at < NOW() - INTERVAL '90 days';

-- Verfügbarkeitsdaten älter als 30 Tage löschen
DELETE FROM host_availability WHERE checked_at < NOW() - INTERVAL '30 days';

-- Datenbank optimieren
VACUUM ANALYZE;
EOF
```

### Logs überprüfen

```bash
# Fehler in den letzten 24h
journalctl -u netcatalog --since "24 hours ago" | grep -i error

# Scan-Status
journalctl -u netcatalog | grep -i "scan\|discovery"
```

### Backup-Strategie

```bash
#!/bin/bash
# Tägliche DB-Backups (cron job)
BACKUP_DIR="/backups/netcatalog"
mkdir -p $BACKUP_DIR

PGPASSWORD="your_password" pg_dump \
  -h localhost \
  -U netcatalog \
  -d netcatalog \
  > "$BACKUP_DIR/netcatalog_$(date +%Y%m%d_%H%M%S).sql"

# Alte Backups löschen (älter als 30 Tage)
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete
```

Cron-Job hinzufügen:
```bash
crontab -e

# Täglich um 2 Uhr nachts Backup
0 2 * * * /usr/local/bin/backup-netcatalog.sh
```

---

## Performance-Tuning

### PostgreSQL Tuning

```bash
# /etc/postgresql/13/main/postgresql.conf anpassen
# (Werte für 4GB RAM Server)

shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 4MB
min_wal_size = 2GB
max_wal_size = 8GB

# Service neu starten
sudo systemctl restart postgresql
```

### Scan-Tuning

In `.env`:
```env
SCAN_TIMEOUT=30         # Timeout pro Host in Sekunden
SCAN_MAX_WORKERS=10     # Parallele nmap Prozesse
```

---

## Weitere Hilfe

- **Logs:** `journalctl -u netcatalog -f`
- **GitHub Issues:** https://github.com/bmetallica/NetCatalog/issues
- **Dokumentation:** [README.md](./README.md)

