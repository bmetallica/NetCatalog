# FritzBox Deep Discovery Modul

## Übersicht

Das FritzBox Deep Discovery Modul erweitert die netcatalog Deep Discovery Funktionen um die Fähigkeit, AVM FritzBox Router zu integrieren und damit verbundene WLAN-Geräte automatisch zu erkennen und zu katalogisieren.

**Ähnlich wie bei der bestehenden Proxmox-Integration:**
- Zugangsdaten können pro FritzBox Host eingetragen werden (Host, Benutzername, Passwort)
- Die Deep Discovery nutzt diese Credentials, um die FritzBox via TR-064 Protocol abzufragen
- Erkannte WLAN-Clients werden automatisch als Kind-Geräte der FritzBox zugeordnet

## Komponenten

### 1. FritzBox Client (`src/services/fritzboxClient.js`)

Standalone-Client für die Kommunikation mit AVM FritzBox via TR-064 Protocol (SOAP/XML-basiert).

**Funktionen:**
- `getWirelessDevices()` - Alle WLAN-verbundenen Geräte mit Signal-Stärke
- `getAllHosts()` - Alle Hosts (wired + wireless) aus der FritzBox Host-Tabelle
- `getDeviceInfo()` - Geräte-Informationen (Modell, Firmware, Serial)
- `testConnection()` - Verbindungstest mit Credentials-Validierung

**Besonderheiten:**
- HTTP Basic Auth für Authentifizierung
- Selbstsignierte Zertifikate werden akzeptiert (typisch für FritzBox)
- XML-Parsing mit xml2js
- Robuste Fehlerbehandlung

### 2. Deep Discovery Integration

Die FritzBox Discovery ist in `src/services/deepDiscovery.js` integriert als `discoverFromFritzBox()`:

```javascript
// In runDeepDiscovery() wird aufgerufen:
discoverFromFritzBox(ipToHost)
```

**Workflow:**
1. Lädt alle FritzBox-Hosts mit Credentials aus der DB (`hostsModel.getFritzBoxHosts()`)
2. Für jede konfigurierte FritzBox:
   - Holt Geräteinfo und speichert als Enrichment-Hint
   - Holt WLAN-Clients und erstellt Parent-Beziehungen
   - Holt alle Hosts und kategorisiert sie als wired/wireless
3. Gibt Hints an `applyHints()` zurück
   - **WLAN-Hints:** confidence 94%
   - **Wired-Hints:** confidence 88%

**Hints-Typen:**
- `fritzbox_device` - Enrichment: Modell, Firmware, Serial
- `fritzbox_wireless` - Beziehung: Gerät → FritzBox (WLAN)
- `fritzbox_wired` - Beziehung: Gerät → FritzBox (verkabelt)
- `fritzbox_client` - Enrichment: Signal-Stärke, Device-Info
- `fritzbox_connection` - Enrichment: Interface-Typ

### 3. Datenbank Schema

Neue Spalten in der `hosts` Tabelle:

```sql
fritzbox_host VARCHAR(255) DEFAULT NULL        -- FritzBox URL (z.B. https://fritz.box)
fritzbox_username VARCHAR(255) DEFAULT NULL    -- Benutzername (standard: "admin")
fritzbox_password TEXT DEFAULT NULL            -- Passwort
```

Automatische Migration: `npm run db:init`

### 4. Host Model (`src/models/hosts.js`)

Neue Funktionen:

```javascript
getFritzBoxHosts()                    // Alle Hosts mit FritzBox-Credentials
updateFritzBoxCredentials(id, creds)  // Speichert Credentials + setzt device_type='gateway'
```

### 5. API Endpoints (`src/routes/api.js`)

**PUT `/hosts/:id/fritzbox`**
```json
{
  "fritzbox_host": "https://fritz.box",
  "fritzbox_username": "admin",
  "fritzbox_password": "..."
}
```

**POST `/fritzbox/test`** - Verbindungstest
```json
{
  "fritzbox_host": "https://fritz.box",
  "fritzbox_username": "admin",
  "fritzbox_password": "..."
}
```

Antwortet mit:
```json
{
  "success": true,
  "modelName": "FRITZ!Box 7590 AX",
  "softwareVersion": "154.07.34",
  "serialNumber": "12345678",
  "device_count": 8,
  "devices": [...]
}
```

**GET `/debug/fritzbox-hosts`** - Debug: Zeigt alle FritzBox-Konfigurationen

### 6. Frontend Integration (`frontend/src/pages/HostDetail.jsx`)

UI-Sektion für FritzBox-Geräte:
- Zeigt sich automatisch bei `device_type = 'gateway'` oder `'router'`
- Drei Input-Felder: Host, Username, Password
- Speichert automatisch bei "blur" (Fokus-Verlust)
- Test-Button überprüft Verbindung und zeigt Device-Info + gefundene WLAN-Geräte

**Frontend API** (`frontend/src/api.js`):
```javascript
updateFritzBoxCredentials(id, credentials)   // PUT
testFritzBoxConnection(credentials)          // POST
```

## Verwendungsbeispiel

### 1. FritzBox identifizieren
Während eines Scans wird die FritzBox als `gateway`, `router` oder `firewall` erkannt.

### 2. Credentials eingeben
Im HostDetail-View der FritzBox:
1. **FritzBox Host/URL** eingeben: `https://fritz.box` oder `https://192.168.178.1`
2. **Benutzername**: Standard ist `admin`
3. **Passwort**: Das Passwort der FritzBox
4. Auf "FritzBox-Verbindung testen" klicken

### 3. Deep Discovery ausführen
Wenn credentials eingespeichert sind und Deep Discovery läuft:
- FritzBox wird abgefragt
- Alle WLAN-Clients werden erkannt
- Automatische Zuordnung: WLAN-Gerät → FritzBox als Eltern-Gerät

### 4. Ergebnisse ansehen
Im **Infrastruktur-Map** oder **Host-Liste**:
- FritzBox wird als Gateway/Router angezeigt
- WLAN-Clients erscheinen als Kind-Geräte
- Verbindungen sind visuell dargestellt
- Enrichment-Daten zeigen Signal-Stärke, Modell, etc.

## Technische Details

### TR-064 Protocol
- **Standard:** UPnP Device Description (Open Mobile Alliance)
- **Transport:** SOAP over HTTP/HTTPS
- **Auth:** HTTP Basic Authentication
- **Services genutzt:**
  - `WLANConfiguration` - WLAN-Konfiguration
  - `DeviceInfo` - Geräte-Informationen
  - `Hosts` - Host/Client-Tabelle

### Sicherheit
- Passwörter werden verschlüsselt in PostgreSQL gespeichert (sollte TLS für Datenbank verwendet werden)
- TR-064 ist lokales Protokoll (LAN-only)
- Selbstsignierte Zertifikate werden akzeptiert (notwendig für FritzBox)

### Fehlertoleranz
- Timeouts: 15 Sekunden pro Request
- Verbindungsfehler werden geloggt, andere Discovery-Methoden setzen fort
- Ungültige Credentials verursachen kein Crash

### Performance
- FritzBox-Abfrage läuft parallel mit anderen Discovery-Methoden
- Keine Polling/Warteschleifen - nur einzelne Request pro FritzBox
- Typiusch: 1-3 Sekunden pro FritzBox

## Logs

Im syslog/journal:
```
[DeepDiscovery] FritzBox: Abfrage von X FritzBox(en)...
[DeepDiscovery] FritzBox 192.168.178.1: FRITZ!Box 7590 AX (154.07.34)
[DeepDiscovery] FritzBox 192.168.178.1: 12 WLAN-Clients gefunden
[DeepDiscovery] Zuordnung: 192.168.100.50 → 192.168.178.1 (fritzbox_wireless, 94%)
```

## Erweiterungsmöglichkeiten

1. **QoS/Traffic-Daten** - FritzBox kann auch aktuelle Bandbreite/Traffic liefern
2. **Telecom-Integration** - DSL/Internet-Status auslesen
3. **Port-Forwarding** - Automatische Analyse von Port-Mappings
4. **DECT-Handsets** - DECT-Telefone als Geräte erkennen
5. **Smart Home Devices** - FRITZDECT-Integration
6. **Mehrere WLAN-Netze** - Nicht nur 2.4GHz, auch 5GHz/6GHz

## Testing

```bash
# Service starten
systemctl restart netcatalog

# Logs ansehen
journalctl -u netcatalog -f

# Deep Discovery manuell starten
curl -X POST http://localhost:3000/api/discovery/run

# Debug: Alle FritzBox-Konfigurationen anzeigen
curl http://localhost:3000/api/debug/fritzbox-hosts

# Frontend Test
# -> HostDetail für einen Gateway/Router öffnen
# -> FritzBox Host/Username/Password eingeben
# -> "FritzBox-Verbindung testen" drücken
```

## Vergleich mit Proxmox-Integration

| Feature | Proxmox | FritzBox |
|---------|---------|----------|
| Gerättyp | Hypervisor | Gateway/Router |
| Protokoll | Proxmox API | TR-064 (UPnP/SOAP) |
| Auth | Token (id + secret) | Basic Auth |
| Erkannte Beziehung | VM → Hypervisor (MAC-Match) | WLAN-Client → FritzBox |
| Confidence | 98% | 94% (WLAN), 88% (wired) |
| Discovery-Funktion | `discoverFromProxmox()` | `discoverFromFritzBox()` |
| DB-Spalten | 3 (host, token_id, token_secret) | 3 (host, username, password) |
| Konfiguration | In HostDetail bei hypervisor | In HostDetail bei gateway/router |
| Test-Endpoint | `/proxmox/test` | `/fritzbox/test` |

## Fehlerbehebung

### "Verbindung fehlgeschlagen"
- URL prüfen: `https://fritz.box` oder IP-Adresse?
- FritzBox erreichbar? `ping fritz.box`
- Benutzername/Passwort korrekt?
- FritzBox-Weboberfläche funktioniert?
- Firewall blockiert SOAP-Requests?

### "Keine WLAN-Clients gefunden"
- WLAN eingeschaltet?
- Clients sind wirklich connected?
- `https://fritz.box` → Heimnetzwerk → WLAN-Geräte - können alle angezeigt?

### Logs geben wenig Information
- Restart: `systemctl restart netcatalog`
- Logs: `journalctl -u netcatalog -f`
- Test einzeln: `curl -X POST http://localhost:3000/api/fritzbox/test -H "Content-Type: application/json" -d '{...}'`

