const { execFile } = require('child_process');
const { promisify } = require('util');
const dgram = require('dgram');
const settingsModel = require('../models/settings');
const pool = require('../db/pool');
const unifiClient = require('./unifiClient');
const hostsModel = require('../models/hosts');
const { getVMsFromHost } = require('./proxmoxClient');
const FritzBoxClient = require('./fritzboxClient');

const execFileP = promisify(execFile);

/**
 * Deep Discovery Module
 *
 * Combines multiple techniques to discover network topology:
 * 1. ARP table analysis (L2 neighbor detection)
 * 2. Traceroute (hop detection, router identification)
 * 3. Broadcast ping clustering (L2 segment grouping)
 * 4. SNMP MAC tables (switch port mapping)
 * 5. SNMP LLDP neighbors (physical link discovery)
 * 6. mDNS/Bonjour (service/device enrichment)
 * 7. SSDP/UPnP (device discovery)
 * 8. TTL fingerprinting (hop count estimation)
 * 9. UniFi Controller (WLAN client→AP mapping)
 * 10. Proxmox API (VM→Hypervisor mapping via MAC addresses)
 */

// ============================================================
// Utilities
// ============================================================

async function commandExists(cmd) {
  try {
    await execFileP('which', [cmd], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function safeExec(cmd, args, opts = {}) {
  try {
    const { stdout } = await execFileP(cmd, args, {
      timeout: opts.timeout || 10000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return stdout || '';
  } catch (err) {
    if (opts.ignoreErrors) return err.stdout || '';
    throw err;
  }
}

function ipToNum(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o), 0) >>> 0;
}

function numToIp(num) {
  return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
}

function findHostByMac(ipToHost, mac) {
  const norm = mac.toLowerCase();
  for (const host of ipToHost.values()) {
    if (host.mac_address && host.mac_address.toLowerCase() === norm) return host;
  }
  return null;
}

// ============================================================
// 1. ARP Table Analysis
// ============================================================

async function discoverFromArp(ipToHost) {
  const hints = [];
  try {
    const output = await safeExec('arp', ['-an'], { timeout: 5000 });
    for (const line of output.split('\n')) {
      const m = line.match(/\(([\d.]+)\)\s+at\s+([\da-f:]+)\s+\[(\w+)\]\s+on\s+(\S+)/i);
      if (!m) continue;
      if (ipToHost.has(m[1])) {
        hints.push({
          ip: m[1],
          method: 'arp',
          data: { mac: m[2].toLowerCase(), iface: m[4], l2direct: true },
        });
      }
    }
  } catch (err) {
    console.error('[DeepDiscovery] ARP Fehler:', err.message);
  }
  return hints;
}

// ============================================================
// 2. Traceroute Analysis
// ============================================================

async function discoverFromTraceroute(hosts, ipToHost) {
  const hints = [];
  const has = await commandExists('traceroute');
  if (!has) {
    console.log('[DeepDiscovery] traceroute nicht installiert, überspringe');
    return hints;
  }

  // Sample max 30 hosts
  const targets = hosts.filter(h => h.status === 'up').slice(0, 30);

  const BATCH = 10;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async (host) => {
      try {
        const output = await safeExec('traceroute', [
          '-n', '-m', '5', '-w', '1', '-q', '1', host.ip,
        ], { timeout: 12000, ignoreErrors: true });

        const hops = [];
        for (const line of output.split('\n')) {
          const m = line.match(/^\s*\d+\s+([\d.]+)\s/);
          if (m && m[1] !== host.ip) hops.push(m[1]);
        }

        if (hops.length > 0) {
          const lastHop = hops[hops.length - 1];
          if (ipToHost.has(lastHop)) {
            hints.push({
              childIp: host.ip,
              parentIp: lastHop,
              method: 'traceroute',
              confidence: 85,
              detail: `${hops.length} Hop(s): ${hops.join(' → ')} → ${host.ip}`,
            });
          }
        } else {
          hints.push({
            ip: host.ip,
            method: 'traceroute',
            data: { hops: 0, direct: true },
          });
        }
      } catch {}
    }));
  }

  return hints;
}

// ============================================================
// 3. Broadcast Ping Clustering
// ============================================================

async function discoverFromBroadcastPing(network, ipToHost) {
  const hints = [];

  // Collect RTTs from all up hosts
  const hosts = Array.from(ipToHost.values()).filter(h => h.status === 'up');
  const rttMap = new Map();

  const pingTasks = hosts.map(host => async () => {
    try {
      const output = await safeExec('ping', [
        '-c', '3', '-W', '1', '-i', '0.1', host.ip,
      ], { timeout: 5000, ignoreErrors: true });

      const m = output.match(/rtt min\/avg\/max\/mdev = [\d.]+\/([\d.]+)\//);
      if (m) rttMap.set(host.ip, parseFloat(m[1]));
    } catch {}
  });

  // Run pings in batches of 20
  for (let i = 0; i < pingTasks.length; i += 20) {
    await Promise.allSettled(pingTasks.slice(i, i + 20).map(fn => fn()));
  }

  if (rttMap.size < 3) return hints;

  // Cluster by RTT similarity (>0.5ms gap = new cluster)
  const entries = Array.from(rttMap.entries()).sort((a, b) => a[1] - b[1]);
  const clusters = [];
  let cur = [entries[0]];

  for (let i = 1; i < entries.length; i++) {
    if (entries[i][1] - entries[i - 1][1] > 0.5) {
      clusters.push([...cur]);
      cur = [];
    }
    cur.push(entries[i]);
  }
  if (cur.length > 0) clusters.push(cur);

  for (let ci = 0; ci < clusters.length; ci++) {
    for (const [ip, rtt] of clusters[ci]) {
      hints.push({
        ip,
        method: 'ping_cluster',
        data: { cluster: ci, rtt: rtt.toFixed(2), clusterSize: clusters[ci].length },
      });
    }
  }

  console.log(`[DeepDiscovery] Ping-Clustering: ${clusters.length} Cluster aus ${rttMap.size} Hosts`);
  return hints;
}

// ============================================================
// 4. SNMP Discovery (MAC table + LLDP + device info)
// ============================================================

async function snmpGet(ip, community, oid) {
  try {
    const { stdout } = await execFileP('snmpget', [
      '-v2c', '-c', community, '-t', '2', '-r', '1', '-Oqv', ip, oid,
    ], { timeout: 5000 });
    const val = stdout.trim();
    if (val && !val.includes('No Such') && !val.includes('Timeout')) return val;
    return null;
  } catch {
    return null;
  }
}

async function snmpWalk(ip, community, oid) {
  try {
    const { stdout } = await execFileP('snmpwalk', [
      '-v2c', '-c', community, '-t', '3', '-r', '1',
      '-Oqn',  // quiet, numeric OIDs
      '-Cc',   // tolerate non-increasing OIDs (older switches like HP 1920G)
      ip, oid,
    ], { timeout: 20000 });
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const idx = line.indexOf(' ');
      return { oid: line.substring(0, idx), value: line.substring(idx + 1) };
    });
  } catch {
    return [];
  }
}

async function snmpGetMacTable(ip, community) {
  // Read bridge MIB MAC address table
  const macEntries = await snmpWalk(ip, community, '.1.3.6.1.2.1.17.4.3.1.1');
  const portEntries = await snmpWalk(ip, community, '.1.3.6.1.2.1.17.4.3.1.2');

  // Bridge port → ifIndex mapping
  const portToIfIndex = {};
  const bridgePorts = await snmpWalk(ip, community, '.1.3.6.1.2.1.17.1.4.1.2');
  for (const e of bridgePorts) {
    const port = e.oid.split('.').pop();
    portToIfIndex[port] = e.value.trim();
  }

  // Interface descriptions
  const ifDescrs = await snmpWalk(ip, community, '.1.3.6.1.2.1.2.2.1.2');
  const ifDescrMap = {};
  for (const e of ifDescrs) {
    const idx = e.oid.split('.').pop();
    ifDescrMap[idx] = e.value.replace(/"/g, '').trim();
  }

  const results = [];
  for (let i = 0; i < macEntries.length; i++) {
    // MAC is in OID suffix as 6 decimal bytes
    const macParts = macEntries[i].oid.split('.').slice(-6);
    const mac = macParts.map(b => parseInt(b).toString(16).padStart(2, '0')).join(':');
    const portNum = portEntries[i]?.value?.trim() || '?';
    const ifIdx = portToIfIndex[portNum];
    const ifName = ifIdx ? (ifDescrMap[ifIdx] || '') : '';

    results.push({ mac, port: portNum, ifDescr: ifName });
  }

  return results;
}

async function snmpGetLldp(ip, community) {
  const neighbors = [];

  const sysNames = await snmpWalk(ip, community, '.1.0.8802.1.1.2.1.4.1.1.9');
  const portIds = await snmpWalk(ip, community, '.1.0.8802.1.1.2.1.4.1.1.7');
  const mgmtAddrs = await snmpWalk(ip, community, '.1.0.8802.1.1.2.1.4.2.1.4');

  for (let i = 0; i < sysNames.length; i++) {
    const mgmtRaw = mgmtAddrs[i]?.value || '';
    // LLDP mgmt address can be in dotted decimal in OID
    let mgmtIp = null;
    const ipMatch = mgmtRaw.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch) mgmtIp = ipMatch[1];

    neighbors.push({
      sysName: sysNames[i]?.value?.replace(/"/g, '').trim() || '',
      portId: portIds[i]?.value?.replace(/"/g, '').trim() || '',
      mgmtAddr: mgmtIp,
    });
  }

  return neighbors;
}

/**
 * TP-Link EAP wireless station table (enterprise OID .1.3.6.1.4.1.11863.10.1.1.2.1.2)
 * Returns MACs as hex-encoded ASCII strings that span multiple lines.
 * We parse the raw output by joining continuation lines before splitting.
 */
async function snmpGetTplinkWirelessClients(ip, community) {
  const OID = '.1.3.6.1.4.1.11863.10.1.1.2.1.2';
  try {
    const { stdout } = await execFileP('snmpwalk', [
      '-v2c', '-c', community, '-t', '3', '-r', '1',
      '-Oqn', '-Cc', ip, OID,
    ], { timeout: 10000 });

    // Raw output has multiline hex values. Join continuation lines (lines not starting with .)
    const joined = stdout.replace(/\n([^.])/g, ' $1');
    const macs = [];

    for (const line of joined.split('\n')) {
      if (!line.includes(OID)) continue;
      // Value is hex bytes representing ASCII chars of the MAC address
      // e.g. "36 30 2D 30 31 2D 39 34 2D 39 38 2D 43 38 2D 33 43 00 "
      const hexMatch = line.match(/"([^"]+)"/);
      if (!hexMatch) continue;

      const hexStr = hexMatch[1].trim();
      // Convert hex bytes to ASCII, strip null terminator
      const ascii = hexStr.split(/\s+/)
        .filter(b => b.length === 2 && b !== '00')
        .map(b => String.fromCharCode(parseInt(b, 16)))
        .join('');

      if (!ascii || ascii.length < 11) continue;

      // TP-Link uses dash separators (60-01-94-98-C8-3C), normalize to colon
      const mac = ascii.replace(/-/g, ':').toLowerCase();
      if (/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) {
        macs.push(mac);
      }
    }

    return macs;
  } catch {
    return [];
  }
}

async function discoverFromSnmp(hosts, communities, ipToHost) {
  const hints = [];
  const hasSnmp = await commandExists('snmpwalk');
  if (!hasSnmp) {
    console.log('[DeepDiscovery] snmpwalk nicht installiert, überspringe SNMP');
    return hints;
  }

  // Prioritize infrastructure devices
  const infraTypes = ['switch', 'router', 'gateway', 'ap', 'firewall', 'management'];
  const infraHosts = hosts.filter(h => infraTypes.includes(h.computed_type || h.device_type));

  // Also add hosts with SNMP port open
  const snmpPortHosts = hosts.filter(h => {
    if (infraHosts.find(ih => ih.id === h.id)) return false;
    const svcs = h.services || [];
    return svcs.some(s => s.port === 161);
  });

  let targets = [...infraHosts, ...snmpPortHosts];

  // Fallback: try up to 20 random up hosts
  if (targets.length === 0) {
    targets = hosts.filter(h => h.status === 'up').slice(0, 20);
  }

  console.log(`[DeepDiscovery] SNMP: Prüfe ${targets.length} Ziele mit ${communities.length} Community-Strings`);

  for (const host of targets) {
    for (const community of communities) {
      const sysDescr = await snmpGet(host.ip, community, '1.3.6.1.2.1.1.1.0');
      if (!sysDescr) continue;

      const sysName = await snmpGet(host.ip, community, '1.3.6.1.2.1.1.5.0') || '';
      console.log(`[DeepDiscovery] SNMP aktiv: ${host.ip} (${sysName || sysDescr.substring(0, 50)})`);

      hints.push({
        ip: host.ip,
        method: 'snmp_info',
        data: {
          sysDescr: sysDescr.substring(0, 200),
          sysName: sysName.replace(/"/g, '').trim(),
        },
      });

      // MAC address table → host-to-switch mapping
      const macTable = await snmpGetMacTable(host.ip, community);
      if (macTable.length > 0) {
        console.log(`[DeepDiscovery] SNMP MAC-Tabelle: ${host.ip} → ${macTable.length} Einträge`);

        // Count MACs per port to detect uplink vs edge ports
        const portMacCount = {};
        for (const e of macTable) {
          portMacCount[e.port] = (portMacCount[e.port] || 0) + 1;
        }

        for (const entry of macTable) {
          const child = findHostByMac(ipToHost, entry.mac);
          if (child && child.ip !== host.ip) {
            hints.push({
              childIp: child.ip,
              parentIp: host.ip,
              method: 'snmp_mac_table',
              confidence: 90,
              switchPort: entry.port,
              portMacCount: portMacCount[entry.port] || 1,
              detail: `MAC ${entry.mac} auf Port ${entry.port} (${entry.ifDescr})`,
            });
          }
        }
      }

      // LLDP neighbors
      const lldpNeighbors = await snmpGetLldp(host.ip, community);
      for (const nb of lldpNeighbors) {
        if (nb.mgmtAddr && ipToHost.has(nb.mgmtAddr)) {
          hints.push({
            childIp: nb.mgmtAddr,
            parentIp: host.ip,
            method: 'snmp_lldp',
            confidence: 95,
            detail: `LLDP: ${nb.sysName} auf Port ${nb.portId}`,
          });
        }
        hints.push({
          ip: host.ip,
          method: 'snmp_lldp_neighbor',
          data: nb,
        });
      }

      // TP-Link EAP wireless station table (vendor-specific MIB)
      if (/tp-?link|eap\d/i.test(sysDescr)) {
        const wifiClients = await snmpGetTplinkWirelessClients(host.ip, community);
        if (wifiClients.length > 0) {
          console.log(`[DeepDiscovery] SNMP TP-Link WLAN: ${host.ip} → ${wifiClients.length} Clients`);
          for (const mac of wifiClients) {
            const child = findHostByMac(ipToHost, mac);
            if (child && child.ip !== host.ip) {
              hints.push({
                childIp: child.ip,
                parentIp: host.ip,
                method: 'snmp_tplink_wireless',
                confidence: 93,
                detail: `WLAN-Client ${mac} an TP-Link AP`,
              });
            }
          }
        }
      }

      break; // Community string worked, no need to try others
    }
  }

  return hints;
}

// ============================================================
// 5. mDNS / Bonjour Discovery
// ============================================================

async function discoverFromMdns(ipToHost) {
  const hints = [];
  const has = await commandExists('avahi-browse');
  if (!has) {
    console.log('[DeepDiscovery] avahi-browse nicht installiert, überspringe mDNS');
    return hints;
  }

  try {
    const output = await safeExec('avahi-browse', [
      '-a', '-t', '-r', '-p',
    ], { timeout: 12000, ignoreErrors: true });

    const seen = new Set();
    for (const line of output.split('\n')) {
      if (!line.startsWith('=')) continue;
      const f = line.split(';');
      if (f.length < 9) continue;

      const [, , , name, type, , hostname, address, port] = f;
      if (!address || !address.match(/^\d/)) continue;

      const key = `${address}:${type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      hints.push({
        ip: address,
        method: 'mdns',
        data: {
          name,
          serviceType: type,
          hostname,
          port: parseInt(port) || 0,
        },
      });
    }
  } catch (err) {
    console.error('[DeepDiscovery] mDNS Fehler:', err.message);
  }

  return hints;
}

// ============================================================
// 6. SSDP / UPnP Discovery
// ============================================================

function discoverFromSsdp(ipToHost) {
  return new Promise((resolve) => {
    const hints = [];
    const found = new Map();
    let closed = false;

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = () => {
      if (closed) return;
      closed = true;
      try { socket.close(); } catch {}
      resolve([...found.values()]);
    };

    const timeout = setTimeout(finish, 6000);

    socket.on('message', (msg, rinfo) => {
      const ip = rinfo.address;
      if (found.has(ip)) return;

      const text = msg.toString();
      const server = text.match(/SERVER:\s*(.+)/i)?.[1]?.trim() || '';
      const location = text.match(/LOCATION:\s*(.+)/i)?.[1]?.trim() || '';
      const st = text.match(/ST:\s*(.+)/i)?.[1]?.trim() || '';
      const usn = text.match(/USN:\s*(.+)/i)?.[1]?.trim() || '';

      found.set(ip, {
        ip,
        method: 'ssdp',
        data: { server, location, st, usn },
      });
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      finish();
    });

    try {
      socket.bind(() => {
        const msearch = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n' +
          'HOST: 239.255.255.250:1900\r\n' +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 3\r\n' +
          'ST: ssdp:all\r\n' +
          '\r\n'
        );

        try {
          socket.setBroadcast(true);
          socket.send(msearch, 0, msearch.length, 1900, '239.255.255.250');
          setTimeout(() => {
            try { socket.send(msearch, 0, msearch.length, 1900, '239.255.255.250'); } catch {}
          }, 1500);
        } catch {}
      });
    } catch {
      clearTimeout(timeout);
      resolve(hints);
    }
  });
}

// ============================================================
// 7. TTL Fingerprinting
// ============================================================

async function discoverFromTtl(hosts) {
  const hints = [];
  const targets = hosts.filter(h => h.status === 'up').slice(0, 60);

  for (let i = 0; i < targets.length; i += 20) {
    const batch = targets.slice(i, i + 20);
    await Promise.allSettled(batch.map(async (host) => {
      try {
        const output = await safeExec('ping', ['-c', '1', '-W', '1', host.ip], {
          timeout: 3000, ignoreErrors: true,
        });

        const m = output.match(/ttl=(\d+)/i);
        if (!m) return;

        const ttl = parseInt(m[1]);
        let defaultTtl, osGuess;

        if (ttl <= 64) { defaultTtl = 64; osGuess = 'Linux/macOS'; }
        else if (ttl <= 128) { defaultTtl = 128; osGuess = 'Windows'; }
        else { defaultTtl = 255; osGuess = 'Netzwerkgerät'; }

        hints.push({
          ip: host.ip,
          method: 'ttl',
          data: { ttl, defaultTtl, hops: defaultTtl - ttl, osGuess },
        });
      } catch {}
    }));
  }

  return hints;
}

// ============================================================
// 8. UISP / UniFi (WLAN client → AP mapping)
// ============================================================

async function discoverFromUnifi(ipToHost) {
  const hints = [];

  const url = await settingsModel.get('unifi_url');
  const token = await settingsModel.get('unifi_token');

  if (!url || !token) {
    console.log('[DeepDiscovery] UISP: Nicht konfiguriert, überspringe');
    return hints;
  }

  try {
    const baseUrl = url.replace(/\/+$/, '');
    const { devices, stationsByDeviceId } = await unifiClient.getDevicesWithStations(baseUrl, token);

    let totalStations = 0;
    for (const s of stationsByDeviceId.values()) totalStations += s.length;
    console.log(`[DeepDiscovery] UISP: ${devices.length} Geräte, ${totalStations} Stationen`);

    // Build device lookup: MAC → { device, host }
    const deviceByMac = new Map();
    for (const dev of devices) {
      if (!dev.mac) continue;
      const host = findHostByMac(ipToHost, dev.mac);
      // Also try IP lookup if MAC didn't match
      const hostByIp = !host && dev.ip ? ipToHost.get(dev.ip) : null;
      const resolved = host || hostByIp;

      if (resolved) {
        deviceByMac.set(dev.mac.toLowerCase(), { device: dev, host: resolved });

        // Enrichment hint for the UISP device itself
        hints.push({
          ip: resolved.ip,
          method: 'unifi_device',
          data: {
            name: dev.name,
            model: dev.modelName || dev.model,
            ssid: dev.ssid,
            num_sta: dev.stationsCount,
            firmware: dev.firmware,
            status: dev.status,
          },
        });
      }
    }

    // Process stations per device → client → AP mapping
    for (const dev of devices) {
      if (!dev.id || !dev.mac) continue;
      const stations = stationsByDeviceId.get(dev.id) || [];
      const devEntry = deviceByMac.get(dev.mac.toLowerCase());
      if (!devEntry) continue;
      const apHost = devEntry.host;

      for (const station of stations) {
        // Find the client host by MAC or IP
        let clientHost = null;
        if (station.mac) clientHost = findHostByMac(ipToHost, station.mac);
        if (!clientHost && station.ip) clientHost = ipToHost.get(station.ip);
        if (!clientHost || clientHost.id === apHost.id) continue;

        // Wireless client → AP relationship
        hints.push({
          childIp: clientHost.ip,
          parentIp: apHost.ip,
          method: 'unifi_wireless',
          confidence: 92,
          detail: `WLAN: ${dev.ssid || 'unbekannt'} (Signal ${station.signal || '?'} dBm)`,
        });

        // Enrichment hint for the wireless client
        hints.push({
          ip: clientHost.ip,
          method: 'unifi_client',
          data: {
            ssid: dev.ssid,
            signal: station.signal,
            radio: station.radio,
            ap_name: dev.name,
            is_wired: false,
          },
        });
      }
    }

    console.log(`[DeepDiscovery] UISP: ${hints.filter(h => h.childIp).length} Zuordnungen, ${hints.filter(h => h.ip).length} Enrichments`);
  } catch (err) {
    console.error('[DeepDiscovery] UISP Fehler:', err.message);
  }

  return hints;
}

// ============================================================
// Helper: Create host for discovered device
// ============================================================

async function createOrUpdateHostForDevice(ip, parentId, deviceType = 'device', deviceData = {}) {
  try {
    // Check if host already exists
    const existing = await pool.query('SELECT id FROM hosts WHERE ip_address = $1', [ip]);
    
    if (existing.rows.length > 0) {
      // Update existing with parent relationship if needed
      if (parentId) {
        await pool.query(
          'UPDATE hosts SET parent_host_id = $1, updated_at = NOW() WHERE id = $2',
          [parentId, existing.rows[0].id]
        );
      }
      return existing.rows[0].id;
    }

    // Create new host with parent relationship
    const result = await pool.query(
      `INSERT INTO hosts (ip_address, parent_host_id, device_type, status, first_seen, last_seen, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
       RETURNING id`,
      [ip, parentId || null, deviceType, 'unknown']
    );

    const hostId = result.rows[0].id;
    console.log(`[DeepDiscovery] Host erstellt: ${ip} mit Parent ${parentId}, Device-Typ: ${deviceType}`);
    
    // Update discovery_info if provided
    if (Object.keys(deviceData).length > 0) {
      deviceData._createdBy = 'fritzbox_discovery';
      deviceData._createdAt = new Date().toISOString();
      await pool.query(
        'UPDATE hosts SET discovery_info = $1::jsonb WHERE id = $2',
        [JSON.stringify(deviceData), hostId]
      );
    }
    
    return hostId;
  } catch (err) {
    console.error(`[DeepDiscovery] Fehler beim Erstellen von Host ${ip}:`, err.message);
    return null;
  }
}

// ============================================================
// 9. AVM FritzBox WLAN Discovery
// ============================================================

async function discoverFromFritzBox(ipToHost) {
  const hints = [];
  
  try {
    // Get all hosts with configured FritzBox credentials
    const fritzboxHosts = await hostsModel.getFritzBoxHosts();
    
    if (fritzboxHosts.length === 0) {
      console.log('[DeepDiscovery] FritzBox: Keine Geräte mit Zugangsdaten konfiguriert');
      return hints;
    }

    console.log(`[DeepDiscovery] FritzBox: Abfrage von ${fritzboxHosts.length} FritzBox(en)...`);

    for (const fritzbox of fritzboxHosts) {
      try {
        console.log(`[DeepDiscovery] FritzBox: Verbinde mit ${fritzbox.hostname || fritzbox.ip}...`);
        
        const client = new FritzBoxClient(
          fritzbox.fritzbox_host,
          fritzbox.fritzbox_username,
          fritzbox.fritzbox_password
        );

        // Get device info
        let deviceInfo = {};
        try {
          deviceInfo = await client.getDeviceInfo();
          console.log(`[DeepDiscovery] FritzBox ${fritzbox.hostname || fritzbox.ip}: ${deviceInfo.modelName} (${deviceInfo.softwareVersion})`);

          hints.push({
            ip: fritzbox.ip,
            method: 'fritzbox_device',
            data: {
              modelName: deviceInfo.modelName,
              softwareVersion: deviceInfo.softwareVersion,
              serialNumber: deviceInfo.serialNumber,
              hardwareVersion: deviceInfo.hardwareVersion,
            },
          });
        } catch (err) {
          console.error(`[DeepDiscovery] FritzBox ${fritzbox.ip}: getDeviceInfo fehlgeschlagen:`, err.message);
        }

        // Get WLAN clients
        try {
          const wlanClients = await client.getWirelessDevices();
          console.log(`[DeepDiscovery] FritzBox ${fritzbox.hostname || fritzbox.ip}: ${wlanClients.length} WLAN-Clients gefunden`);

          for (const device of wlanClients) {
            if (!device.ip || device.ip === fritzbox.ip) continue;
            
            // Create host for this WLAN device with FritzBox as parent
            const wlanHostId = await createOrUpdateHostForDevice(
              device.ip,
              fritzbox.id,
              'device',
              {
                mac: device.mac,
                signalStrength: device.signalStrength,
                speed: device.speed,
                isWireless: true,
                fritzboxIp: fritzbox.ip,
                fritzboxHostname: fritzbox.hostname,
              }
            );

            // Add to ipToHost for relationship processing
            if (wlanHostId) {
              ipToHost.set(device.ip, {
                id: wlanHostId,
                ip: device.ip,
                device_type: 'device',
              });

              // Add relationship hint
              hints.push({
                childIp: device.ip,
                parentIp: fritzbox.ip,
                method: 'fritzbox_wireless',
                confidence: 95,
                detail: `WLAN-Client ${device.mac}, Signal ${device.signalStrength}%`,
              });
            }
          }
        } catch (err) {
          console.error(`[DeepDiscovery] FritzBox ${fritzbox.ip}: getWirelessDevices fehlgeschlagen:`, err.message);
        }

        // Get all hosts (including wired)
        try {
          const allHosts = await client.getAllHosts();
          console.log(`[DeepDiscovery] FritzBox ${fritzbox.hostname || fritzbox.ip}: ${allHosts.length} Hosts insgesamt`);

          for (const device of allHosts) {
            if (!device.active) continue;

            const connectedDevice = findHostByMac(ipToHost, device.mac);
            if (connectedDevice && connectedDevice.ip !== fritzbox.ip) {
              // Determine connection type based on interface
              const isWired = device.interfaceType === 'Ethernet';
              const method = isWired ? 'fritzbox_wired' : 'fritzbox_wireless';
              const confidence = isWired ? 88 : 94;

              // Only add relationship for devices not already connected via SNMP
              const existingRelations = hints.filter(
                h => h.childIp === connectedDevice.ip && h.parentIp === fritzbox.ip
              );
              if (existingRelations.length === 0) {
                hints.push({
                  childIp: connectedDevice.ip,
                  parentIp: fritzbox.ip,
                  method: method,
                  confidence: confidence,
                  detail: `${isWired ? 'Verkabelt' : 'WLAN'}: ${device.mac}`,
                });
              }

              // Enrichment data
              hints.push({
                ip: connectedDevice.ip,
                method: 'fritzbox_connection',
                data: {
                  fritzbox_ip: fritzbox.ip,
                  interface_type: device.interfaceType,
                  device_hostname: device.hostname,
                },
              });
            }
          }
        } catch (err) {
          console.error(`[DeepDiscovery] FritzBox ${fritzbox.ip}: getAllHosts fehlgeschlagen:`, err.message);
        }

      } catch (err) {
        console.error(`[DeepDiscovery] FritzBox-Fehler für ${fritzbox.ip}:`, err.message);
      }
    }

  } catch (err) {
    console.error('[DeepDiscovery] FritzBox-Fehler:', err.message);
  }

  return hints;
}

// ============================================================
// 10. Proxmox Hypervisor Discovery
// ============================================================

async function discoverFromProxmox(ipToHost) {
  const hints = [];
  
  try {
    // Get all hypervisors with configured Proxmox credentials
    const proxmoxHosts = await hostsModel.getProxmoxHosts();
    
    if (proxmoxHosts.length === 0) {
      console.log('[DeepDiscovery] Proxmox: Keine Hypervisoren mit API-Credentials konfiguriert');
      return hints;
    }

    console.log(`[DeepDiscovery] Proxmox: Abfrage von ${proxmoxHosts.length} Hypervisor(n)...`);

    for (const hypervisor of proxmoxHosts) {
      try {
        console.log(`[DeepDiscovery] Proxmox: Verbinde mit ${hypervisor.hostname || hypervisor.ip} (${hypervisor.proxmox_api_host})...`);
        
        const vms = await getVMsFromHost(
          hypervisor.proxmox_api_host,
          hypervisor.proxmox_api_token_id,
          hypervisor.proxmox_api_token_secret
        );

        console.log(`[DeepDiscovery] Proxmox ${hypervisor.hostname || hypervisor.ip}: ${vms.length} VMs gefunden`);

        for (const vm of vms) {
          if (vm.macs.length === 0) {
            console.log(`[DeepDiscovery] Proxmox VM ${vm.name} (${vm.vmid}): Keine MAC-Adressen gefunden`);
            continue;
          }
          
          // For each MAC address of this VM, try to find the corresponding host
          for (const mac of vm.macs) {
            const vmHost = findHostByMac(ipToHost, mac);
            if (vmHost && vmHost.id !== hypervisor.id) {
              console.log(`[DeepDiscovery] Proxmox: VM ${vm.name} (${mac}) → Host ${vmHost.ip}`);
              hints.push({
                childIp: vmHost.ip,
                parentIp: hypervisor.ip,
                method: 'proxmox_api',
                confidence: 98,
                detail: `Proxmox VM: ${vm.name} (VMID ${vm.vmid}, MAC ${mac})`,
              });
            } else if (!vmHost) {
              console.log(`[DeepDiscovery] Proxmox: VM ${vm.name} (${mac}) nicht im Netzwerk gefunden`);
            }
          }
        }
      } catch (err) {
        console.error(`[DeepDiscovery] Proxmox-Fehler für ${hypervisor.hostname || hypervisor.ip}:`, err.message);
        console.error(`[DeepDiscovery] Proxmox-Stack:`, err.stack);
      }
    }

    console.log(`[DeepDiscovery] Proxmox: ${hints.length} VM-Zuordnungen`);
  } catch (err) {
    console.error('[DeepDiscovery] Proxmox Fehler:', err.message);
  }

  return hints;
}

// ============================================================
// Merge & Apply Hints
// ============================================================

async function applyHints(hints, ipToHost) {
  // 1. Smart parent selection using port-MAC-count analysis
  //    When multiple switches see the same MAC, the switch where
  //    the MAC is on a port with FEWER MACs is the "closer" switch.
  //    Uplink/trunk ports have many MACs, edge ports have 1-3.
  const snmpHints = hints.filter(h => h.method === 'snmp_mac_table' && h.childIp && h.parentIp);
  const otherRels = hints.filter(h => h.childIp && h.parentIp && h.method !== 'snmp_mac_table');

  // Group SNMP hints by child → list of {parentIp, portMacCount, ...}
  const childSwitchOptions = new Map();
  for (const h of snmpHints) {
    if (!childSwitchOptions.has(h.childIp)) childSwitchOptions.set(h.childIp, []);
    childSwitchOptions.get(h.childIp).push(h);
  }

  // For each child, pick the switch with the lowest portMacCount (= closest)
  const bestParent = new Map();
  for (const [childIp, options] of childSwitchOptions) {
    // Sort by portMacCount ascending → switch with fewest MACs on that port wins
    options.sort((a, b) => (a.portMacCount || 999) - (b.portMacCount || 999));
    const best = options[0];
    bestParent.set(childIp, {
      ...best,
      confidence: best.portMacCount <= 3 ? 95 : best.portMacCount <= 10 ? 85 : 75,
    });
  }

  // Layer non-SNMP relationship hints (traceroute, LLDP etc.)
  // These override SNMP only if confidence is higher
  for (const rel of otherRels) {
    const existing = bestParent.get(rel.childIp);
    if (!existing || rel.confidence > existing.confidence) {
      bestParent.set(rel.childIp, rel);
    }
  }

  // 2. Collect enrichment hints → merge per IP
  const enrichment = new Map();
  for (const h of hints) {
    if (!h.ip || !h.data) continue;
    if (!enrichment.has(h.ip)) enrichment.set(h.ip, {});
    const obj = enrichment.get(h.ip);
    if (!obj[h.method]) {
      obj[h.method] = h.data;
    } else if (Array.isArray(obj[h.method])) {
      obj[h.method].push(h.data);
    } else {
      obj[h.method] = [obj[h.method], h.data];
    }
  }

  let applied = 0;
  const infraTypes = ['gateway', 'router', 'firewall', 'switch', 'ap', 'management', 'hypervisor'];

  // 3. First: reset auto-discovered parents so we can reassign optimally
  //    Only reset hosts without manual device_type (= never touched by user)
  await pool.query(
    `UPDATE hosts SET parent_host_id = NULL
     WHERE parent_host_id IS NOT NULL AND device_type IS NULL`
  );

  // 4. Apply parent relationships
  for (const [childIp, rel] of bestParent) {
    const child = ipToHost.get(childIp);
    const parent = ipToHost.get(rel.parentIp);
    if (!child || !parent || child.id === parent.id) continue;

    const childType = child.computed_type || child.device_type;
    const parentType = parent.computed_type || parent.device_type;

    // Skip VMs → they belong to hypervisors, not switches
    if (childType === 'vm' && ['switch', 'ap', 'gateway', 'router'].includes(parentType)) {
      continue;
    }

    // Allow switch-to-switch (cascading) if on edge port (few MACs)
    // But skip gateway/firewall being assigned as child of a switch
    if (['gateway', 'firewall'].includes(childType) && parentType === 'switch') {
      continue;
    }

    try {
      const res = await pool.query(
        `UPDATE hosts SET parent_host_id = $1, updated_at = NOW()
         WHERE id = $2 AND device_type IS NULL`,
        [parent.id, child.id]
      );
      if (res.rowCount > 0) {
        applied++;
        const portInfo = rel.portMacCount ? ` [Port: ${rel.portMacCount} MACs]` : '';
        console.log(`[DeepDiscovery] Zuordnung: ${childIp} → ${rel.parentIp} (${rel.method}, ${rel.confidence}%)${portInfo}`);
      }
    } catch (err) {
      console.error(`[DeepDiscovery] DB-Fehler bei Parent-Zuordnung: ${err.message}`);
    }
  }

  // 4. Store enrichment data
  for (const [ip, data] of enrichment) {
    const host = ipToHost.get(ip);
    if (!host) continue;

    try {
      data._lastDiscovery = new Date().toISOString();
      await pool.query(
        `UPDATE hosts SET discovery_info = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(data), host.id]
      );
    } catch {
      // discovery_info column might not exist yet
    }
  }

  return applied;
}

// ============================================================
// Main Entry Point
// ============================================================

async function runDeepDiscovery(topologyHosts, network) {
  console.log('[DeepDiscovery] === Starte Deep Network Analysis ===');
  const startTime = Date.now();

  const deepEnabled = (await settingsModel.get('deep_discovery_enabled')) !== 'false';
  if (!deepEnabled) {
    console.log('[DeepDiscovery] Deaktiviert in Einstellungen, überspringe');
    return { hints: [], applied: 0, duration: 0 };
  }

  const snmpCommunities = (await settingsModel.get('snmp_community') || 'public')
    .split(',').map(s => s.trim()).filter(Boolean);

  // Build IP → host lookup
  const ipToHost = new Map();
  for (const h of topologyHosts) {
    ipToHost.set(h.ip, h);
  }

  // Run all discovery methods
  const results = await Promise.allSettled([
    discoverFromArp(ipToHost),
    discoverFromTraceroute(topologyHosts, ipToHost),
    discoverFromBroadcastPing(network, ipToHost),
    discoverFromSnmp(topologyHosts, snmpCommunities, ipToHost),
    discoverFromMdns(ipToHost),
    discoverFromSsdp(ipToHost),
    discoverFromTtl(topologyHosts),
    discoverFromUnifi(ipToHost),
    discoverFromFritzBox(ipToHost),
    discoverFromProxmox(ipToHost),
  ]);

  const methodNames = ['ARP', 'Traceroute', 'Ping-Clustering', 'SNMP', 'mDNS', 'SSDP', 'TTL', 'UniFi', 'FritzBox', 'Proxmox'];
  const allHints = [];

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value) {
      const methodHints = results[i].value;
      allHints.push(...methodHints);
      console.log(`[DeepDiscovery] ${methodNames[i]}: ${methodHints.length} Hinweise`);
    } else if (results[i].status === 'rejected') {
      console.error(`[DeepDiscovery] ${methodNames[i]} fehlgeschlagen:`, results[i].reason?.message);
    }
  }

  const applied = await applyHints(allHints, ipToHost);
  const duration = Date.now() - startTime;

  console.log(`[DeepDiscovery] === Fertig: ${allHints.length} Hinweise, ${applied} Zuordnungen (${(duration / 1000).toFixed(1)}s) ===`);
  return { hints: allHints, applied, duration };
}

module.exports = { runDeepDiscovery };
