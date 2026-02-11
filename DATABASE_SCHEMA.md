# NetCatalog - Datenbank-Struktur

Detaillierte Dokumentation aller Tabellen, Spalten und deren Bedeutung.

---

## Übersicht

```
┌──────────────────────┐
│ hosts                │ (Haupttabelle für Netzwerk-Geräte)
│ - 20+ Spalten        │
│ - Inventar           │
│ - Klassifizierung    │
│ - Credentials        │
└──────┬───────────────┘
       │
       ├──→ services           (Ports & Dienste)
       │
       ├──→ host_availability  (24h Verfügbarkeits-Tracking)
       │
       └──→ hosts (self-ref)   (Parent-Child Topologie)

settings (Globale Konfiguration)
scans    (Scan-Historie)
```

---

## Tabellen-Details

### 1. **hosts** (Haupttabelle)

```sql
CREATE TABLE hosts (
  id SERIAL PRIMARY KEY,
  ip_address INET NOT NULL UNIQUE,
  hostname VARCHAR(255),
  mac_address VARCHAR(17),
  vendor VARCHAR(255),
  os_guess VARCHAR(255),
  status VARCHAR(20) DEFAULT 'up',
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Topologie
  device_type VARCHAR(50) DEFAULT NULL,
  parent_host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  discovery_info JSONB DEFAULT NULL,
  
  -- Proxmox Integration
  proxmox_api_host VARCHAR(255),
  proxmox_api_token_id VARCHAR(255),
  proxmox_api_token_secret TEXT,
  
  -- FritzBox Integration
  fritzbox_host VARCHAR(255),
  fritzbox_username VARCHAR(255),
  fritzbox_password TEXT
);
```

#### Spalten-Erklärungen

| Spalte | Typ | Beschreibung | Beispiel |
|--------|-----|-------------|---------|
| `id` | SERIAL | Eindeutige ID | 1 |
| `ip_address` | INET | IPv4/IPv6 Adresse | 192.168.66.91 |
| `hostname` | VARCHAR(255) | DNS-Name (optional) | router.local |
| `mac_address` | VARCHAR(17) | MAC-Adresse | 9C:C7:A6:44:7F:1B |
| `vendor` | VARCHAR(255) | Hersteller (via MAC) | AVM GmbH |
| `os_guess` | VARCHAR(255) | Betriebssystem | Linux 2.6.32 |
| `status` | VARCHAR(20) | 'up' oder 'down' | up |
| `first_seen` | TIMESTAMPTZ | Wann zuerst gesehen | 2026-02-09 10:39:03 |
| `last_seen` | TIMESTAMPTZ | Letzter Kontakt | 2026-02-11 21:44:19 |
| `updated_at` | TIMESTAMPTZ | Letzte Änderung | 2026-02-11 21:06:21 |
| `device_type` | VARCHAR(50) | Typ: router, gateway, vm, device, etc. | router |
| `parent_host_id` | INTEGER | ID des Parent-Geräts (für Topologie) | 7 |
| `discovery_info` | JSONB | Angereicherte Discovery-Daten | (siehe unten) |
| `proxmox_api_host` | VARCHAR(255) | Proxmox API URL | https://pve.local:8006 |
| `proxmox_api_token_id` | VARCHAR(255) | Proxmox Token ID | user@pam!tokenid |
| `proxmox_api_token_secret` | TEXT | Proxmox Token Secret | xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx |
| `fritzbox_host` | VARCHAR(255) | FritzBox URL | http://192.168.66.91 |
| `fritzbox_username` | VARCHAR(255) | FritzBox Username | admin |
| `fritzbox_password` | TEXT | FritzBox Passwort | xxxxxxxx |

#### discovery_info JSONB Struktur

Beispiel für einen Host mit FritzBox WLAN-Discovery:

```json
{
  "mac": "82:aa:ea:85:49:3b",
  "speed": 103,
  "_createdAt": "2026-02-11T22:08:36.728Z",
  "_createdBy": "fritzbox_discovery",
  "fritzboxIp": "192.168.66.91",
  "isWireless": true,
  "signalStrength": 71,
  "fritzboxHostname": null,
  "ttl": {
    "ttl": 64,
    "hops": 0,
    "osGuess": "Linux/macOS"
  },
  "ssdp": {
    "st": "upnp:rootdevice",
    "server": "FRITZ!Box 7330 UPnP/1.0 AVM FRITZ!Box 7330",
    "location": "http://192.168.66.91:49000/MediaServerDevDesc.xml"
  },
  "traceroute": {
    "hops": 0,
    "direct": true
  },
  "ping_cluster": {
    "rtt": "0.33",
    "cluster": 0,
    "clusterSize": 52
  },
  "_lastDiscovery": "2026-02-11T21:01:12.165Z"
}
```

#### Indizes

```sql
CREATE INDEX idx_hosts_ip ON hosts(ip_address);           -- Schnelle IP-Lookups
CREATE INDEX idx_hosts_status ON hosts(status);           -- Status-Filter
CREATE INDEX idx_hosts_parent ON hosts(parent_host_id);   -- Topologie-Navigation
CREATE INDEX idx_hosts_device_type ON hosts(device_type); -- Typ-Filter
```

---

### 2. **services** (Port-Inventar)

```sql
CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  port INTEGER NOT NULL,
  protocol VARCHAR(10) DEFAULT 'tcp',
  state VARCHAR(20) DEFAULT 'open',
  service_name VARCHAR(100),
  service_product VARCHAR(255),
  service_version VARCHAR(100),
  service_info TEXT,
  banner TEXT,
  http_title VARCHAR(500),
  http_server VARCHAR(255),
  identified_as VARCHAR(255),
  extra_info JSONB DEFAULT '{}',
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(host_id, port, protocol)
);
```

#### Spalten-Erklärungen

| Spalte | Typ | Beschreibung | Beispiel |
|--------|-----|-------------|---------|
| `id` | SERIAL | Service ID | 691 |
| `host_id` | INTEGER | FK zu hosts | 51 |
| `port` | INTEGER | Port-Nummer | 22 |
| `protocol` | VARCHAR(10) | tcp oder udp | tcp |
| `state` | VARCHAR(20) | open, closed, filtered | open |
| `service_name` | VARCHAR(100) | Service-Name | ssh |
| `service_product` | VARCHAR(255) | Produkt | OpenSSH |
| `service_version` | VARCHAR(100) | Version | 7.4p1 |
| `service_info` | TEXT | Weitere Info | Debian 10+deb9u6 |
| `banner` | TEXT | Raw Banner | SSH-2.0-OpenSSH_7.4 |
| `http_title` | VARCHAR(500) | HTML Title (HTTP) | Admin Panel |
| `http_server` | VARCHAR(255) | HTTP Server Header | Apache/2.4.41 |
| `identified_as` | VARCHAR(255) | Identifikation | SSH |
| `extra_info` | JSONB | Zusätzliche Daten | {"ssl": true} |
| `first_seen` | TIMESTAMPTZ | Zuerst gefunden | 2026-02-09 10:39:03 |
| `last_seen` | TIMESTAMPTZ | Zuletzt gesehen | 2026-02-11 21:44:19 |

#### Indizes

```sql
CREATE INDEX idx_services_host ON services(host_id);              -- Host-Lookup
CREATE INDEX idx_services_port ON services(port);                 -- Port-Suche
CREATE INDEX idx_services_state ON services(state);               -- Open Ports
CREATE INDEX idx_services_last_seen ON services(last_seen);       -- Timing
CREATE INDEX idx_services_host_state ON services(host_id, state); -- Host + State
```

---

### 3. **host_availability** (24h-Tracking)

```sql
CREATE TABLE host_availability (
  id BIGSERIAL PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(10) NOT NULL CHECK (status IN ('up', 'down'))
);
```

#### Spalten-Erklärungen

| Spalte | Typ | Beschreibung | Beispiel |
|--------|-----|-------------|---------|
| `id` | BIGSERIAL | Eindeutige ID | 123456 |
| `host_id` | INTEGER | FK zu hosts | 51 |
| `checked_at` | TIMESTAMPTZ | Zeitpunkt der Prüfung | 2026-02-11 21:44:19 |
| `status` | VARCHAR(10) | 'up' oder 'down' | up |

#### Indizes

```sql
CREATE INDEX idx_availability_host_checked ON host_availability(host_id, checked_at);
CREATE INDEX idx_availability_checked ON host_availability(checked_at);
```

**Beispiel-Query: Uptime berechnen**
```sql
SELECT 
  host_id,
  COUNT(*) FILTER (WHERE status = 'up') * 100.0 / COUNT(*) AS uptime_percent
FROM host_availability
WHERE checked_at >= NOW() - INTERVAL '24 hours'
GROUP BY host_id;
```

---

### 4. **scans** (Scan-Historie)

```sql
CREATE TABLE scans (
  id SERIAL PRIMARY KEY,
  network VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'running',
  hosts_found INTEGER DEFAULT 0,
  services_found INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error TEXT
);
```

#### Spalten-Erklärungen

| Spalte | Typ | Beschreibung | Beispiel |
|--------|-----|-------------|---------|
| `id` | SERIAL | Scan-ID | 123 |
| `network` | VARCHAR(50) | Gescanntes Netzwerk | 192.168.66.0/24 |
| `status` | VARCHAR(20) | running, completed, failed | completed |
| `hosts_found` | INTEGER | Anzahl Hosts | 52 |
| `services_found` | INTEGER | Anzahl Services | 124 |
| `started_at` | TIMESTAMPTZ | Scan-Start | 2026-02-11 20:00:00 |
| `finished_at` | TIMESTAMPTZ | Scan-Ende | 2026-02-11 20:15:00 |
| `error` | TEXT | Fehlermeldung (optional) | null |

#### Indizes

```sql
CREATE INDEX idx_scans_status ON scans(status);
CREATE INDEX idx_scans_started_at ON scans(started_at DESC);
```

---

### 5. **settings** (Konfiguration)

```sql
CREATE TABLE settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Verfügbare Settings

| Key | Wert | Beschreibung |
|-----|------|-------------|
| `scan_network` | 192.168.66.0/24 | Target-Netzwerk |
| `scan_interval` | 30 | Scan-Interval in Minuten |
| `scan_ports` | 1-10000 | Port-Range |
| `scan_enabled` | true/false | Auto-Scanning aktiv? |
| `snmp_community` | public,private | SNMP Community-Strings |
| `deep_discovery_enabled` | true/false | Deep Discovery aktiv? |
| `deep_discovery_interval` | 60 | DD-Interval in Minuten |
| `unifi_url` | https://unifi.local | UniFi Controller URL |
| `unifi_token` | xxxxx | UniFi API Token |

#### Beispiel Queries

```sql
-- Einen Setting abrufen
SELECT value FROM settings WHERE key = 'scan_network';

-- Alle Settings
SELECT * FROM settings ORDER BY key;

-- Setting aktualisieren
UPDATE settings SET value = '10', updated_at = NOW() 
WHERE key = 'scan_interval';
```

---

## Häufige Queries

### Hosts pro Device-Type

```sql
SELECT device_type, COUNT(*) FROM hosts 
GROUP BY device_type 
ORDER BY count DESC;
```

### Topologie visualisieren (Parent-Child)

```sql
SELECT 
  h.id, h.ip_address as ip, h.device_type,
  p.id as parent_id, p.ip_address as parent_ip
FROM hosts h
LEFT JOIN hosts p ON h.parent_host_id = p.id
WHERE h.parent_host_id IS NOT NULL
ORDER BY p.ip_address;
```

### Open Services pro Host

```sql
SELECT 
  h.ip_address,
  COUNT(s.id) as open_services,
  string_agg(s.port::text || '/' || s.protocol, ', ') as ports
FROM hosts h
LEFT JOIN services s ON h.id = s.host_id AND s.state = 'open'
WHERE s.id IS NOT NULL
GROUP BY h.id
ORDER BY open_services DESC;
```

### FritzBox-Kinder (WLAN-Devices)

```sql
SELECT 
  child.ip_address,
  child.discovery_info->'signalStrength' as signal,
  child.discovery_info->'speed' as speed
FROM hosts parent
JOIN hosts child ON child.parent_host_id = parent.id
WHERE parent.ip_address = '192.168.66.91'
AND (child.discovery_info->>'_createdBy' = 'fritzbox_discovery' 
     OR child.device_type = 'device');
```

### VMs auf Hypervisoren (Proxmox)

```sql
SELECT 
  parent.ip_address as hypervisor,
  child.ip_address as vm,
  child.hostname
FROM hosts parent
JOIN hosts child ON child.parent_host_id = parent.id
WHERE parent.device_type = 'hypervisor'
ORDER BY parent.ip_address;
```

### 24h Uptime Statistics

```sql
SELECT 
  h.ip_address,
  ROUND(COUNT(*) FILTER (WHERE ha.status = 'up') * 100.0 / COUNT(*), 2) as uptime_percent,
  COUNT(*) FILTER (WHERE ha.status = 'down') as down_events
FROM hosts h
LEFT JOIN host_availability ha ON h.id = ha.host_id 
  AND ha.checked_at >= NOW() - INTERVAL '24 hours'
WHERE h.status = 'up'
GROUP BY h.id
ORDER BY uptime_percent DESC;
```

---

## Datenbank-Wartung

### Backup erstellen

```bash
# Full dump
PGPASSWORD="your_password" pg_dump \
  -h localhost \
  -U netcatalog \
  -d netcatalog \
  > netcatalog_backup.sql

# Mit Kompression
PGPASSWORD="your_password" pg_dump \
  -h localhost \
  -U netcatalog \
  -d netcatalog \
  -Fc > netcatalog_backup.dump
```

### Daten-Archivierung

```sql
-- Alte Scans löschen (älter als 90 Tage)
DELETE FROM scans 
WHERE finished_at < NOW() - INTERVAL '90 days';

-- Alte Verfügbarkeitsdaten löschen (älter als 30 Tage)
DELETE FROM host_availability 
WHERE checked_at < NOW() - INTERVAL '30 days';

-- Offline-Hosts löschen (älter als 1 Jahr)
DELETE FROM hosts 
WHERE status = 'down' 
AND last_seen < NOW() - INTERVAL '365 days';
```

### Performance-Optimierung

```sql
-- Vacuum & Analyze
VACUUM ANALYZE;

-- Reindex
REINDEX INDEX CONCURRENTLY idx_hosts_ip;
REINDEX INDEX CONCURRENTLY idx_services_last_seen;

-- Tabellengröße prüfen
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Upgrade: Schema-Änderungen

### Neue Spalte hinzufügen

```sql
ALTER TABLE hosts 
ADD COLUMN custom_field VARCHAR(255) DEFAULT NULL;
```

### Existierende Spalte ändern

```sql
-- Kann in Production schwierig sein!
-- Besser: neue Spalte, Migration, alte löschen

ALTER TABLE hosts 
RENAME COLUMN old_name TO new_name;
```

### Migration durchführen

```bash
# 1. Backup vor Änderungen!
npm run db:backup

# 2. DB-Script ausführen
PGPASSWORD="your_password" psql -h localhost -U netcatalog -d netcatalog -f migration.sql

# 3. Anwendung neu starten
sudo systemctl restart netcatalog

# 4. Datenintegrität überprüfen
npm run db:verify
```

---

## Monitoring

### Verbindungspool-Status

```bash
# In der Anwendung
curl http://localhost:3000/api/debug/db-stats

# Direkt in PostgreSQL
SELECT * FROM pg_stat_activity;
```

### Long-Running Queries

```sql
SELECT 
  pid, now() - pg_stat_statements.query_start as duration,
  query
FROM pg_stat_statements
WHERE query_start < NOW() - INTERVAL '5 minutes'
ORDER BY query_start;
```

---

**Letzte Aktualisierung:** Februar 2026
