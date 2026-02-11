# NetCatalog - Quick Start Guide

**Schneller Einstieg in 10 Minuten** ⚡

---

## 📋 Voraussetzungen erfüllt?

```bash
# Prüfen Sie folgende Befehle:
node --version          # >= 18 ✓
psql --version         # >= 13 ✓
which nmap             # installiert ✓
which curl             # installiert ✓
```

Falls etwas fehlt → [INSTALLATION_GUIDE.md](./INSTALLATION_GUIDE.md)

---

## 🚀 Los geht's!

### 1️⃣ Repository & Dependencies (1 Min)

```bash
cd /opt/netcatalog
npm run install:all
```

### 2️⃣ .env konfigurieren (1 Min)

```bash
cat > .env <<'EOF'
DB_HOST=localhost
DB_PORT=5432
DB_NAME=netcatalog
DB_USER=netcatalog
DB_PASSWORD=netcatalog2026
SCAN_NETWORK=192.168.66.0/24
PORT=3000
EOF
chmod 600 .env
```

✏️ **Anpassen:** `SCAN_NETWORK` zu Ihrem Netzwerk!

### 3️⃣ Datenbank vorbereiten (2 Min)

```bash
# PostgreSQL User & DB erstellen
sudo -u postgres psql <<'EOF'
CREATE USER netcatalog WITH PASSWORD 'netcatalog2026';
CREATE DATABASE netcatalog OWNER netcatalog;
\c netcatalog
CREATE EXTENSION IF NOT EXISTS "inet";
EOF

# Schema initialisieren
npm run db:init
```

### 4️⃣ Frontend bauen (2 Min)

```bash
npm run build:frontend
```

### 5️⃣ Service starten (1 Min)

```bash
npm start
```

✅ **Output sollte zeigen:**
```
[Server] Server running on port 3000
[Scheduler] Scheduled scans every 30 minutes
[Scheduler] Scheduled Deep Discovery every 60 minutes
```

### 6️⃣ Dashboard öffnen (Browser)

```
http://localhost:3000
```

---

## 🔍 Ersten Scan durchführen

1. Dashboard öffnet sich
2. **"Scan starten"** Button oben rechts
3. Warte auf Scan-Ende (einige Minuten)
4. Hosts erscheinen in der Liste

---

## 🗺️ InfrastrukturMAP erkunden

1. **Dashboard** → **InfrastrukturMAP** Tab
2. Interaktive Topologie-Visualisierung
3. Zoom mit Mousewheel, Drag zum Verschieben
4. Node klicken für Details

---

## 🔐 FritzBox hinzufügen (Optional)

1. InfrastrukturMAP → FritzBox-Host anklicken
2. **FritzBox Credentials** Sektion
3. Eintragen:
   - **Host:** `http://192.168.66.91`
   - **Username:** `admin`
   - **Password:** (Ihr Passwort)
4. **Test Connection** klicken
5. ✅ WLAN-Geräte werden automatisch erkannt!

---

## ⚙️ Settings anpassen

**Dashboard → Settings:**

| Setting | Wert | Was? |
|---------|------|------|
| Scan-Netzwerk | `192.168.66.0/24` | Ihr Netzwerk |
| Scan-Intervall | `30` | Minuten zwischen Scans |
| Port-Range | `1-10000` | Schneller: `1-1000` |
| Deep Discovery | `enabled` | Topologie-Analyse |

---

## 🛑 Probleme?

### Dashboard lädt nicht
```bash
# Service läuft?
curl http://localhost:3000

# Logs ansehen
npm start    # oder: journalctl -u netcatalog -f
```

### Keine Hosts gefunden
```bash
# Netzwerk korrekt?
ping 192.168.66.1

# Nmap funktioniert?
sudo nmap -sn 192.168.66.0/24
```

### FritzBox-Verbindung fehlgeschlagen
```bash
# Passwort korrekt?
curl -k --anyauth -u "admin:password" \
  "http://192.168.66.91:49000/MediaServerDevDesc.xml"
```

**Mehr Hilfe:** [INSTALLATION_GUIDE.md - Troubleshooting](./INSTALLATION_GUIDE.md#troubleshooting)

---

## 📚 Weitere Dokumentation

| Dokument | Für Wen? | Inhalt |
|----------|----------|--------|
| [README.md](./README.md) | Alle | Features, API, Sicherheit |
| [INSTALLATION_GUIDE.md](./INSTALLATION_GUIDE.md) | Admin | Detaillierte Installation |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | Entwickler | DB-Struktur, Queries |
| [FRITZBOX_DEEP_DISCOVERY.md](./FRITZBOX_DEEP_DISCOVERY.md) | Advanced | FritzBox-Integration |
| [PROJECT_UPDATES.md](./PROJECT_UPDATES.md) | Manager | Features, Status |

---

## 🎓 Nächste Schritte

- [ ] Scan-Netzwerk konfigurieren
- [ ] Ersten Scan durchführen
- [ ] InfrastrukturMAP erkunden
- [ ] FritzBox/Proxmox hinzufügen (optional)
- [ ] SNMP konfigurieren (optional)
- [ ] Production-Setup (Systemd, Nginx)
- [ ] Backups einrichten

---

## 💡 Pro-Tipps

**Schnelle API-Calls:**
```bash
# Alle Hosts
curl http://localhost:3000/api/hosts | jq

# Spezifischer Host
curl http://localhost:3000/api/hosts/1

# Services eines Hosts
curl http://localhost:3000/api/hosts/1/services | jq

# Scan starten
curl -X POST http://localhost:3000/api/scan

# Topologie
curl http://localhost:3000/api/topology | jq '.hosts | length'
```

**Dark Mode:** Wird automatisch aktiviert (basierend auf OS-Einstellungen)

**Responsive Design:** Funktioniert auf Desktop, Tablet, Handy

---

## 🎉 Congratulations!

Sie haben NetCatalog erfolgreich gestartet! 🚀

Nun können Sie:
- ✅ Ihr Netzwerk scannen
- ✅ Geräte und Services inventarisieren
- ✅ Topologie-Beziehungen erkennen
- ✅ WLAN-Geräte von FritzBox erfassen
- ✅ Verfügbarkeit tracken
- ✅ Alles im schönen Dashboard verwalten

**Viel Erfolg mit NetCatalog!** 🎊

---

**Probleme?** → Schreiben Sie ein [GitHub Issue](https://github.com/bmetallica/NetCatalog/issues)

**Feedback?** → [Diskussionen](https://github.com/bmetallica/NetCatalog/discussions)
