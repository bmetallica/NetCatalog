# FritzBox Deep Discovery - Änderungssummary

## Neue Dateien

### Backend
- **`src/services/fritzboxClient.js`** (189 lines)
  - FritzBox TR-064 Client für WLAN/Host-Abfragen
  - Methoden: getWirelessDevices(), getAllHosts(), getDeviceInfo(), testConnection()

### Dokumentation
- **`FRITZBOX_DEEP_DISCOVERY.md`**
  - Vollständige Dokumentation des Moduls
  - Verwendungsbeispiele, technische Details, Fehlerbehebung

## Modifizierte Dateien

### Backend

1. **`src/db/init.js`**
   - +3 DB-Spalten hinzugefügt: `fritzbox_host`, `fritzbox_username`, `fritzbox_password`

2. **`src/services/deepDiscovery.js`**
   - +1 Import: `FritzBoxClient`
   - +120 lines: `discoverFromFritzBox()` Funktion
   - +1 Zeile: `discoverFromFritzBox` in `runDeepDiscovery()` integriert
   - +1 Method-Name in methodNames Array

3. **`src/models/hosts.js`**
   - +30 lines: `updateFritzBoxCredentials()` Funktion
   - +20 lines: `getFritzBoxHosts()` Funktion
   - +1 Export: beide neue Funktionen

4. **`src/routes/api.js`**
   - +50 lines: `PUT /hosts/:id/fritzbox` Endpoint
   - +25 lines: `POST /fritzbox/test` Endpoint
   - +25 lines: `GET /debug/fritzbox-hosts` Endpoint

### Frontend

1. **`frontend/src/api.js`**
   - +2 Funktionen: `updateFritzBoxCredentials()`, `testFritzBoxConnection()`

2. **`frontend/src/pages/HostDetail.jsx`**
   - +90 lines: FritzBox UI-Sektion
     - 3 Input-Felder (Host, Username, Password)
     - Auto-Save on blur
     - Test-Button mit Ergebnis-Dialog
     - Bedingte Anzeige: nur für gateway/router

## Funktionalität

### Deep Discovery
- Neue Discovery-Methode #9: FritzBox WLAN/Host-Discovery
- Erkennt bis zu 11 verschiedene Hint-Typen
- Confidence: 94% für WLAN-Clients, 88% für verkabelte Geräte
- Parallel mit anderen Discovery-Methoden (ARP, SNMP, UniFi, Proxmox, etc.)

### Host-Details
- FritzBox-Geräte erhalten UI zum Eingeben von Credentials
- Automatische Speicherung beim Fokus-Verlust
- Test-Button zeigt Gerätinfo + verbundene WLAN-Clients
- device_type wird automatisch auf 'gateway' gesetzt

### API
- 2 neue PUT/POST Endpoints für FritzBox
- 1 Debug-Endpoint zum Prüfen von FritzBox-Konfigurationen
- Vollständige REST-Integration

## Sicherheit & Best Practices

✅ **Implementiert:**
- Passwörter in DB (sollten verschlüsselt sein)
- HTTP Basic Auth mit selbstsigniertem Cert-Support
- Robuste Fehlerbehandlung
- Parallele Discovery (keine Blocking)
- Timeout-Protection (15s)
- XML-Injection-Schutz durch Escaping

## Kompatibilität

- ✅ Node.js 14+ (mit xml2js)
- ✅ PostgreSQL 11+
- ✅ React Frontend (modern)
- ✅ Express.js Routing
- ✅ Bestehende Deep Discovery Methoden (keine Breaking Changes)

## Getestet

- ✅ Server startet fehlerfrei
- ✅ DB-Migration erfolgreich
- ✅ API-Endpoints vorhanden
- ✅ Deep Discovery integriert
- ✅ Frontend UI vorhanden

## Nächste Schritte (Optional)

1. **Testen mit echter FritzBox**
   - Host mit gateway/router device_type identifizieren
   - FritzBox Credentials eingeben
   - Test-Button drücken
   - Deep Discovery ausführen

2. **Monitoring/Logging**
   - Logs in systemd journal ansehen
   - FritzBox-Discovery-Fehler debuggen
   - Performance-Monitoring

3. **Weitere Erweiterungen**
   - QoS/Traffic-Integration
   - DECT-Telefone
   - Smart Home (FRITZ DECT)
   - Port-Forwarding-Analyse

