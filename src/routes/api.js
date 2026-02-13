const express = require('express');
const router = express.Router();
const hostsModel = require('../models/hosts');
const servicesModel = require('../models/services');
const scansModel = require('../models/scans');
const settingsModel = require('../models/settings');
const { runScan, isScanning, getCurrentScanId, runDeepDiscoveryStandalone, isDiscoveryRunning } = require('../services/scanner');
const { scheduleFromSettings, scheduleDeepDiscovery } = require('../services/scheduler');
const availabilityModel = require('../models/availability');
const topologyModel = require('../models/topology');
const { classifyHost, DEVICE_TYPES } = require('../services/classifier');
const { runDeepDiscovery } = require('../services/deepDiscovery');
const unifiClient = require('../services/unifiClient');

// Allowed settings keys and their validators
const SETTINGS_VALIDATORS = {
  scan_network: (v) => {
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(v)) return 'Invalid CIDR format (e.g. 192.168.1.0/24)';
    const parts = v.split('/');
    const prefix = parseInt(parts[1]);
    if (prefix < 8 || prefix > 32) return 'CIDR prefix must be between 8 and 32';
    return null;
  },
  scan_interval: (v) => {
    const n = parseInt(v);
    if (isNaN(n) || n < 1 || n > 1440) return 'Interval must be between 1 and 1440 minutes';
    return null;
  },
  scan_ports: (v) => {
    if (!/^(\d+(-\d+)?)(,\d+(-\d+)?)*$/.test(v)) return 'Invalid port range (e.g. 1-10000 or 22,80,443)';
    return null;
  },
  scan_enabled: (v) => {
    if (v !== 'true' && v !== 'false') return 'Must be true or false';
    return null;
  },
  snmp_community: (v) => {
    if (!v || v.trim().length === 0) return 'Mindestens ein Community-String erforderlich';
    return null;
  },
  deep_discovery_enabled: (v) => {
    if (v !== 'true' && v !== 'false') return 'Must be true or false';
    return null;
  },
  deep_discovery_interval: (v) => {
    const n = parseInt(v);
    if (isNaN(n) || n < 5 || n > 1440) return 'Intervall muss zwischen 5 und 1440 Minuten sein';
    return null;
  },
  unifi_url: (v) => {
    if (v === '') return null; // empty = disabled
    if (!/^https?:\/\/.+/i.test(v)) return 'Muss eine gültige URL sein (https://...)';
    return null;
  },
  unifi_token: (v) => {
    if (v.length > 200) return 'Maximal 200 Zeichen';
    return null;
  },
};

// Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await hostsModel.getStats();
    const latestScan = await scansModel.getLatest();
    res.json({ ...stats, latestScan, scanning: isScanning() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All hosts
router.get('/hosts', async (req, res) => {
  try {
    const hosts = await hostsModel.getAll();
    res.json(hosts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single host with services
router.get('/hosts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid host ID' });
    const host = await hostsModel.getById(id);
    if (!host) return res.status(404).json({ error: 'Host not found' });

    // Add computed_type from classifier
    const openServices = (host.services || []).filter(s => s.state === 'open');
    const classification = classifyHost(host, openServices);
    host.computed_type = host.device_type || classification.type;
    host.classification_reason = classification.reason;
    host.classification_confidence = classification.confidence;

    res.json(host);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a host
router.delete('/hosts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid host ID' });
    const deleted = await hostsModel.deleteById(id);
    if (!deleted) return res.status(404).json({ error: 'Host not found' });
    res.json({ message: 'Host deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan history
router.get('/scans', async (req, res) => {
  try {
    const scans = await scansModel.getRecent(50);
    res.json(scans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger manual scan
router.post('/scans/start', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'Scan already in progress', scanId: getCurrentScanId() });
  }
  // Start scan async
  res.json({ message: 'Scan started', scanning: true });
  runScan().catch(err => console.error('[API] Manual scan error:', err.message));
});

// Scan status
router.get('/scans/status', (req, res) => {
  res.json({ scanning: isScanning(), scanId: getCurrentScanId() });
});

// Settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await settingsModel.getAll();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings format' });
    }
    // Validate all keys and values before applying any changes
    for (const [key, value] of Object.entries(settings)) {
      if (!SETTINGS_VALIDATORS[key]) {
        return res.status(400).json({ error: `Unknown setting: ${key}` });
      }
      const err = SETTINGS_VALIDATORS[key](String(value));
      if (err) {
        return res.status(400).json({ error: `${key}: ${err}` });
      }
    }
    for (const [key, value] of Object.entries(settings)) {
      await settingsModel.set(key, String(value));
    }
    // Re-schedule if interval/network changed
    await scheduleFromSettings();
    await scheduleDeepDiscovery();
    const updated = await settingsModel.getAll();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Availability timeline
router.get('/availability', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' });
    }
    const requested = new Date(date + 'T00:00:00');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    if (requested < cutoff) {
      return res.status(400).json({ error: 'Date exceeds 30-day retention limit' });
    }
    const data = await availabilityModel.getByDay(date);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Topology / Infrastructure Map
router.get('/topology', async (req, res) => {
  try {
    const topology = await topologyModel.getTopology();
    res.json(topology);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Device types list
router.get('/device-types', (req, res) => {
  res.json(DEVICE_TYPES);
});

// Classify a host (set device type and/or parent)
router.put('/hosts/:id/classify', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid host ID' });

    const { device_type, parent_host_id } = req.body;

    if (device_type !== undefined && device_type !== null) {
      const valid = DEVICE_TYPES.map(t => t.value);
      if (!valid.includes(device_type)) {
        return res.status(400).json({ error: `Ungültiger Gerätetyp: ${device_type}` });
      }
    }

    const result = await topologyModel.updateClassification(
      id,
      device_type,
      parent_host_id !== undefined
        ? (parent_host_id === null ? null : parseInt(parent_host_id))
        : undefined
    );

    if (!result) return res.status(404).json({ error: 'Host not found' });
    res.json(result);
  } catch (err) {
    if (err.message.includes('eigener Parent') || err.message.includes('nicht gefunden')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// Manual deep discovery trigger
router.post('/discovery/run', async (req, res) => {
  if (isDiscoveryRunning()) {
    return res.status(409).json({ error: 'Deep Discovery läuft bereits' });
  }
  try {
    res.json({ message: 'Deep Discovery gestartet' });
    runDeepDiscoveryStandalone()
      .then(r => console.log(`[API] Deep Discovery fertig: ${r.applied} Zuordnungen`))
      .catch(err => console.error('[API] Deep Discovery Fehler:', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UISP Controller connection test
router.post('/unifi/test', async (req, res) => {
  const { url, token } = req.body || {};
  if (!url || !token) {
    return res.status(400).json({ error: 'URL und API-Token erforderlich' });
  }
  try {
    const result = await unifiClient.testConnection(url, token);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Proxmox credentials for a host
router.put('/hosts/:id/proxmox', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log(`[API] PUT /hosts/${id}/proxmox`, JSON.stringify(req.body));
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid host ID' });

    const { api_host, token_id, token_secret } = req.body;

    // Validate input
    if (api_host && !/^https?:\/\/.+/.test(api_host)) {
      return res.status(400).json({ error: 'api_host muss eine gültige URL sein' });
    }

    const updated = await hostsModel.updateProxmoxCredentials(id, {
      api_host: api_host || null,
      token_id: token_id || null,
      token_secret: token_secret || null,
    });
    console.log(`[API] Proxmox credentials updated for host ${id}: ${updated}`);

    if (!updated) return res.status(404).json({ error: 'Host not found' });
    res.json({ message: 'Proxmox-Credentials aktualisiert' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update FritzBox credentials for a host
router.put('/hosts/:id/fritzbox', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log(`[API] PUT /hosts/${id}/fritzbox`, JSON.stringify(req.body));
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid host ID' });

    const { fritzbox_host, fritzbox_username, fritzbox_password } = req.body;

    // Validate input
    if (fritzbox_host && !/^https?:\/\/.+/.test(fritzbox_host)) {
      return res.status(400).json({ error: 'fritzbox_host muss eine gültige URL sein (z.B. https://fritz.box)' });
    }

    const updated = await hostsModel.updateFritzBoxCredentials(id, {
      fritzbox_host: fritzbox_host || null,
      fritzbox_username: fritzbox_username || null,
      fritzbox_password: fritzbox_password || null,
    });
    console.log(`[API] FritzBox credentials updated for host ${id}: ${updated}`);

    if (!updated) return res.status(404).json({ error: 'Host not found' });
    
    // If credentials were set, trigger deep discovery to discover WLAN devices immediately
    if (fritzbox_host && fritzbox_username && fritzbox_password) {
      try {
        console.log(`[API] Triggering Deep Discovery for FritzBox (host ${id})...`);
        const { runDeepDiscoveryStandalone } = require('../services/scanner');
        // Run in background, don't wait
        setImmediate(() => {
          runDeepDiscoveryStandalone().catch(err => 
            console.error('[API] Deep Discovery failed:', err.message)
          );
        });
      } catch (err) {
        console.error('[API] Could not trigger Deep Discovery:', err.message);
      }
    }
    
    res.json({ message: 'FritzBox-Credentials aktualisiert' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test FritzBox connection
router.post('/fritzbox/test', async (req, res) => {
  const { fritzbox_host, fritzbox_username, fritzbox_password } = req.body || {};
  if (!fritzbox_host || !fritzbox_username || !fritzbox_password) {
    return res.status(400).json({ error: 'Host, Benutzername und Passwort erforderlich' });
  }
  try {
    const FritzBoxClient = require('../services/fritzboxClient');
    const client = new FritzBoxClient(fritzbox_host, fritzbox_username, fritzbox_password);
    const result = await client.testConnection();
    
    // Try to get WLAN devices, but it's optional
    let devices = [];
    try {
      devices = await client.getWirelessDevices();
    } catch (err) {
      console.log('[FritzBox] Could not fetch WLAN devices:', err.message);
      // This is OK - connection test still passes
    }
    
    res.json({ 
      ...result, 
      device_count: devices.length, 
      devices: devices.slice(0, 5),
      wlanDevices: devices // Also return as wlanDevices for compatibility
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Test Proxmox connection
router.post('/proxmox/test', async (req, res) => {
  const { api_host, token_id, token_secret } = req.body || {};
  if (!api_host || !token_id || !token_secret) {
    return res.status(400).json({ error: 'api_host, token_id und token_secret erforderlich' });
  }
  if (!/^https?:\/\/.+/.test(api_host)) {
    return res.status(400).json({ error: 'api_host muss eine gültige URL sein (z.B. https://proxmox:8006)' });
  }
  try {
    const { testProxmoxConnection, getVMsFromHost, getNodeAddressMap } = require('../services/proxmoxClient');
    const result = await testProxmoxConnection(api_host, token_id, token_secret);

    let vms = [];
    let nodeMap = new Map();
    try {
      vms = await getVMsFromHost(api_host, token_id, token_secret);
      try {
        nodeMap = await getNodeAddressMap(api_host, token_id, token_secret);
      } catch {}

      try {
        const url = new URL(api_host);
        const hostKey = url.hostname.toLowerCase();
        const shortKey = hostKey.split('.')[0];
        let nodeNameForHost = null;

        for (const [nodeName, nodeIps] of nodeMap.entries()) {
          const nodeKey = String(nodeName || '').toLowerCase();
          if (nodeKey === hostKey || nodeKey === shortKey) {
            nodeNameForHost = nodeName;
            break;
          }
          if (Array.isArray(nodeIps)) {
            for (const nodeIp of nodeIps) {
              if (nodeIp && (nodeIp === hostKey || nodeIp === shortKey)) {
                nodeNameForHost = nodeName;
                break;
              }
            }
          }
          if (nodeNameForHost) break;
        }

        if (nodeNameForHost) {
          const nodeKey = String(nodeNameForHost).toLowerCase();
          vms = vms.filter(vm => {
            if (!vm.node) return true;
            return String(vm.node).toLowerCase() === nodeKey;
          });
        }
      } catch {}
    } catch (err) {
      console.log('[Proxmox] Could not fetch VMs during test:', err.message);
    }

    res.json({
      ...result,
      vm_count: vms.length,
      vms: vms.slice(0, 5),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Debug endpoint to check FritzBox configuration
router.get('/debug/fritzbox-hosts', async (req, res) => {
  try {
    const allHosts = await hostsModel.getFritzBoxHosts();
    res.json({ count: allHosts.length, hosts: allHosts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint to check Proxmox configuration
router.get('/debug/proxmox-hosts', async (req, res) => {
  try {
    const allHosts = await hostsModel.getProxmoxHosts();
    res.json({ count: allHosts.length, hosts: allHosts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint to check specific host
router.get('/debug/host/:ip', async (req, res) => {
  try {
    const pool = require('../db/pool');
    const result = await pool.query(`
      SELECT id, host(ip_address) as ip, hostname, device_type, os_guess,
             proxmox_api_host, 
             CASE WHEN proxmox_api_token_id IS NOT NULL THEN CONCAT('SET (', LENGTH(proxmox_api_token_id), ' chars)') ELSE 'NULL' END as token_id,
             CASE WHEN proxmox_api_token_secret IS NOT NULL THEN CONCAT('SET (', LENGTH(proxmox_api_token_secret), ' chars)') ELSE 'NULL' END as token_secret
      FROM hosts 
      WHERE host(ip_address) = $1
    `, [req.params.ip]);
    res.json({ found: result.rows.length > 0, host: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
