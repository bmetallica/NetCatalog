const express = require('express');
const router = express.Router();
const hostsModel = require('../models/hosts');
const servicesModel = require('../models/services');
const scansModel = require('../models/scans');
const settingsModel = require('../models/settings');
const { runScan, isScanning, getCurrentScanId } = require('../services/scanner');
const { scheduleFromSettings } = require('../services/scheduler');
const availabilityModel = require('../models/availability');
const topologyModel = require('../models/topology');
const { DEVICE_TYPES } = require('../services/classifier');

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

module.exports = router;
