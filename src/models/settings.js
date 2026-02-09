const pool = require('../db/pool');

async function get(key) {
  const res = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return res.rows[0]?.value;
}

async function getAll() {
  const res = await pool.query('SELECT key, value, description, updated_at FROM settings ORDER BY key');
  return res.rows;
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

module.exports = { get, getAll, set };
