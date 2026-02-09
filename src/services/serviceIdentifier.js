/**
 * Smart Service Identification Engine v2
 *
 * Uses deep probing (curl, TCP banners, app-specific endpoints) to identify
 * what application runs on each open port. Works in 3 layers:
 *
 * 1. HTTP/HTTPS probe with curl on EVERY port (not just known HTTP ports)
 * 2. Signature matching against title, headers, body patterns, cookies
 * 3. Application-specific endpoint probing for uncertain matches
 * 4. Protocol-specific banner analysis for non-HTTP services
 * 5. Fallback: port-to-service name mapping
 */

const { deepProbePort, parseHeaders, parseHtmlBody } = require('./deepProbe');

// Pattern-to-name mapping: maps body patterns detected in deepProbe.parseHtmlBody()
// to full application names and icons
const PATTERN_MAP = {
  'proxmox':             { name: 'Proxmox VE', icon: 'server' },
  'nginx-proxy-manager': { name: 'Nginx Proxy Manager', icon: 'globe' },
  'synology':            { name: 'Synology DSM', icon: 'hdd' },
  'pfsense':             { name: 'pfSense', icon: 'shield' },
  'opnsense':            { name: 'OPNsense', icon: 'shield' },
  'pihole':              { name: 'Pi-hole', icon: 'shield' },
  'adguard':             { name: 'AdGuard Home', icon: 'shield' },
  'homeassistant':       { name: 'Home Assistant', icon: 'home' },
  'grafana':             { name: 'Grafana', icon: 'chart' },
  'portainer':           { name: 'Portainer', icon: 'docker' },
  'nextcloud':           { name: 'Nextcloud', icon: 'cloud' },
  'jellyfin':            { name: 'Jellyfin', icon: 'film' },
  'emby':                { name: 'Emby', icon: 'film' },
  'plex':                { name: 'Plex Media Server', icon: 'film' },
  'gitea':               { name: 'Gitea', icon: 'git' },
  'gitlab':              { name: 'GitLab', icon: 'git' },
  'jenkins':             { name: 'Jenkins', icon: 'tool' },
  'cockpit':             { name: 'Cockpit Web Console', icon: 'terminal' },
  'webmin':              { name: 'Webmin', icon: 'settings' },
  'openmediavault':      { name: 'OpenMediaVault', icon: 'hdd' },
  'truenas':             { name: 'TrueNAS', icon: 'hdd' },
  'unraid':              { name: 'Unraid', icon: 'hdd' },
  'qnap':                { name: 'QNAP QTS', icon: 'hdd' },
  'nodered':             { name: 'Node-RED', icon: 'flow' },
  'uptimekuma':          { name: 'Uptime Kuma', icon: 'chart' },
  'vaultwarden':         { name: 'Vaultwarden', icon: 'lock' },
  'sonarr':              { name: 'Sonarr', icon: 'download' },
  'radarr':              { name: 'Radarr', icon: 'download' },
  'prowlarr':            { name: 'Prowlarr', icon: 'download' },
  'bazarr':              { name: 'Bazarr', icon: 'download' },
  'lidarr':              { name: 'Lidarr', icon: 'download' },
  'transmission':        { name: 'Transmission', icon: 'download' },
  'qbittorrent':         { name: 'qBittorrent', icon: 'download' },
  'deluge':              { name: 'Deluge', icon: 'download' },
  'sabnzbd':             { name: 'SABnzbd', icon: 'download' },
  'paperless':           { name: 'Paperless-ngx', icon: 'file' },
  'bookstack':           { name: 'BookStack', icon: 'book' },
  'wikijs':              { name: 'Wiki.js', icon: 'book' },
  'homer':               { name: 'Homer Dashboard', icon: 'layout' },
  'heimdall':            { name: 'Heimdall', icon: 'layout' },
  'homarr':              { name: 'Homarr', icon: 'layout' },
  'traefik':             { name: 'Traefik Dashboard', icon: 'globe' },
  'caddy':               { name: 'Caddy', icon: 'globe' },
  'roundcube':           { name: 'Roundcube', icon: 'mail' },
  'mailcow':             { name: 'Mailcow', icon: 'mail' },
  'phpmyadmin':          { name: 'phpMyAdmin', icon: 'database' },
  'adminer':             { name: 'Adminer', icon: 'database' },
  'pgadmin':             { name: 'pgAdmin', icon: 'database' },
  'zabbix':              { name: 'Zabbix', icon: 'chart' },
  'nagios':              { name: 'Nagios', icon: 'chart' },
  'checkmk':             { name: 'Checkmk', icon: 'chart' },
  'netdata':             { name: 'Netdata', icon: 'chart' },
  'prometheus':          { name: 'Prometheus', icon: 'chart' },
  'elastic':             { name: 'Elasticsearch/Kibana', icon: 'database' },
  'rancher':             { name: 'Rancher', icon: 'docker' },
  'kubernetes':          { name: 'Kubernetes Dashboard', icon: 'docker' },
  'openwrt':             { name: 'OpenWrt (LuCI)', icon: 'wifi' },
  'mikrotik':            { name: 'MikroTik RouterOS', icon: 'wifi' },
  'unifi':               { name: 'UniFi Controller', icon: 'wifi' },
  'frigate':             { name: 'Frigate NVR', icon: 'camera' },
  'zoneminder':          { name: 'ZoneMinder', icon: 'camera' },
  'owncloud':            { name: 'ownCloud', icon: 'cloud' },
  'seafile':             { name: 'Seafile', icon: 'cloud' },
  'minio':               { name: 'MinIO', icon: 'cloud' },
  'authentik':           { name: 'Authentik', icon: 'lock' },
  'keycloak':            { name: 'Keycloak', icon: 'lock' },
  'authelia':            { name: 'Authelia', icon: 'lock' },
  'guacamole':           { name: 'Apache Guacamole', icon: 'terminal' },
  'esphome':             { name: 'ESPHome', icon: 'home' },
  'zigbee2mqtt':         { name: 'Zigbee2MQTT', icon: 'home' },
  'mosquitto':           { name: 'Mosquitto MQTT', icon: 'home' },
  'duplicati':           { name: 'Duplicati', icon: 'archive' },
  'restic':              { name: 'Restic', icon: 'archive' },
  'borg':                { name: 'Borg Backup', icon: 'archive' },
  'dozzle':              { name: 'Dozzle', icon: 'docker' },
  'yacht':               { name: 'Yacht', icon: 'docker' },
  'filebrowser':         { name: 'File Browser', icon: 'file' },
  'codeserver':          { name: 'code-server', icon: 'tool' },
  'pterodactyl':         { name: 'Pterodactyl', icon: 'server' },
  'octoprint':           { name: 'OctoPrint', icon: 'tool' },
  'mainsail':            { name: 'Mainsail', icon: 'tool' },
};

// Title-based signatures: regex patterns matched against page title
const TITLE_SIGNATURES = [
  { pattern: /proxmox\s*v/i, name: 'Proxmox VE', icon: 'server' },
  { pattern: /proxmox\s*backup/i, name: 'Proxmox Backup Server', icon: 'server' },
  { pattern: /nginx\s*proxy\s*manager/i, name: 'Nginx Proxy Manager', icon: 'globe' },
  { pattern: /vmware|vsphere|esxi/i, name: 'VMware vSphere', icon: 'server' },
  { pattern: /xen\s*orchestra/i, name: 'Xen Orchestra', icon: 'server' },
  { pattern: /openhab/i, name: 'openHAB', icon: 'home' },
  { pattern: /domoticz/i, name: 'Domoticz', icon: 'home' },
  { pattern: /kodi/i, name: 'Kodi', icon: 'film' },
  { pattern: /drone\s*ci/i, name: 'Drone CI', icon: 'tool' },
  { pattern: /gogs/i, name: 'Gogs', icon: 'git' },
  { pattern: /blue\s*iris/i, name: 'Blue Iris', icon: 'camera' },
  { pattern: /shinobi/i, name: 'Shinobi', icon: 'camera' },
  { pattern: /organizr/i, name: 'Organizr', icon: 'layout' },
  { pattern: /nessus/i, name: 'Nessus', icon: 'shield' },
  { pattern: /apache\s*guacamole|guacamole/i, name: 'Apache Guacamole', icon: 'terminal' },
];

// Server header signatures
const SERVER_SIGNATURES = [
  { pattern: /pve-api-daemon/i, name: 'Proxmox VE', icon: 'server' },
  { pattern: /synology/i, name: 'Synology DSM', icon: 'hdd' },
  { pattern: /unifi/i, name: 'UniFi Controller', icon: 'wifi' },
  { pattern: /jenkins/i, name: 'Jenkins', icon: 'tool' },
  { pattern: /plex/i, name: 'Plex Media Server', icon: 'film' },
  { pattern: /couchdb/i, name: 'CouchDB', icon: 'database' },
  { pattern: /home-assistant/i, name: 'Home Assistant', icon: 'home' },
  { pattern: /microsoft-iis/i, name: 'Microsoft IIS', icon: 'globe' },
];

// Cookie-based identification
const COOKIE_SIGNATURES = [
  { pattern: /PVEAuthCookie/i, name: 'Proxmox VE', icon: 'server' },
  { pattern: /PHPSESSID.*pfsense/i, name: 'pfSense', icon: 'shield' },
  { pattern: /oc_sessionPassphrase/i, name: 'Nextcloud', icon: 'cloud' },
  { pattern: /grafana_session/i, name: 'Grafana', icon: 'chart' },
  { pattern: /portainer/i, name: 'Portainer', icon: 'docker' },
];

// Well-known port assignments for last-resort fallback
const PORT_SERVICES = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  67: 'DHCP Server', 68: 'DHCP Client', 69: 'TFTP', 80: 'HTTP',
  110: 'POP3', 111: 'RPCbind', 123: 'NTP', 135: 'MS-RPC',
  137: 'NetBIOS Name', 138: 'NetBIOS Datagram', 139: 'SMB (NetBIOS)',
  143: 'IMAP', 161: 'SNMP', 162: 'SNMP Trap', 389: 'LDAP',
  443: 'HTTPS', 445: 'SMB/CIFS', 465: 'SMTPS', 514: 'Syslog',
  515: 'LPD Printer', 548: 'AFP', 587: 'SMTP Submission',
  631: 'IPP/CUPS', 636: 'LDAPS', 853: 'DNS over TLS', 873: 'Rsync',
  993: 'IMAPS', 995: 'POP3S', 1080: 'SOCKS Proxy', 1194: 'OpenVPN',
  1433: 'MS SQL Server', 1521: 'Oracle DB', 1883: 'MQTT', 2049: 'NFS',
  2375: 'Docker API', 2376: 'Docker API (TLS)',
  3306: 'MySQL/MariaDB', 3389: 'RDP', 5060: 'SIP',
  5432: 'PostgreSQL', 5672: 'AMQP (RabbitMQ)', 5900: 'VNC',
  5901: 'VNC :1', 6379: 'Redis', 6443: 'Kubernetes API',
  8291: 'MikroTik Winbox', 9100: 'JetDirect Printer',
  11211: 'Memcached', 27017: 'MongoDB', 51820: 'WireGuard',
};

/**
 * Identify a service using deep probing results
 * This is the main intelligence function that combines all signals
 */
async function identifyService(ip, port, nmapService = {}) {
  const result = {
    port,
    protocol: nmapService.protocol || 'tcp',
    name: nmapService.name || '',
    product: nmapService.product || '',
    version: nmapService.version || '',
    info: nmapService.extrainfo || '',
    banner: null,
    httpTitle: null,
    httpServer: null,
    identifiedAs: null,
    extraInfo: {},
  };

  try {
    // Deep probe the port (HTTP/HTTPS + banner + app endpoints)
    const probe = await deepProbePort(ip, port);

    // --- Layer 1: Analyze HTTP response ---
    if (probe.httpResult) {
      const headers = probe.httpHeaders;
      const html = probe.htmlInfo;

      result.httpTitle = html.title || null;
      result.httpServer = headers.server || null;
      result.extraInfo.protocol = probe.httpResult.protocol;
      result.extraInfo.statusCode = headers.statusCode;
      if (headers.poweredBy) result.extraInfo.poweredBy = headers.poweredBy;
      if (html.generator) result.extraInfo.generator = html.generator;

      // --- Layer 2: Title-based signature matching ---
      if (html.title) {
        for (const sig of TITLE_SIGNATURES) {
          if (sig.pattern.test(html.title)) {
            result.identifiedAs = sig.name;
            result.extraInfo.icon = sig.icon;
            result.extraInfo.matchSource = 'title';
            return result;
          }
        }
      }

      // --- Layer 3: Body pattern matching (broadest keyword analysis) ---
      if (html.patterns && html.patterns.length > 0) {
        const patternKey = html.patterns[0];
        const mapped = PATTERN_MAP[patternKey];
        if (mapped) {
          result.identifiedAs = mapped.name;
          result.extraInfo.icon = mapped.icon;
          result.extraInfo.matchSource = 'body-pattern';
          return result;
        }
      }

      // --- Layer 4: Server header matching ---
      if (headers.server) {
        for (const sig of SERVER_SIGNATURES) {
          if (sig.pattern.test(headers.server)) {
            result.identifiedAs = sig.name;
            result.extraInfo.icon = sig.icon;
            result.extraInfo.matchSource = 'server-header';
            return result;
          }
        }
      }

      // --- Layer 5: Cookie-based identification ---
      const allCookies = (headers.setCookies || []).join(' ');
      if (allCookies) {
        for (const sig of COOKIE_SIGNATURES) {
          if (sig.pattern.test(allCookies)) {
            result.identifiedAs = sig.name;
            result.extraInfo.icon = sig.icon;
            result.extraInfo.matchSource = 'cookie';
            return result;
          }
        }
      }

      // --- Layer 6: Application endpoint probing ---
      if (probe.appEndpointMatch) {
        result.identifiedAs = probe.appEndpointMatch;
        result.extraInfo.matchSource = 'endpoint';
        return result;
      }

      // --- Layer 7: Identify generic web server ---
      if (headers.server) {
        const s = headers.server;
        if (/nginx/i.test(s)) {
          result.identifiedAs = html.title ? `Web App (Nginx)` : 'Nginx';
          result.extraInfo.icon = 'globe';
        } else if (/apache/i.test(s)) {
          result.identifiedAs = html.title ? `Web App (Apache)` : 'Apache HTTP Server';
          result.extraInfo.icon = 'globe';
        } else if (/lighttpd/i.test(s)) {
          result.identifiedAs = 'lighttpd';
          result.extraInfo.icon = 'globe';
        } else {
          result.identifiedAs = html.title
            ? `Web App: ${html.title.substring(0, 60)}`
            : `HTTP Service (${s.substring(0, 40)})`;
          result.extraInfo.icon = 'globe';
        }
        result.extraInfo.matchSource = 'http-generic';
        return result;
      }

      // Got an HTTP response but no server header
      if (html.title) {
        result.identifiedAs = `Web App: ${html.title.substring(0, 60)}`;
        result.extraInfo.icon = 'globe';
        result.extraInfo.matchSource = 'http-title-only';
        return result;
      }

      // HTTP response with no useful info
      result.identifiedAs = `HTTP Service (${headers.statusCode || 'unknown'})`;
      result.extraInfo.icon = 'globe';
      result.extraInfo.matchSource = 'http-status';
      return result;
    }

    // --- Layer 8: Non-HTTP banner analysis ---
    if (probe.bannerResult) {
      result.banner = probe.bannerResult.banner;
      if (probe.bannerResult.identified) {
        result.identifiedAs = probe.bannerResult.identified;
        if (probe.bannerResult.product) result.product = probe.bannerResult.product;
        if (probe.bannerResult.version) result.version = probe.bannerResult.version;
        result.extraInfo.matchSource = 'banner';

        // Check if the banner contains an HTTP title (protocol probe sent GET)
        if (probe.bannerResult.httpTitle) {
          result.httpTitle = probe.bannerResult.httpTitle;
        }
        return result;
      }

      // Got a banner but couldn't identify
      if (result.banner) {
        result.identifiedAs = `Unknown (Banner: ${result.banner.substring(0, 50).replace(/[\r\n]/g, ' ')})`;
        result.extraInfo.matchSource = 'unknown-banner';
        return result;
      }
    }

    // --- Layer 9: Fall back to nmap info or port mapping ---
    if (nmapService.product) {
      result.identifiedAs = nmapService.product + (nmapService.version ? ' ' + nmapService.version : '');
      result.extraInfo.matchSource = 'nmap';
    } else if (PORT_SERVICES[port]) {
      result.identifiedAs = PORT_SERVICES[port];
      result.extraInfo.matchSource = 'port-map';
    } else if (nmapService.name) {
      result.identifiedAs = nmapService.name;
      result.extraInfo.matchSource = 'nmap-name';
    } else {
      result.identifiedAs = `Unknown (Port ${port})`;
      result.extraInfo.matchSource = 'unknown';
    }

  } catch (err) {
    console.error(`[ServiceID] Error probing ${ip}:${port}: ${err.message}`);
    // Best-effort fallback
    result.identifiedAs = PORT_SERVICES[port] || nmapService.name || `Unknown (Port ${port})`;
    result.extraInfo.matchSource = 'error-fallback';
  }

  return result;
}

module.exports = { identifyService, PORT_SERVICES, PATTERN_MAP };
