const pool = require('../db/pool');

async function upsert(host) {
  const res = await pool.query(
    `INSERT INTO hosts (ip_address, hostname, mac_address, vendor, os_guess, status, last_seen, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (ip_address) DO UPDATE SET
       hostname = COALESCE($2, hosts.hostname),
       mac_address = COALESCE($3, hosts.mac_address),
       vendor = COALESCE($4, hosts.vendor),
       os_guess = COALESCE($5, hosts.os_guess),
       status = $6,
       last_seen = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [host.ip, host.hostname, host.mac, host.vendor, host.os, host.status || 'up']
  );
  return res.rows[0].id;
}

async function getAll() {
  const res = await pool.query(`
    SELECT h.*,
      host(h.ip_address) as ip,
      COUNT(s.id) as service_count
    FROM hosts h
    LEFT JOIN services s ON s.host_id = h.id AND s.state = 'open'
    GROUP BY h.id
    ORDER BY h.ip_address
  `);
  return res.rows;
}

async function getById(id) {
  const hostRes = await pool.query(
    `SELECT h.*, host(h.ip_address) as ip,
      p.hostname as parent_hostname, host(p.ip_address) as parent_ip
     FROM hosts h
     LEFT JOIN hosts p ON h.parent_host_id = p.id
     WHERE h.id = $1`, [id]
  );
  if (!hostRes.rows[0]) return null;

  const servicesRes = await pool.query(
    `SELECT * FROM services WHERE host_id = $1 ORDER BY port`, [id]
  );

  return { ...hostRes.rows[0], services: servicesRes.rows };
}

async function deleteById(id) {
  const res = await pool.query('DELETE FROM hosts WHERE id = $1 RETURNING id', [id]);
  return res.rowCount > 0;
}

async function markDown(hostIds) {
  if (!hostIds.length) return;
  await pool.query(
    `UPDATE hosts SET status = 'down', updated_at = NOW() WHERE id = ANY($1)`,
    [hostIds]
  );
}

async function markDownGraceful(hostIds) {
  if (!hostIds.length) return;
  // Only mark as down if not seen in the last 2 hours (survives ~4 scan cycles)
  const res = await pool.query(
    `UPDATE hosts SET status = 'down', updated_at = NOW()
     WHERE id = ANY($1) AND last_seen < NOW() - INTERVAL '2 hours'
     RETURNING id`,
    [hostIds]
  );
  return res.rowCount;
}

async function getStats() {
  const res = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM hosts WHERE status = 'up') as hosts_up,
      (SELECT COUNT(*) FROM hosts WHERE status = 'down') as hosts_down,
      (SELECT COUNT(*) FROM hosts) as hosts_total,
      (SELECT COUNT(*) FROM services WHERE state = 'open') as services_total,
      (SELECT COUNT(DISTINCT port) FROM services WHERE state = 'open') as unique_ports
  `);
  return res.rows[0];
}

async function getAllIds() {
  const res = await pool.query('SELECT id, host(ip_address) as ip FROM hosts');
  return res.rows;
}

module.exports = { upsert, getAll, getById, deleteById, markDown, markDownGraceful, getStats, getAllIds };
