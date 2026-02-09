const pool = require('../db/pool');

async function create(network) {
  const res = await pool.query(
    `INSERT INTO scans (network, status) VALUES ($1, 'running') RETURNING *`,
    [network]
  );
  return res.rows[0];
}

async function finish(id, hostsFound, servicesFound, error) {
  await pool.query(
    `UPDATE scans SET status = $2, hosts_found = $3, services_found = $4,
     finished_at = NOW(), error = $5 WHERE id = $1`,
    [id, error ? 'error' : 'completed', hostsFound, servicesFound, error]
  );
}

async function getRecent(limit = 20) {
  const res = await pool.query(
    'SELECT * FROM scans ORDER BY started_at DESC LIMIT $1', [limit]
  );
  return res.rows;
}

async function getLatest() {
  const res = await pool.query(
    'SELECT * FROM scans ORDER BY started_at DESC LIMIT 1'
  );
  return res.rows[0];
}

async function cleanupStale() {
  const res = await pool.query(
    `UPDATE scans SET status = 'error', error = 'Server restarted during scan', finished_at = NOW()
     WHERE status = 'running' RETURNING id`
  );
  return res.rowCount;
}

module.exports = { create, finish, getRecent, getLatest, cleanupStale };
