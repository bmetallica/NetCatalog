const cron = require('node-cron');
const settingsModel = require('../models/settings');
const { runScan, isScanning } = require('./scanner');

let currentJob = null;

async function start() {
  await scheduleFromSettings();
  console.log('[Scheduler] Started');
}

async function scheduleFromSettings() {
  const enabled = await settingsModel.get('scan_enabled');
  if (enabled === 'false') {
    stop();
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

function stop() {
  if (currentJob) {
    currentJob.stop();
    currentJob = null;
  }
}

module.exports = { start, scheduleFromSettings, stop };
