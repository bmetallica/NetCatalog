# QuickInstall Guide - NetCatalog

## Überblick

Das `quickinstall.sh` Script automatisiert die vollständige Installation von NetCatalog auf einem frischen Linux-System. Es kümmert sich um:

- ✅ System-Abhängigkeiten (Node.js, PostgreSQL, nmap, curl, git)
- ✅ PostgreSQL Datenbank-Einrichtung
- ✅ Datenbank-Initialisierung
- ✅ Node.js Dependencies (Backend + Frontend)
- ✅ Frontend Build
- ✅ Umgebungsvariablen Konfiguration
- ✅ Optional: Systemd Service Setup
- ✅ Verifikation und Zusammenfassung

## Schnellstart

```bash
# 1. Script ausführbar machen
chmod +x quickinstall.sh

# 2. Installation starten
./quickinstall.sh
```

Das Script wird dich durch alle notwendigen Schritte führen.

## Anforderungen

### Unterstützte Systeme
- **Ubuntu / Debian** (apt-get)
- **RHEL / CentOS / Rocky Linux** (yum)

### Mindestanforderungen
- 4 GB RAM
- 2 CPU Cores
- 10 GB freier Speicherplatz
- Internetverbindung für Paketdownloads
- `sudo` Zugriff (für Systemd und PostgreSQL)

### Browser für WebUI
- Chrome/Chromium (empfohlen)
- Firefox
- Safari
- Edge

## Was macht das Script im Detail?

### 1. System-Checks

```
Überprüfung:
  → Betriebssystem (muss Linux sein)
  → Package Manager (apt-get oder yum)
  → Nicht als root ausgeführt
  → sudo Zugriff verfügbar
```

### 2. Abhängigkeiten

Das Script prüft und installiert wenn nötig:

| Paket | Version | Verwendung |
|-------|---------|-----------|
| Node.js | ≥18.0 | Server & Frontend |
| PostgreSQL | ≥13.0 | Datenbank |
| Git | ≥2.0 | Repository |
| curl | ≥7.0 | HTTP Requests |
| nmap | ≥7.0 | Port Scanning |

### 3. PostgreSQL Einrichtung

Das Script:
- Prüft ob PostgreSQL läuft
- Fragt ob PostgreSQL installiert werden soll (bei fehlender Installation)
- Erstellt einen neuen Benutzer `netcatalog` mit sicherer Passworterzeugung
- Erstellt die Datenbank `netcatalog`
- Aktiviert notwendige PostgreSQL Extensions (uuid-ossp, inet)
- Verifiziert die Verbindung

**Alternativ: Manuelle PostgreSQL-Installation**
```bash
# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib

# Danach manuell User/DB erstellen
sudo -u postgres createuser netcatalog
sudo -u postgres createdb netcatalog -O netcatalog
```

### 4. Umgebungsvariablen (.env)

Das Script erstellt eine `.env` Datei mit interaktiven Prompts für:

```env
# DATABASE (Auto-konfiguriert)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=netcatalog
DB_USER=netcatalog
DB_PASSWORD=<generiert automatisch>

# NETWORK SCANNING (benutzer-konfigurierbar)
SCAN_NETWORK=192.168.1.0/24    # Dein Netzwerk
SCAN_INTERVAL=30               # Minuten zwischen Scans
SCAN_PORTS=1-10000             # Zu scannende Ports

# SERVER
PORT=3000                       # Web-Interface Port
NODE_ENV=production

# HINWEIS: Deep Discovery Credentials
# FritzBox, Proxmox, UniFi Credentials werden NICHT hier eingegeben!
# Sie werden pro Host in der Web-UI unter InfrastrukturMAP eingegeben.
# Das ermöglicht mehrere Geräte mit unterschiedlichen Credentials.
```

### 5. Installation & Build

```
→ npm install (Backend)
  - Installiert alle Node.js Dependencies
  
→ cd frontend && npm install (Frontend)
  - Installiert React und Build-Tools
  
→ npm run db:init
  - Initialisiert Datenbank-Schema
  - Erstellt alle Tabellen
  
→ npm run build:frontend
  - Baut React Production-Bundle
  - Optimiert und minimiert Code
```

### 6. Systemd Service (Optional)

Wenn du "ja" antwortest:

```bash
# Service wird erstellt und aktiviert
/etc/systemd/system/netcatalog.service

# Auto-Start beim Booten aktiviert
sudo systemctl enable netcatalog

# Service-Status prüfen
sudo systemctl status netcatalog

# Logs ansehen
journalctl -u netcatalog -f
```

### 7. Verifikation

Das Script verifiziert:
- ✓ .env Datei existiert und ist lesbar
- ✓ node_modules vorhanden
- ✓ frontend/dist gebaut
- ✓ Datenbankverbindung funktioniert
- ✓ Alle notwendigen Dateien present

## Interaktive Prompts

Das Script wird dich fragen:

### 1. Installation bestätigen?
```
ℹ Installation starten? (ja/nein):
```
→ "ja" zum Fortfahren

### 2. PostgreSQL (wenn nicht installiert)
```
ℹ PostgreSQL installieren? (ja/nein):
```
→ "ja" zum Installieren oder manuell installieren

### 3. Existierende Datenbank
```
ℹ Existierenden User und Datenbank verwenden? (ja/nein):
```
→ Falls `netcatalog` User/DB schon vorhanden

### 4. .env überschreiben
```
ℹ Überschreiben? (ja/nein):
```
→ Wenn .env schon existiert

### 5. Scan-Einstellungen
```
ℹ Scan-Netzwerk [192.168.1.0/24]: 192.168.0.0/24
ℹ Scan-Intervall (Minuten) [30]: 60
ℹ Server Port [3000]: 3000
```
→ Enter zum Verwenden der Default-Werte

### 6. Systemd Service
```
ℹ Systemd Service installieren? (ja/nein):
```
→ "ja" um Auto-Start beim Boot zu aktivieren

## Nach der Installation

### 1. Server starten

**Ohne Systemd:**
```bash
npm start
```

**Mit Systemd:**
```bash
sudo systemctl start netcatalog
sudo systemctl status netcatalog
journalctl -u netcatalog -f
```

### 2. Web-Interface öffnen

```
http://localhost:3000
```

### 3. Erstes Scan durchführen

1. Dashboard öffnen
2. "Netzwerk Scan starten" klicken
3. Warten auf Completion (5-10 Minuten abhängig von Netzwerkgröße)
4. Ergebnisse unter "Hosts" ansehen

### 4. FritzBox einrichten

Wenn du einen FRITZ!Box-Router hast:

1. InfrastrukturMAP öffnen
2. Auf den FritzBox-Host klicken
3. FritzBox-Sektion öffnen
4. Hostname/IP, Username, Password eingeben
5. "Verbindung testen" klicken
6. "Speichern" - WLAN-Geräte werden automatisch entdeckt

### 5. Proxmox einrichten (optional)

Für Proxmox VE oder PVE:

1. InfrastrukturMAP öffnen
2. Auf Proxmox-Host klicken
3. Proxmox-Sektion öffnen
4. IP und Token eingeben
5. VMs werden automatisch erkannt

## Konfiguration nach Installation

### Scan-Netzwerk ändern

Ändere `SCAN_NETWORK` in `.env`:
```env
# Alles scannen (nicht empfohlen)
SCAN_NETWORK=0.0.0.0/0

# Nur Subnetz
SCAN_NETWORK=192.168.1.0/24
SCAN_NETWORK=10.0.0.0/8

# Mehrere Netzwerke (eines pro Zeile)
SCAN_NETWORK=192.168.1.0/24
```

Danach Server neu starten:
```bash
npm start
# oder
sudo systemctl restart netcatalog
```

### Server Port ändern

Ändere `PORT` in `.env`:
```env
PORT=8080
```

Dann Server neu starten.

### Deep Discovery Credentials

**Wichtig:** Credentials werden NICHT in `.env` oder Konfigurationsdateien gespeichert!

Sie werden stattdessen:
- Pro Host in der Web-UI eingegeben
- In der PostgreSQL-Datenbank gespeichert (verschlüsselt)
- Im Frontend über InfrastrukturMAP-Interface verwaltet

Das ermöglicht:
- ✓ Mehrere FritzBoxen mit unterschiedlichen Passwörtern
- ✓ Mehrere Proxmox-Server mit unterschiedlichen Tokens
- ✓ Sichere Verwaltung ohne Credentials in Konfigdateien
- ✓ Einfache Updates ohne Konfiganpassungen

## Troubleshooting

### PostgreSQL Fehler

```
✗ Datenbankverbindung fehlgeschlagen
```

**Lösung:**
```bash
# PostgreSQL Status prüfen
sudo systemctl status postgresql

# PostgreSQL starten
sudo systemctl start postgresql

# PostgreSQL log anschauen
sudo journalctl -u postgresql -n 50
```

### Node.js Version zu alt

```
✗ Node.js >= 18 erforderlich, hast: v16.x.x
```

**Lösung:**
```bash
# Node.js Update
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Port bereits belegt

```
Error: listen EADDRINUSE :::3000
```

**Lösung:**
```bash
# Andere Anwendung auf Port 3000?
lsof -i :3000

# Port in .env ändern
PORT=8080
npm start
```

### npm Fehler

```
npm ERR! ERR! code EACCES
npm ERR! permission denied
```

**Lösung:**
```bash
# npm Cache leeren
npm cache clean --force

# Dependencies neu installieren
rm -rf node_modules package-lock.json
npm install
```

### Systemd Service startet nicht

```bash
# Status anschauen
sudo systemctl status netcatalog

# Logs anschauen
journalctl -u netcatalog -n 100

# Manuell starten zum Debuggen
npm start
```

## Upgrade

Um NetCatalog später zu aktualisieren:

```bash
# Repository updaten
git pull origin main

# Dependencies aktualisieren
npm install
cd frontend && npm install && cd ..

# Frontend rebuilden
npm run build:frontend

# Neu starten
npm start
# oder
sudo systemctl restart netcatalog
```

## Deinstallation

```bash
# Systemd Service entfernen
sudo systemctl stop netcatalog
sudo systemctl disable netcatalog
sudo rm /etc/systemd/system/netcatalog.service
sudo systemctl daemon-reload

# Datenbank entfernen
sudo -u postgres dropdb netcatalog
sudo -u postgres dropuser netcatalog

# Anwendung entfernen
rm -rf /opt/netcatalog
```

## Sicherheits-Best-Practices

### Nach Installation

1. **Firewall konfigurieren**
   ```bash
   # Nur localhost erlauben
   sudo ufw allow from 127.0.0.1 to any port 3000
   
   # Oder spezifisches Netzwerk
   sudo ufw allow from 192.168.1.0/24 to any port 3000
   ```

2. **Reverse Proxy (empfohlen)**
   ```bash
   # Nginx installieren
   sudo apt-get install nginx
   
   # Siehe INSTALLATION_GUIDE.md für Nginx Konfiguration
   ```

3. **HTTPS/SSL aktivieren**
   ```bash
   # Let's Encrypt mit Certbot
   sudo apt-get install certbot python3-certbot-nginx
   sudo certbot certonly --nginx -d example.com
   ```

4. **PostgreSQL sichern**
   ```bash
   # Lokale Auth nur für localhost
   sudo nano /etc/postgresql/*/main/postgresql.conf
   # listen_addresses = 'localhost'
   ```

5. **Regelmäßige Backups**
   ```bash
   # Datenbank backup
   pg_dump netcatalog > backup-$(date +%Y%m%d).sql
   ```

## Support & Dokumentation

- **Schnellstart:** [QUICKSTART.md](./QUICKSTART.md)
- **Ausführliche Installation:** [INSTALLATION_GUIDE.md](./INSTALLATION_GUIDE.md)
- **Datenbank-Schema:** [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- **FritzBox Integration:** [FRITZBOX_DEEP_DISCOVERY.md](./FRITZBOX_DEEP_DISCOVERY.md)
- **Projekt-Updates:** [PROJECT_UPDATES.md](./PROJECT_UPDATES.md)

## Fragen?

Schau dir die ausführliche Dokumentation an oder öffne einen Issue auf GitHub:
https://github.com/bmetallica/NetCatalog/issues
