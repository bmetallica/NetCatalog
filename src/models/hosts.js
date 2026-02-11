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

  const host = { ...hostRes.rows[0], services: servicesRes.rows };
  
  // Include Proxmox credentials if present
  if (host.proxmox_api_host) {
    host.proxmox_api_host = host.proxmox_api_host;
    host.proxmox_api_token_id = host.proxmox_api_token_id;
    host.proxmox_api_token_secret = host.proxmox_api_token_secret;
  }

  return host;
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

async function updateProxmoxCredentials(hostId, credentials) {
  console.log(`[updateProxmoxCredentials] Host ${hostId}:`, {
    api_host: credentials.api_host,
    has_token_id: !!credentials.token_id,
    has_token_secret: !!credentials.token_secret
  });
  
  // Set device_type to hypervisor when Proxmox credentials are saved
  const res = await pool.query(
    `UPDATE hosts SET 
      proxmox_api_host = $1,
      proxmox_api_token_id = $2,
      proxmox_api_token_secret = $3,
      device_type = COALESCE(device_type, 'hypervisor'),
      updated_at = NOW()
     WHERE id = $4
     RETURNING id, device_type`,
    [credentials.api_host, credentials.token_id, credentials.token_secret, hostId]
  );
  
  if (res.rows.length > 0) {
    console.log(`[updateProxmoxCredentials] Updated host ${hostId}, device_type set to '${res.rows[0].device_type}'`);
  }
  
  return res.rowCount > 0;
}

async function updateFritzBoxCredentials(hostId, credentials) {
  console.log(`[updateFritzBoxCredentials] Host ${hostId}:`, {
    fritzbox_host: credentials.fritzbox_host,
    has_username: !!credentials.fritzbox_username,
    has_password: !!credentials.fritzbox_password
  });
  
  // Set device_type to router/gateway when FritzBox credentials are saved
  const res = await pool.query(
    `UPDATE hosts SET 
      fritzbox_host = $1,
      fritzbox_username = $2,
      fritzbox_password = $3,
      device_type = COALESCE(device_type, 'gateway'),
      updated_at = NOW()
     WHERE id = $4
     RETURNING id, device_type`,
    [credentials.fritzbox_host, credentials.fritzbox_username, credentials.fritzbox_password, hostId]
  );
  
  if (res.rows.length > 0) {
    console.log(`[updateFritzBoxCredentials] Updated host ${hostId}, device_type set to '${res.rows[0].device_type}'`);
  }
  
  return res.rowCount > 0;
}

async function getProxmoxHosts() {
  console.log('[getProxmoxHosts] Querying for Proxmox hosts...');
  const res = await pool.query(`
    SELECT id, host(ip_address) as ip, hostname, device_type, os_guess,
           proxmox_api_host, proxmox_api_token_id, proxmox_api_token_secret
    FROM hosts 
    WHERE proxmox_api_host IS NOT NULL
      AND proxmox_api_token_id IS NOT NULL
      AND proxmox_api_token_secret IS NOT NULL
  `);
  console.log(`[getProxmoxHosts] Found ${res.rows.length} hosts:`, res.rows.map(h => ({ id: h.id, ip: h.ip, hostname: h.hostname, device_type: h.device_type, has_api_host: !!h.proxmox_api_host })));
  return res.rows;
}

async function getFritzBoxHosts() {
  console.log('[getFritzBoxHosts] Querying for FritzBox hosts...');
  const res = await pool.query(`
    SELECT id, host(ip_address) as ip, hostname, device_type, os_guess,
           fritzbox_host, fritzbox_username, fritzbox_password
    FROM hosts 
    WHERE fritzbox_host IS NOT NULL
      AND fritzbox_username IS NOT NULL
      AND fritzbox_password IS NOT NULL
  `);
  console.log(`[getFritzBoxHosts] Found ${res.rows.length} hosts:`, res.rows.map(h => ({ id: h.id, ip: h.ip, hostname: h.hostname, device_type: h.device_type, has_fritzbox: !!h.fritzbox_host })));
  return res.rows;
}

module.exports = { 
  upsert, getAll, getById, deleteById, markDown, markDownGraceful, getStats, getAllIds,
  updateProxmoxCredentials, getProxmoxHosts, getFritzBoxHosts, updateFritzBoxCredentials
};
