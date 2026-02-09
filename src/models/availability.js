const pool = require('../db/pool');

async function recordBatch(records, checkedAt) {
  if (records.length === 0) return;

  const values = [];
  const params = [];
  let idx = 1;

  for (const r of records) {
    values.push(`($${idx++}, $${idx++}, $${idx++})`);
    params.push(r.hostId, checkedAt || new Date(), r.status);
  }

  await pool.query(
    `INSERT INTO host_availability (host_id, checked_at, status) VALUES ${values.join(', ')}`,
    params
  );
}

async function getByDay(date) {
  const res = await pool.query(
    `SELECT h.id AS host_id, h.ip_address, h.hostname,
       json_agg(json_build_object('checked_at', ha.checked_at, 'status', ha.status) ORDER BY ha.checked_at) AS checks
     FROM host_availability ha
     JOIN hosts h ON h.id = ha.host_id
     WHERE ha.checked_at >= $1::date AND ha.checked_at < ($1::date + INTERVAL '1 day')
     GROUP BY h.id, h.ip_address, h.hostname
     ORDER BY h.ip_address`,
    [date]
  );
  return res.rows;
}

async function cleanup(days) {
  await pool.query(
    `DELETE FROM host_availability WHERE checked_at < NOW() - ($1 || ' days')::INTERVAL`,
    [String(days)]
  );
}

module.exports = { recordBatch, getByDay, cleanup };
