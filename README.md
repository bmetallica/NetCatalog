# NetCatalog

Automatische Netzwerk-Inventarisierung und Service-Erkennung. NetCatalog scannt dein lokales Netzwerk, erkennt Geraete und deren Dienste und stellt alles uebersichtlich in einem Web-Dashboard dar.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13+-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **Automatische Netzwerkerkennung** - Ping-Sweep + SYN-Scan findet alle aktiven Geraete
- **Tiefe Service-Identifikation** - Erkennt 50+ Dienste durch Banner-Grabbing, HTTP-Probing und Signatur-Matching
- **Verfuegbarkeits-Tracking** - 24h-Zeitleiste pro Host mit 30-Tage-Historie
- **Geplante Scans** - Konfigurierbare automatische Scans per Cron
- **Responsives Dashboard** - Dark-Theme Web-UI mit Host-Uebersicht, Service-Details und Scan-Historie
- **OS-Erkennung** - Betriebssystem-Erkennung via nmap OS-Fingerprinting

## Screenshots

Das Dashboard zeigt eine Uebersicht aller erkannten Hosts, deren Status, offene Ports und identifizierte Services.

## Voraussetzungen

- **Node.js** >= 18
- **PostgreSQL** >= 13
- **nmap** (mit Root-Rechten fuer SYN-Scan und OS-Erkennung)
- **curl** (fuer HTTP-Probing)
- Linux (getestet auf Debian 11)

## Installation

### 1. Repository klonen

```bash
git clone https://github.com/bmetallica/NetCatalog.git
cd NetCatalog
```

### 2. PostgreSQL-Datenbank einrichten

```bash
sudo -u postgres psql <<EOF
CREATE USER netcatalog WITH PASSWORD 'dein_passwort';
CREATE DATABASE netcatalog OWNER netcatalog;
EOF
```

### 3. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
```

`.env` anpassen:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=netcatalog
DB_USER=netcatalog
DB_PASSWORD=dein_passwort

SCAN_NETWORK=192.168.1.0/24
SCAN_INTERVAL_MINUTES=30
PORT=3000
```

### 4. Abhaengigkeiten installieren

```bash
npm run install:all
```

### 5. Datenbank initialisieren

```bash
npm run db:init
```

### 6. Frontend bauen

```bash
npm run build:frontend
```

### 7. Starten

```bash
# Direkt
npm start

# Oder als systemd Service (empfohlen)
```

## Systemd Service (empfohlen)

Erstelle `/etc/systemd/system/netcatalog.service`:

```ini
[Unit]
Description=NetCatalog - Network Device and Service Catalog
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/netcatalog
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable netcatalog
systemctl start netcatalog
```

> **Hinweis:** Der Service laeuft als root, da nmap Root-Rechte fuer SYN-Scans und OS-Erkennung benoetigt.

## Zugriff

Nach dem Start ist das Dashboard unter `http://<server-ip>:3000` erreichbar.

## Projektstruktur

```
NetCatalog/
├── src/
│   ├── server.js              # Express-Server
│   ├── db/
│   │   ├── pool.js            # PostgreSQL Connection Pool
│   │   └── init.js            # Datenbank-Schema
│   ├── models/
│   │   ├── hosts.js           # Host-Datenzugriff
│   │   ├── services.js        # Service-Datenzugriff
│   │   ├── scans.js           # Scan-Historie
│   │   ├── settings.js        # Einstellungen
│   │   └── availability.js    # Verfuegbarkeits-Daten
│   ├── routes/
│   │   └── api.js             # REST API Endpoints
│   └── services/
│       ├── scanner.js         # nmap Scan-Engine
│       ├── serviceIdentifier.js # Service-Erkennung (50+ Signaturen)
│       └── scheduler.js       # Cron-Scheduler
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Routing & Navigation
│   │   ├── api.js             # API Client
│   │   ├── index.css          # Styles (Dark Theme)
│   │   └── pages/
│   │       ├── Dashboard.jsx      # Uebersicht
│   │       ├── Hosts.jsx          # Host-Liste
│   │       ├── HostDetail.jsx     # Host-Details & Services
│   │       ├── Availability.jsx   # Verfuegbarkeits-Zeitleiste
│   │       ├── ScanHistory.jsx    # Scan-Verlauf
│   │       └── Settings.jsx       # Einstellungen
│   ├── package.json
│   └── vite.config.js
├── package.json
├── .env.example
└── README.md
```

## API Endpoints

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/stats` | Dashboard-Statistiken |
| GET | `/api/hosts` | Alle Hosts |
| GET | `/api/hosts/:id` | Host-Details mit Services |
| DELETE | `/api/hosts/:id` | Host loeschen |
| GET | `/api/scans` | Scan-Historie |
| POST | `/api/scans/start` | Manuellen Scan starten |
| GET | `/api/scans/status` | Aktueller Scan-Status |
| GET | `/api/availability?date=YYYY-MM-DD` | Verfuegbarkeitsdaten pro Tag |
| GET | `/api/settings` | Einstellungen lesen |
| PUT | `/api/settings` | Einstellungen aendern |

## Lizenz

MIT
