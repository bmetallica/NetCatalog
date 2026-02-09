require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
const scheduler = require('./services/scheduler');
const scansModel = require('./models/scans');
const pool = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100kb' }));

// API routes
app.use('/api', apiRoutes);

// API 404 handler (before SPA catch-all)
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`NetCatalog server running on port ${PORT}`);

  // Cleanup stale running scans from previous crashes
  const cleaned = await scansModel.cleanupStale();
  if (cleaned > 0) {
    console.log(`[Startup] Cleaned up ${cleaned} stale running scan(s)`);
  }

  // Start scheduler
  await scheduler.start();
  console.log('Scheduler initialized');
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`[Shutdown] ${signal} received, shutting down gracefully...`);
  scheduler.stop();
  server.close(() => {
    pool.end().then(() => {
      console.log('[Shutdown] Complete');
      process.exit(0);
    });
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
