const { execFile } = require('child_process');
const { parseStringPromise } = require('xml2js');
const hostsModel = require('../models/hosts');
const servicesModel = require('../models/services');
const scansModel = require('../models/scans');
const settingsModel = require('../models/settings');
const availabilityModel = require('../models/availability');
const { identifyService } = require('./serviceIdentifier');
const { runDeepDiscovery } = require('./deepDiscovery');
const topologyModel = require('../models/topology');

let scanning = false;
let discoveryRunning = false;
let currentScanId = null;

function isScanning() {
  return scanning;
}

function isDiscoveryRunning() {
  return discoveryRunning;
}

function getCurrentScanId() {
  return currentScanId;
}

/**
 * Run parallel tasks with concurrency limit
 */
async function parallelLimit(tasks, limit) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r; });
    executing.add(p);
    results.push(p);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

/**
 * Check if host is alive by attempting connections to common ports
 * Uses TCP SYN (port 443, 80, 22) for reliability without special permissions
 */
function checkHostAlive(ip) {
  return new Promise((resolve) => {
    const ports = [443, 80, 22]; // Try HTTPS, HTTP, SSH in order
    let attempts = 0;
    let foundOpen = false;

    const tryPort = (portIndex) => {
      if (foundOpen || portIndex >= ports.length) {
        // If no port was open, try ICMP ping as fallback
        if (!foundOpen) {
          execFile('ping', ['-c', '1', '-W', '1', ip], {
            timeout: 2000,
          }, (err) => {
            resolve(!err);
          });
        } else {
          resolve(true);
        }
        return;
      }

      const port = ports[portIndex];
      const socket = require('net').createConnection(
        { host: ip, port, timeout: 1000 },
        () => {
          foundOpen = true;
          socket.destroy();
          resolve(true);
        }
      );

      socket.on('error', () => {
        socket.destroy();
        tryPort(portIndex + 1);
      });

      socket.on('timeout', () => {
        socket.destroy();
        tryPort(portIndex + 1);
      });
    };

    tryPort(0);
  });
}

/**
 * Phase 0: Ping sweep to discover which hosts are alive
 * Uses ARP (local net), ICMP echo, TCP SYN to port 443, TCP ACK to port 80
 * This is fast and reliable for determining host reachability
 */
function runPingSweep(network) {
  return new Promise((resolve, reject) => {
    const args = [
      '-sn',               // Ping sweep only, no port scan
      '-T4',               // Aggressive timing (fine for ping)
      '--max-retries', '2',
      '-oX', '-',
      network,
    ];

    console.log(`[Scanner] Phase 0 - Ping sweep: nmap ${args.join(' ')}`);

    execFile('nmap', args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000, // 2 minutes
    }, (err, stdout, stderr) => {
      if (err && !stdout) {
        reject(new Error(`Ping sweep failed: ${err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Parse ping sweep XML to get set of alive IPs with MAC/vendor/hostname info
 */
async function parsePingSweep(xml) {
  const result = await parseStringPromise(xml, { explicitArray: false });
  const alive = new Map(); // ip -> { mac, vendor, hostname }

  if (!result.nmaprun || !result.nmaprun.host) return alive;

  const rawHosts = Array.isArray(result.nmaprun.host)
    ? result.nmaprun.host
    : [result.nmaprun.host];

  for (const h of rawHosts) {
    if (h.status?.$.state !== 'up') continue;

    const addresses = Array.isArray(h.address) ? h.address : [h.address];
    const ipAddr = addresses.find(a => a.$.addrtype === 'ipv4');
    if (!ipAddr) continue;

    const macAddr = addresses.find(a => a.$.addrtype === 'mac');
    let hostname = null;
    if (h.hostnames?.hostname) {
      const hostnames = Array.isArray(h.hostnames.hostname)
        ? h.hostnames.hostname : [h.hostnames.hostname];
      hostname = hostnames[0]?.$.name || null;
    }

    alive.set(ipAddr.$.addr, {
      mac: macAddr?.$.addr || null,
      vendor: macAddr?.$.vendor || null,
      hostname,
    });
  }

  return alive;
}

/**
 * Phase 1: Fast SYN scan to discover open ports
 * No -sV (version detection), just find what's open quickly
 */
function runNmapDiscovery(network, portRange) {
  return new Promise((resolve, reject) => {
    const args = [
      '-sS',                 // SYN scan (fast)
      '-Pn',                 // Don't ping first - scan everything
      '-O',                  // OS detection
      '--osscan-limit',      // Limit OS detection to promising targets
      '-T4',                 // Aggressive timing
      '-p', portRange,       // Port range
      '--open',              // Only show open ports
      '-oX', '-',            // XML output to stdout
      '--max-retries', '3',  // More retries for reliability
      '--host-timeout', '90s',  // Timeout per host (reduced from 300s for faster scans)
      '--min-rate', '200',   // Moderate min rate
      network,
    ];

    console.log(`[Scanner] Phase 1 - Fast port discovery: nmap ${args.join(' ')}`);

    execFile('nmap', args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 1800000, // 30 minutes - sufficient for 100+ hosts at 90s per host
    }, (err, stdout, stderr) => {
      if (err && !stdout) {
        reject(new Error(`nmap failed: ${err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Parse nmap XML output into structured host/port data
 */
async function parseNmapOutput(xml) {
  const result = await parseStringPromise(xml, { explicitArray: false });
  const hosts = [];

  if (!result.nmaprun || !result.nmaprun.host) return hosts;

  const rawHosts = Array.isArray(result.nmaprun.host)
    ? result.nmaprun.host
    : [result.nmaprun.host];

  for (const h of rawHosts) {
    if (h.status?.$.state !== 'up') continue;

    const addresses = Array.isArray(h.address) ? h.address : [h.address];
    const ipAddr = addresses.find(a => a.$.addrtype === 'ipv4');
    const macAddr = addresses.find(a => a.$.addrtype === 'mac');

    if (!ipAddr) continue;

    const host = {
      ip: ipAddr.$.addr,
      mac: macAddr?.$.addr || null,
      vendor: macAddr?.$.vendor || null,
      hostname: null,
      os: null,
      status: 'up',
      ports: [],
    };

    // Hostname
    if (h.hostnames?.hostname) {
      const hostnames = Array.isArray(h.hostnames.hostname)
        ? h.hostnames.hostname : [h.hostnames.hostname];
      host.hostname = hostnames[0]?.$.name || null;
    }

    // OS detection
    if (h.os?.osmatch) {
      const matches = Array.isArray(h.os.osmatch) ? h.os.osmatch : [h.os.osmatch];
      if (matches[0]) {
        host.os = matches[0].$.name;
      }
    }

    // Ports - extract basic info (no version info since we skipped -sV)
    if (h.ports?.port) {
      const ports = Array.isArray(h.ports.port) ? h.ports.port : [h.ports.port];
      for (const p of ports) {
        if (p.state?.$.state !== 'open') continue;

        const svc = p.service ? p.service.$ || p.service : {};

        host.ports.push({
          port: parseInt(p.$.portid),
          protocol: p.$.protocol || 'tcp',
          state: 'open',
          name: svc.name || '',
          product: svc.product || '',
          version: svc.version || '',
          extrainfo: svc.extrainfo || '',
        });
      }
    }

    hosts.push(host);
  }

  return hosts;
}

/**
 * Phase 2: Deep-probe all open ports on a host
 * Uses curl, banner grabbing, and endpoint probing
 */
async function deepProbeHost(host) {
  const CONCURRENCY = 8; // Probe up to 8 ports per host in parallel
  const results = [];

  console.log(`[Scanner] Phase 2 - Deep probing ${host.ip} (${host.ports.length} ports)`);

  const tasks = host.ports.map((portInfo) => async () => {
    try {
      const identified = await identifyService(host.ip, portInfo.port, portInfo);
      return { portInfo, identified };
    } catch (err) {
      console.error(`[Scanner] Error probing ${host.ip}:${portInfo.port}: ${err.message}`);
      return { portInfo, identified: null };
    }
  });

  const settled = await parallelLimit(tasks, CONCURRENCY);

  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) {
      results.push(r.value);
    }
  }

  return results;
}

/**
 * Run a full network scan:
 *   Phase 0 (ping sweep) + Phase 1 (port discovery) + Phase 2 (deep probing)
 */
async function runScan() {
  if (scanning) {
    console.log('[Scanner] Scan already in progress, skipping');
    return null;
  }

  scanning = true;
  let scanRecord;

  try {
    const network = await settingsModel.get('scan_network') || '192.168.66.0/24';
    const portRange = await settingsModel.get('scan_ports') || '1-10000';

    scanRecord = await scansModel.create(network);
    currentScanId = scanRecord.id;
    console.log(`[Scanner] === Scan #${scanRecord.id} started for ${network} ===`);

    // Phase 0: Ping sweep to discover alive hosts
    const pingSweepXml = await runPingSweep(network);
    const aliveHosts = await parsePingSweep(pingSweepXml);
    console.log(`[Scanner] Phase 0 complete: ${aliveHosts.size} hosts alive (ping sweep)`);

    // Phase 1: Fast nmap port discovery
    const xml = await runNmapDiscovery(network, portRange);
    const hosts = await parseNmapOutput(xml);

    const totalPorts = hosts.reduce((sum, h) => sum + h.ports.length, 0);
    console.log(`[Scanner] Phase 1 complete: ${hosts.length} hosts with open ports, ${totalPorts} ports found`);

    // Merge: hosts found by port scan + hosts alive by ping but not in port scan
    const portScanIps = new Set(hosts.map(h => h.ip));
    for (const [ip, info] of aliveHosts) {
      if (!portScanIps.has(ip)) {
        // Host responded to ping but had no open ports found by nmap
        hosts.push({
          ip,
          mac: info.mac,
          vendor: info.vendor,
          hostname: info.hostname,
          os: null,
          status: 'up',
          ports: [],
        });
      }
    }

    // Determine online/offline: combine ping sweep + port scan results
    const allAliveIps = new Set([...aliveHosts.keys(), ...portScanIps]);
    console.log(`[Scanner] Total alive hosts (ping + port scan): ${allAliveIps.size}`);

    // Phase 1.5: Ping hosts that weren't found in nmap sweep
    // (e.g., WLAN devices discovered via FritzBox, hosts outside main scan network)
    console.log(`[Scanner] === Starting Phase 1.5 ===`);
    const existingHosts = await hostsModel.getAllIds();
    console.log(`[Scanner] Phase 1.5: Found ${existingHosts.length} total hosts in database`);
    const hostsNotInScan = existingHosts.filter(h => !allAliveIps.has(h.ip));
    console.log(`[Scanner] Phase 1.5: ${hostsNotInScan.length} hosts NOT found in nmap scan`);
    
    if (hostsNotInScan.length > 0) {
      console.log(`[Scanner] Phase 1.5 - Checking ${hostsNotInScan.length} hosts not found in nmap scan...`);
      console.log(`[Scanner] Phase 1.5 - Hosts to check: ${hostsNotInScan.map(h => h.ip).join(', ')}`);
      const checkTasks = hostsNotInScan.map(h => async () => {
        const isAlive = await checkHostAlive(h.ip);
        if (isAlive) {
          console.log(`[Scanner]   ${h.ip} is alive (port/ping check)`);
          allAliveIps.add(h.ip);
        } else {
          console.log(`[Scanner]   ${h.ip} is dead (not responding to TCP/ICMP)`);
        }
        return { ip: h.ip, isAlive };
      });
      
      const checkResults = await parallelLimit(checkTasks, 8); // Check up to 8 hosts in parallel
      const aliveFromCheck = checkResults.filter(r => r.status === 'fulfilled' && r.value.isAlive).length;
      console.log(`[Scanner] Phase 1.5 complete: ${aliveFromCheck} additional hosts alive`);
    }

    // Only mark hosts as down if they weren't found by EITHER ping sweep or port scan,
    // AND they haven't been seen recently (grace period of 2 hours)
    const hostsToMarkDown = existingHosts
      .filter(h => !allAliveIps.has(h.ip))
      .map(h => h.id);

    if (hostsToMarkDown.length > 0) {
      await hostsModel.markDownGraceful(hostsToMarkDown);
      console.log(`[Scanner] Marked ${hostsToMarkDown.length} hosts as offline (not seen in ping sweep or port scan)`);
    }

    // Record availability for all known hosts
    try {
      const checkedAt = new Date();
      const records = existingHosts.map(h => ({
        hostId: h.id,
        status: allAliveIps.has(h.ip) ? 'up' : 'down',
      }));
      await availabilityModel.recordBatch(records, checkedAt);
      console.log(`[Scanner] Recorded availability for ${records.length} hosts`);
      await availabilityModel.cleanup(30);
    } catch (err) {
      console.error(`[Scanner] Availability recording error (non-fatal): ${err.message}`);
    }

    let totalServices = 0;

    // Phase 2: Deep probe each host's open ports
    for (const host of hosts) {
      const hostId = await hostsModel.upsert(host);
      const probeResults = await deepProbeHost(host);

      const activePorts = [];
      for (const { portInfo, identified } of probeResults) {
        if (!identified) continue;

        try {
          // Sanitize strings to remove null bytes that break PostgreSQL
          const sanitize = (s) => s ? s.replace(/\x00/g, '') : s;

          await servicesModel.upsert({
            hostId,
            port: identified.port,
            protocol: portInfo.protocol,
            state: 'open',
            name: sanitize(identified.name),
            product: sanitize(identified.product),
            version: sanitize(identified.version),
            info: sanitize(identified.info),
            banner: sanitize(identified.banner),
            httpTitle: sanitize(identified.httpTitle),
            httpServer: sanitize(identified.httpServer),
            identifiedAs: sanitize(identified.identifiedAs),
            extraInfo: identified.extraInfo,
          });
          activePorts.push(portInfo.port);
          totalServices++;

          const source = identified.extraInfo?.matchSource || '?';
          console.log(`[Scanner]   ${host.ip}:${portInfo.port} → ${identified.identifiedAs} [${source}]`);
        } catch (err) {
          console.error(`[Scanner] DB error for ${host.ip}:${portInfo.port}: ${err.message}`);
        }
      }

      // Mark services on this host that weren't found as closed
      // But ONLY if nmap actually found ports - 0 ports likely means nmap missed them
      if (host.ports.length > 0) {
        await servicesModel.markClosed(hostId, activePorts);
      }
    }

    // Phase 3: Deep Discovery (topology enrichment) - only if enabled
    const deepDiscoveryEnabled = (await settingsModel.get('deep_discovery_enabled')) !== 'false';
    if (deepDiscoveryEnabled) {
      try {
        const topology = await topologyModel.getTopology();
        const discoveryResult = await runDeepDiscovery(topology.hosts, network);
        console.log(`[Scanner] Phase 3 complete: ${discoveryResult.applied} topology relationships discovered`);
      } catch (err) {
        console.error(`[Scanner] Deep Discovery error (non-fatal): ${err.message}`);
      }
    } else {
      console.log('[Scanner] Deep Discovery disabled, skipping Phase 3');
    }

    await scansModel.finish(scanRecord.id, allAliveIps.size, totalServices, null);
    console.log(`[Scanner] === Scan #${scanRecord.id} completed: ${allAliveIps.size} hosts alive, ${totalServices} services ===`);

    return { hosts: allAliveIps.size, services: totalServices };
  } catch (err) {
    console.error(`[Scanner] Scan failed: ${err.message}`);
    if (scanRecord) {
      await scansModel.finish(scanRecord.id, 0, 0, err.message);
    }
    throw err;
  } finally {
    scanning = false;
    currentScanId = null;
  }
}

async function runDeepDiscoveryStandalone() {
  if (discoveryRunning) {
    throw new Error('Deep Discovery is already running');
  }

  discoveryRunning = true;
  console.log('[DeepDiscovery] === Standalone Deep Discovery triggered ===');

  try {
    const network = await settingsModel.get('scan_network') || '192.168.66.0/24';
    const topology = await topologyModel.getTopology();
    const result = await runDeepDiscovery(topology.hosts, network);
    console.log(`[DeepDiscovery] === Standalone complete: ${result.applied} relationships ===`);
    return result;
  } catch (err) {
    console.error('[DeepDiscovery] Standalone error:', err.message);
    throw err;
  } finally {
    discoveryRunning = false;
  }
}

module.exports = { runScan, isScanning, getCurrentScanId, runDeepDiscoveryStandalone, isDiscoveryRunning };
