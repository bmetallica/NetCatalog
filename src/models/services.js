const pool = require('../db/pool');

async function upsert(service) {
  await pool.query(
    `INSERT INTO services (host_id, port, protocol, state, service_name, service_product,
       service_version, service_info, banner, http_title, http_server, identified_as, extra_info, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
     ON CONFLICT (host_id, port, protocol) DO UPDATE SET
       state = $4,
       service_name = COALESCE(NULLIF($5, ''), services.service_name),
       service_product = COALESCE(NULLIF($6, ''), services.service_product),
       service_version = COALESCE(NULLIF($7, ''), services.service_version),
       service_info = COALESCE(NULLIF($8, ''), services.service_info),
       banner = COALESCE(NULLIF($9, ''), services.banner),
       http_title = COALESCE(NULLIF($10, ''), services.http_title),
       http_server = COALESCE(NULLIF($11, ''), services.http_server),
       identified_as = COALESCE(NULLIF($12, ''), services.identified_as),
       extra_info = COALESCE($13, services.extra_info),
       last_seen = NOW()`,
    [
      service.hostId, service.port, service.protocol || 'tcp',
      service.state || 'open', service.name, service.product,
      service.version, service.info, service.banner,
      service.httpTitle, service.httpServer, service.identifiedAs,
      JSON.stringify(service.extraInfo || {}),
    ]
  );
}

async function markClosed(hostId, activePorts) {
  // Only mark services as closed if they haven't been seen in the last 2 hours
  // This prevents a single bad scan from wiping out known services
  if (activePorts.length === 0) {
    // Should not be called with empty activePorts (scanner skips this case now)
    // But as a safety net, only close services not seen recently
    await pool.query(
      `UPDATE services SET state = 'closed' WHERE host_id = $1 AND last_seen < NOW() - INTERVAL '2 hours'`,
      [hostId]
    );
  } else {
    await pool.query(
      `UPDATE services SET state = 'closed' WHERE host_id = $1 AND port != ALL($2) AND last_seen < NOW() - INTERVAL '2 hours'`,
      [hostId, activePorts]
    );
  }
}

async function getByHost(hostId) {
  const res = await pool.query(
    'SELECT * FROM services WHERE host_id = $1 ORDER BY port', [hostId]
  );
  return res.rows;
}

module.exports = { upsert, markClosed, getByHost };
