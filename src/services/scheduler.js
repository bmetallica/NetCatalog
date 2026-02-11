const cron = require('node-cron');
const settingsModel = require('../models/settings');
const { runScan, isScanning, runDeepDiscoveryStandalone, isDiscoveryRunning } = require('./scanner');

let currentJob = null;
let discoveryJob = null;

async function start() {
  await scheduleFromSettings();
  await scheduleDeepDiscovery();
  console.log('[Scheduler] Started');
}

async function scheduleFromSettings() {
  const enabled = await settingsModel.get('scan_enabled');
  if (enabled === 'false') {
    stopScanSchedule();
    console.log('[Scheduler] Automatic scanning disabled');
    return;
  }

  const rawInterval = parseInt(await settingsModel.get('scan_interval') || '30', 10);
  const interval = (isNaN(rawInterval) || rawInterval < 1 || rawInterval > 1440) ? 30 : rawInterval;
  const cronExpr = `*/${interval} * * * *`;

  if (currentJob) {
    currentJob.stop();
  }

  currentJob = cron.schedule(cronExpr, async () => {
    if (isScanning()) {
      console.log('[Scheduler] Scan already in progress, skipping scheduled scan');
      return;
    }
    try {
      console.log('[Scheduler] Starting scheduled scan');
      await runScan();
    } catch (err) {
      console.error('[Scheduler] Scheduled scan failed:', err.message);
    }
  });

  console.log(`[Scheduler] Scheduled scans every ${interval} minutes`);
}

async function scheduleDeepDiscovery() {
  const enabled = await settingsModel.get('deep_discovery_enabled');
  if (enabled === 'false') {
    stopDeepDiscoverySchedule();
    console.log('[Scheduler] Automatic Deep Discovery disabled');
    return;
  }

  const rawInterval = parseInt(await settingsModel.get('deep_discovery_interval') || '60', 10);
  const interval = (isNaN(rawInterval) || rawInterval < 5 || rawInterval > 1440) ? 60 : rawInterval;
  const cronExpr = `*/${interval} * * * *`;

  if (discoveryJob) {
    discoveryJob.stop();
  }

  discoveryJob = cron.schedule(cronExpr, async () => {
    if (isDiscoveryRunning()) {
      console.log('[Scheduler] Deep Discovery already in progress, skipping');
      return;
    }
    try {
      console.log('[Scheduler] Starting scheduled Deep Discovery');
      await runDeepDiscoveryStandalone();
    } catch (err) {
      console.error('[Scheduler] Scheduled Deep Discovery failed:', err.message);
    }
  });

  console.log(`[Scheduler] Scheduled Deep Discovery every ${interval} minutes`);
}

function stopScanSchedule() {
  if (currentJob) {
    currentJob.stop();
    currentJob = null;
  }
}

function stopDeepDiscoverySchedule() {
  if (discoveryJob) {
    discoveryJob.stop();
    discoveryJob = null;
  }
}

function stop() {
  stopScanSchedule();
  stopDeepDiscoverySchedule();
}

module.exports = { start, scheduleFromSettings, scheduleDeepDiscovery, stop };
