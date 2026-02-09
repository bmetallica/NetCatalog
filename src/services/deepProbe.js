/**
 * Deep Probing Module
 *
 * Uses curl and protocol-specific probes to identify services
 * on any open port. Unlike nmap -sV, this probes EVERY open port
 * with HTTP/HTTPS and falls back to protocol-specific probes.
 */

const { execFile } = require('child_process');
const net = require('net');

/**
 * Run curl against a URL and return headers + body
 * Uses curl -i which includes headers in stdout, then splits them.
 */
function curlFetch(url, timeout = 6) {
  return new Promise((resolve) => {
    const args = [
      '-siL',                          // silent, include headers, follow redirects
      '--max-time', String(timeout),   // total timeout
      '--connect-timeout', '3',        // connection timeout
      '-k',                            // ignore TLS errors
      '-A', 'Mozilla/5.0 (compatible; NetCatalog/2.0)',
      '--max-redirs', '3',
      url,
    ];

    execFile('curl', args, {
      maxBuffer: 512 * 1024,
      timeout: (timeout + 2) * 1000,
    }, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve(null);
        return;
      }
      if (!stdout || stdout.length === 0) {
        resolve(null);
        return;
      }

      // Split headers from body at the blank line after the LAST HTTP header block
      // curl -L shows multiple header blocks for redirects, we want all of them
      const headerEndIdx = stdout.lastIndexOf('\r\n\r\n');
      if (headerEndIdx === -1) {
        resolve(null);
        return;
      }

      const headers = stdout.substring(0, headerEndIdx);
      const body = stdout.substring(headerEndIdx + 4, Math.min(stdout.length, headerEndIdx + 4 + 65536));
      resolve({ body, headers, url });
    });
  });
}

/**
 * Probe a port with HTTP and HTTPS, return the first successful result
 */
async function probeHttpBoth(ip, port) {
  // Try HTTP first (more common), then HTTPS
  let result = await curlFetch(`http://${ip}:${port}/`);

  // Check if we got a valid HTTP response
  if (result && isHttpResponse(result.headers)) {
    result.protocol = 'http';
    return result;
  }

  // Try HTTPS
  result = await curlFetch(`https://${ip}:${port}/`);
  if (result && isHttpResponse(result.headers)) {
    result.protocol = 'https';
    return result;
  }

  return null;
}

/**
 * Check if response headers look like a valid HTTP response
 */
function isHttpResponse(headers) {
  return headers && /^HTTP\/[12]/m.test(headers);
}

/**
 * Parse headers string from curl -D output
 */
function parseHeaders(raw) {
  const result = {
    statusCode: 0,
    server: null,
    contentType: null,
    poweredBy: null,
    setCookies: [],
    location: null,
    all: {},
  };

  if (!raw) return result;

  // Get the LAST HTTP response (after redirects)
  const responses = raw.split(/^HTTP\/[12]/m);
  const last = responses[responses.length - 1] || '';

  // Status code from last response
  const statusMatch = raw.match(/HTTP\/[12][.\d]* (\d+)/g);
  if (statusMatch) {
    const lastStatus = statusMatch[statusMatch.length - 1];
    result.statusCode = parseInt(lastStatus.match(/(\d+)$/)[1]);
  }

  const lines = last.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    result.all[key] = value;

    switch (key) {
      case 'server': result.server = value; break;
      case 'content-type': result.contentType = value; break;
      case 'x-powered-by': result.poweredBy = value; break;
      case 'set-cookie': result.setCookies.push(value); break;
      case 'location': result.location = value; break;
    }
  }

  return result;
}

/**
 * Extract useful information from HTML body
 */
function parseHtmlBody(body) {
  if (!body) return {};

  const result = {};

  // Title
  const titleMatch = body.match(/<title[^>]*>([^<]{0,500})<\/title>/i);
  if (titleMatch) result.title = titleMatch[1].trim();

  // Meta generator
  const genMatch = body.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i);
  if (genMatch) result.generator = genMatch[1];

  // Meta description
  const descMatch = body.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{0,200})["']/i);
  if (descMatch) result.description = descMatch[1];

  // Common framework indicators in body
  const bodyLower = body.toLowerCase();

  // Extract keywords from script srcs, CSS, specific HTML patterns
  const scriptSrcs = [...body.matchAll(/src=["']([^"']{0,200})["']/gi)].map(m => m[1]);
  const linkHrefs = [...body.matchAll(/href=["']([^"']{0,200})["']/gi)].map(m => m[1]);

  result.scripts = scriptSrcs;
  result.links = linkHrefs;

  // Detect specific patterns in body
  const patterns = [];
  if (bodyLower.includes('proxmox')) patterns.push('proxmox');
  if (bodyLower.includes('nginx proxy manager') || bodyLower.includes('nginx-proxy-manager')) patterns.push('nginx-proxy-manager');
  if (bodyLower.includes('synology')) patterns.push('synology');
  if (bodyLower.includes('pfsense') || bodyLower.includes('pf.conf')) patterns.push('pfsense');
  if (bodyLower.includes('opnsense')) patterns.push('opnsense');
  if (bodyLower.includes('pi-hole') || bodyLower.includes('pihole')) patterns.push('pihole');
  if (bodyLower.includes('adguard')) patterns.push('adguard');
  if (bodyLower.includes('home assistant') || bodyLower.includes('home-assistant')) patterns.push('homeassistant');
  if (bodyLower.includes('grafana')) patterns.push('grafana');
  if (bodyLower.includes('portainer')) patterns.push('portainer');
  if (bodyLower.includes('nextcloud')) patterns.push('nextcloud');
  if (bodyLower.includes('jellyfin')) patterns.push('jellyfin');
  if (bodyLower.includes('emby')) patterns.push('emby');
  if (bodyLower.includes('plex')) patterns.push('plex');
  if (bodyLower.includes('gitea')) patterns.push('gitea');
  if (bodyLower.includes('gitlab')) patterns.push('gitlab');
  if (bodyLower.includes('jenkins')) patterns.push('jenkins');
  if (bodyLower.includes('cockpit')) patterns.push('cockpit');
  if (bodyLower.includes('webmin')) patterns.push('webmin');
  if (bodyLower.includes('openmediavault')) patterns.push('openmediavault');
  if (bodyLower.includes('truenas') || bodyLower.includes('freenas')) patterns.push('truenas');
  if (bodyLower.includes('unraid')) patterns.push('unraid');
  if (bodyLower.includes('qnap') || bodyLower.includes('qts')) patterns.push('qnap');
  if (bodyLower.includes('node-red') || bodyLower.includes('node red')) patterns.push('nodered');
  if (bodyLower.includes('uptime-kuma') || bodyLower.includes('uptime kuma')) patterns.push('uptimekuma');
  if (bodyLower.includes('vaultwarden') || bodyLower.includes('bitwarden')) patterns.push('vaultwarden');
  if (bodyLower.includes('sonarr')) patterns.push('sonarr');
  if (bodyLower.includes('radarr')) patterns.push('radarr');
  if (bodyLower.includes('prowlarr')) patterns.push('prowlarr');
  if (bodyLower.includes('bazarr')) patterns.push('bazarr');
  if (bodyLower.includes('lidarr')) patterns.push('lidarr');
  if (bodyLower.includes('transmission')) patterns.push('transmission');
  if (bodyLower.includes('qbittorrent')) patterns.push('qbittorrent');
  if (bodyLower.includes('deluge')) patterns.push('deluge');
  if (bodyLower.includes('sabnzbd')) patterns.push('sabnzbd');
  if (bodyLower.includes('paperless')) patterns.push('paperless');
  if (bodyLower.includes('bookstack')) patterns.push('bookstack');
  if (bodyLower.includes('wiki.js') || bodyLower.includes('wikijs')) patterns.push('wikijs');
  if (bodyLower.includes('homer')) patterns.push('homer');
  if (bodyLower.includes('heimdall')) patterns.push('heimdall');
  if (bodyLower.includes('homarr')) patterns.push('homarr');
  if (bodyLower.includes('traefik')) patterns.push('traefik');
  if (bodyLower.includes('caddy')) patterns.push('caddy');
  if (bodyLower.includes('roundcube')) patterns.push('roundcube');
  if (bodyLower.includes('mailcow')) patterns.push('mailcow');
  if (bodyLower.includes('phpmyadmin')) patterns.push('phpmyadmin');
  if (bodyLower.includes('adminer')) patterns.push('adminer');
  if (bodyLower.includes('pgadmin')) patterns.push('pgadmin');
  if (bodyLower.includes('zabbix')) patterns.push('zabbix');
  if (bodyLower.includes('nagios')) patterns.push('nagios');
  if (bodyLower.includes('checkmk') || bodyLower.includes('check_mk')) patterns.push('checkmk');
  if (bodyLower.includes('netdata')) patterns.push('netdata');
  if (bodyLower.includes('prometheus')) patterns.push('prometheus');
  if (bodyLower.includes('elasticsearch') || bodyLower.includes('kibana')) patterns.push('elastic');
  if (bodyLower.includes('rancher')) patterns.push('rancher');
  if (bodyLower.includes('kubernetes') || bodyLower.includes('k8s')) patterns.push('kubernetes');
  if (bodyLower.includes('openwrt') || bodyLower.includes('luci')) patterns.push('openwrt');
  if (bodyLower.includes('mikrotik') || bodyLower.includes('routeros')) patterns.push('mikrotik');
  if (bodyLower.includes('unifi')) patterns.push('unifi');
  if (bodyLower.includes('frigate')) patterns.push('frigate');
  if (bodyLower.includes('zoneminder')) patterns.push('zoneminder');
  if (bodyLower.includes('owncloud')) patterns.push('owncloud');
  if (bodyLower.includes('seafile')) patterns.push('seafile');
  if (bodyLower.includes('minio')) patterns.push('minio');
  if (bodyLower.includes('authentik')) patterns.push('authentik');
  if (bodyLower.includes('keycloak')) patterns.push('keycloak');
  if (bodyLower.includes('authelia')) patterns.push('authelia');
  if (bodyLower.includes('guacamole')) patterns.push('guacamole');
  if (bodyLower.includes('esphome')) patterns.push('esphome');
  if (bodyLower.includes('zigbee2mqtt')) patterns.push('zigbee2mqtt');
  if (bodyLower.includes('mosquitto')) patterns.push('mosquitto');
  if (bodyLower.includes('duplicati')) patterns.push('duplicati');
  if (bodyLower.includes('restic')) patterns.push('restic');
  if (bodyLower.includes('borg')) patterns.push('borg');
  if (bodyLower.includes('dozzle')) patterns.push('dozzle');
  if (bodyLower.includes('yacht')) patterns.push('yacht');
  if (bodyLower.includes('filebrowser')) patterns.push('filebrowser');
  if (bodyLower.includes('codeserver') || bodyLower.includes('code-server')) patterns.push('codeserver');
  if (bodyLower.includes('pterodactyl')) patterns.push('pterodactyl');
  if (bodyLower.includes('octoprint')) patterns.push('octoprint');
  if (bodyLower.includes('mainsail')) patterns.push('mainsail');

  result.patterns = patterns;

  return result;
}

/**
 * Probe known application-specific endpoints
 * Returns the app name if a known endpoint responds correctly
 */
async function probeAppEndpoints(ip, port, protocol) {
  const base = `${protocol}://${ip}:${port}`;

  // Each entry: [path, expectedPattern, appName]
  const endpoints = [
    // Proxmox
    ['/api2/json', '"data"', 'Proxmox VE'],
    ['/api2/json/version', 'pveversion', 'Proxmox VE'],
    // Nginx Proxy Manager
    ['/api/', 'nginx-proxy-manager', 'Nginx Proxy Manager'],
    ['/api/schema', 'nginx-proxy-manager', 'Nginx Proxy Manager'],
    // Home Assistant
    ['/api/', 'API running', 'Home Assistant'],
    ['/auth/authorize', 'home-assistant', 'Home Assistant'],
    // Portainer
    ['/api/status', '"Version"', 'Portainer'],
    ['/api/system/status', 'Version', 'Portainer'],
    // Grafana
    ['/api/health', '"database"', 'Grafana'],
    ['/login', 'grafana', 'Grafana'],
    // Nextcloud
    ['/status.php', '"installed"', 'Nextcloud'],
    ['/login', 'nextcloud', 'Nextcloud'],
    // GitLab
    ['/-/health', 'GitLab OK', 'GitLab'],
    // Gitea
    ['/api/v1/version', '"version"', 'Gitea'],
    ['/user/login', 'gitea', 'Gitea'],
    // Synology
    ['/webman/info.cgi', 'Synology', 'Synology DSM'],
    // QNAP
    ['/cgi-bin/login.html', 'qnap', 'QNAP QTS'],
    // Pi-hole
    ['/admin/', 'pi-hole', 'Pi-hole'],
    ['/admin/api.php', '"status"', 'Pi-hole'],
    // AdGuard Home
    ['/control/status', '"protection_enabled"', 'AdGuard Home'],
    // Vaultwarden / Bitwarden
    ['/identity', 'bitwarden', 'Vaultwarden'],
    ['/#/login', 'vaultwarden', 'Vaultwarden'],
    // Jellyfin
    ['/System/Info/Public', '"ServerName"', 'Jellyfin'],
    // Emby
    ['/emby/System/Info/Public', '"ServerName"', 'Emby'],
    // Plex
    ['/identity', 'MediaContainer', 'Plex Media Server'],
    // TrueNAS
    ['/api/v2.0/system/info', '"version"', 'TrueNAS'],
    // Unraid
    ['/login', 'unraid', 'Unraid'],
    // OpenMediaVault
    ['/rpc.php', 'openmediavault', 'OpenMediaVault'],
    // pfSense
    ['/xmlrpc.php', 'pfsense', 'pfSense'],
    // OPNsense
    ['/api/core/firmware/status', '"product"', 'OPNsense'],
    // Cockpit
    ['/cockpit/login', 'cockpit-ws', 'Cockpit'],
    // Node-RED
    ['/flows', '"flows"', 'Node-RED'],
    // Sonarr
    ['/api/v3/system/status', '"appName"', 'Sonarr'],
    // Radarr
    ['/api/v3/system/status', '"appName"', 'Radarr'],
    // Prowlarr
    ['/api/v1/system/status', '"appName"', 'Prowlarr'],
    // Uptime Kuma
    ['/api/status-page/heartbeat', 'heartbeat', 'Uptime Kuma'],
    // Prometheus
    ['/api/v1/status/runtimeinfo', '"status"', 'Prometheus'],
    // Docker Registry
    ['/v2/', 'registry', 'Docker Registry'],
    // Consul
    ['/v1/agent/self', '"Config"', 'Consul'],
    // Netdata
    ['/api/v1/info', '"version"', 'Netdata'],
    // RabbitMQ
    ['/api/overview', '"rabbitmq_version"', 'RabbitMQ Management'],
    // Elasticsearch
    ['/', '"cluster_name"', 'Elasticsearch'],
    // CouchDB
    ['/', '"couchdb"', 'CouchDB'],
    // Webmin
    ['/session_login.cgi', 'webmin', 'Webmin'],
    // Traefik
    ['/api/rawdata', '"routers"', 'Traefik'],
    // MikroTik
    ['/webfig/', 'mikrotik', 'MikroTik RouterOS'],
    // ESPHome
    ['/logs', 'esphome', 'ESPHome'],
    // Zigbee2MQTT
    ['/api', 'zigbee2mqtt', 'Zigbee2MQTT'],
    // Duplicati
    ['/api/v1/serverstate', 'duplicati', 'Duplicati'],
    // Guacamole
    ['/guacamole/', 'guacamole', 'Apache Guacamole'],
    // Authentik
    ['/api/v3/root/config/', '"brand_title"', 'Authentik'],
    // Keycloak
    ['/realms/master', '"realm"', 'Keycloak'],
    // MinIO
    ['/minio/health/live', 'minio', 'MinIO'],
    ['/login', 'minio', 'MinIO'],
  ];

  // Probe in batches of 4 to avoid overwhelming the target
  for (let i = 0; i < endpoints.length; i += 4) {
    const batch = endpoints.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map(([path, pattern, name]) =>
        curlFetch(`${base}${path}`, 4).then((res) => {
          if (!res) return null;
          const bodyLower = (res.body || '').toLowerCase();
          const headersLower = (res.headers || '').toLowerCase();
          // Check if it's a valid response AND matches expected pattern
          // Pattern MUST be non-empty to avoid false positives
          if (isHttpResponse(res.headers) && pattern) {
            if (bodyLower.includes(pattern.toLowerCase())) {
              return name;
            }
          }
          return null;
        })
      )
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        return r.value;
      }
    }
  }

  return null;
}

/**
 * Protocol-specific banner probes for non-HTTP services
 */
function protocolProbe(ip, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let data = Buffer.alloc(0);
    let phase = 'connect';

    socket.setTimeout(timeout);

    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      // Got enough data
      if (data.length >= 1024) {
        socket.destroy();
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
    });

    socket.on('error', () => {
      resolve(null);
    });

    socket.on('close', () => {
      if (data.length === 0) {
        resolve(null);
        return;
      }
      // Strip null bytes and other non-UTF8 characters that break PostgreSQL
      const text = data.toString('utf8', 0, Math.min(data.length, 2048))
        .replace(/\x00/g, '');
      resolve(analyzeBanner(text, port));
    });

    socket.on('connect', () => {
      phase = 'connected';

      // Send protocol-specific probes after brief delay
      setTimeout(() => {
        if (data.length > 0) return; // Already got data

        // SMTP
        if ([25, 465, 587].includes(port)) {
          try { socket.write('EHLO netcatalog.local\r\n'); } catch {}
        }
        // FTP
        else if ([21].includes(port)) {
          // FTP sends banner on connect, just wait
        }
        // HTTP probe as fallback
        else if (data.length === 0) {
          try {
            socket.write(`GET / HTTP/1.0\r\nHost: ${ip}\r\nUser-Agent: NetCatalog/2.0\r\n\r\n`);
          } catch {}
        }
      }, 1500);
    });

    try {
      socket.connect(port, ip);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Analyze a banner string and try to identify the service
 */
function analyzeBanner(banner, port) {
  if (!banner) return null;

  const result = {
    banner: banner.substring(0, 500),
    identified: null,
    product: null,
    version: null,
  };

  const b = banner.toLowerCase();

  // SSH
  if (b.startsWith('ssh-')) {
    result.identified = 'SSH';
    const match = banner.match(/SSH-[\d.]+-(\S+)/);
    if (match) result.product = match[1];
    const verMatch = banner.match(/SSH-[\d.]+-\S+[\s_-](\d[\d.]+)/);
    if (verMatch) result.version = verMatch[1];
  }
  // FTP
  else if (/^\d{3}[ -]/.test(banner) && (b.includes('ftp') || [21].includes(port))) {
    result.identified = 'FTP';
    if (b.includes('vsftpd')) { result.product = 'vsftpd'; }
    else if (b.includes('proftpd')) { result.product = 'ProFTPD'; }
    else if (b.includes('pure-ftpd')) { result.product = 'Pure-FTPd'; }
    else if (b.includes('filezilla')) { result.product = 'FileZilla Server'; }
  }
  // SMTP
  else if (/^\d{3}[ -]/.test(banner) && (b.includes('smtp') || b.includes('esmtp') || b.includes('mail') || [25, 465, 587].includes(port))) {
    result.identified = 'SMTP';
    if (b.includes('postfix')) result.product = 'Postfix';
    else if (b.includes('exim')) result.product = 'Exim';
    else if (b.includes('sendmail')) result.product = 'Sendmail';
    else if (b.includes('exchange')) result.product = 'MS Exchange';
  }
  // IMAP
  else if (b.includes('imap') || [143, 993].includes(port)) {
    result.identified = 'IMAP';
    if (b.includes('dovecot')) result.product = 'Dovecot';
    else if (b.includes('courier')) result.product = 'Courier';
  }
  // POP3
  else if ((b.startsWith('+ok') || b.startsWith('-err')) && [110, 995].includes(port)) {
    result.identified = 'POP3';
    if (b.includes('dovecot')) result.product = 'Dovecot';
  }
  // MySQL / MariaDB
  else if (b.includes('mysql') || b.includes('mariadb') || (port === 3306 && /[\x00-\x1f]/.test(banner.charAt(0)))) {
    result.identified = 'MySQL/MariaDB';
    const verMatch = banner.match(/([\d]+\.[\d]+\.[\d]+[-\w]*)/);
    if (verMatch) result.version = verMatch[1];
    if (b.includes('mariadb')) result.product = 'MariaDB';
    else result.product = 'MySQL';
  }
  // PostgreSQL
  else if (b.includes('postgresql') || b.includes('postgres')) {
    result.identified = 'PostgreSQL';
  }
  // Redis
  else if (b.includes('redis') || (b.startsWith('-noauth') || b.startsWith('+pong') || b.startsWith('-err'))) {
    result.identified = 'Redis';
    const verMatch = banner.match(/redis_version:([\d.]+)/);
    if (verMatch) result.version = verMatch[1];
  }
  // MongoDB
  else if (b.includes('mongodb') || b.includes('ismaster')) {
    result.identified = 'MongoDB';
  }
  // Memcached
  else if (b.includes('memcached') || port === 11211) {
    result.identified = 'Memcached';
  }
  // MQTT
  else if (port === 1883 || port === 8883) {
    result.identified = 'MQTT Broker';
  }
  // VNC
  else if (b.startsWith('rfb ') || [5900, 5901, 5902].includes(port)) {
    result.identified = 'VNC';
    const verMatch = banner.match(/RFB ([\d.]+)/i);
    if (verMatch) result.version = verMatch[1];
  }
  // RDP
  else if (port === 3389) {
    result.identified = 'RDP';
  }
  // SIP
  else if (b.includes('sip/2.0') || port === 5060) {
    result.identified = 'SIP';
  }
  // LDAP
  else if (port === 389 || port === 636) {
    result.identified = port === 636 ? 'LDAPS' : 'LDAP';
  }
  // HTTP response in banner (service responded to GET)
  else if (b.includes('http/1.') || b.includes('http/2')) {
    // This means it's actually an HTTP service
    result.identified = 'HTTP';
    const serverMatch = banner.match(/[Ss]erver:\s*(.+)/);
    if (serverMatch) result.product = serverMatch[1].trim();
    const titleMatch = banner.match(/<title[^>]*>([^<]{0,200})<\/title>/i);
    if (titleMatch) result.httpTitle = titleMatch[1].trim();
  }

  return result;
}

/**
 * Full deep probe of a single port
 * Tries HTTP/HTTPS first, then protocol-specific probes
 */
async function deepProbePort(ip, port) {
  const result = {
    port,
    httpResult: null,
    httpHeaders: null,
    htmlInfo: null,
    bannerResult: null,
    appEndpointMatch: null,
  };

  // Step 1: Try HTTP/HTTPS probe
  const httpResult = await probeHttpBoth(ip, port);

  if (httpResult) {
    result.httpResult = httpResult;
    result.httpHeaders = parseHeaders(httpResult.headers);
    result.htmlInfo = parseHtmlBody(httpResult.body);

    // Step 2: If we got HTTP but couldn't identify from title alone,
    // try application-specific endpoints
    const title = result.htmlInfo.title || '';
    const patterns = result.htmlInfo.patterns || [];

    // Only probe endpoints if we don't have a clear match from title/body
    if (patterns.length === 0 && !isWellKnownTitle(title)) {
      result.appEndpointMatch = await probeAppEndpoints(
        ip, port, httpResult.protocol
      );
    }
  } else {
    // Step 3: Not HTTP - try protocol-specific banner grab
    result.bannerResult = await protocolProbe(ip, port);
  }

  return result;
}

/**
 * Check if a page title is already well-known enough
 */
function isWellKnownTitle(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  const known = [
    'proxmox', 'synology', 'qnap', 'truenas', 'freenas', 'unraid',
    'pfsense', 'opnsense', 'openwrt', 'mikrotik', 'routeros',
    'home assistant', 'node-red', 'grafana', 'portainer',
    'pi-hole', 'adguard', 'nextcloud', 'jellyfin', 'plex', 'emby',
    'gitea', 'gitlab', 'jenkins', 'cockpit', 'webmin',
    'nginx proxy manager', 'traefik', 'uptime kuma', 'vaultwarden',
    'bitwarden', 'sonarr', 'radarr', 'prowlarr', 'transmission',
    'qbittorrent', 'deluge', 'paperless', 'bookstack', 'wiki.js',
    'homer', 'heimdall', 'homarr', 'rancher', 'kubernetes',
  ];
  return known.some(k => t.includes(k));
}

module.exports = {
  curlFetch,
  probeHttpBoth,
  parseHeaders,
  parseHtmlBody,
  probeAppEndpoints,
  protocolProbe,
  deepProbePort,
};
