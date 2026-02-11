const { execFile } = require('child_process');
const { promisify } = require('util');
const dgram = require('dgram');
const settingsModel = require('../models/settings');
const pool = require('../db/pool');

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
  ]);

  const methodNames = ['ARP', 'Traceroute', 'Ping-Clustering', 'SNMP', 'mDNS', 'SSDP', 'TTL'];
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
