const pool = require('../db/pool');
const { classifyHost, getGatewayIp, DEVICE_TYPES } = require('../services/classifier');

async function getTopology() {
  const res = await pool.query(`
    SELECT h.*,
      host(h.ip_address) AS ip,
      COALESCE(
        json_agg(
          json_build_object(
            'port', s.port,
            'state', s.state,
            'service_name', s.service_name,
            'identified_as', s.identified_as,
            'service_product', s.service_product,
            'extra_info', s.extra_info
          )
        ) FILTER (WHERE s.id IS NOT NULL AND s.state = 'open'),
        '[]'
      ) AS services
    FROM hosts h
    LEFT JOIN services s ON s.host_id = h.id
    GROUP BY h.id
    ORDER BY h.ip_address
  `);

  const gatewayIp = await getGatewayIp();

  const hosts = res.rows.map(row => {
    const services = typeof row.services === 'string' ? JSON.parse(row.services) : row.services;
    const classification = classifyHost(row, services);

    let computedType = classification.type;
    if (row.ip === gatewayIp && !row.device_type) {
      computedType = 'gateway';
    }

    return {
      id: row.id,
      ip: row.ip,
      hostname: row.hostname,
      mac_address: row.mac_address,
      vendor: row.vendor,
      os_guess: row.os_guess,
      status: row.status,
      device_type: row.device_type,
      computed_type: computedType,
      classification_reason: row.ip === gatewayIp && !row.device_type
        ? 'Standard-Gateway' : classification.reason,
      classification_confidence: row.ip === gatewayIp && !row.device_type
        ? 99 : classification.confidence,
      parent_host_id: row.parent_host_id,
      discovery_info: row.discovery_info || null,
      service_count: services.length,
      proxmox_api_host: row.proxmox_api_host,
      proxmox_api_token_id: row.proxmox_api_token_id,
      proxmox_api_token_secret: row.proxmox_api_token_secret,
      fritzbox_host: row.fritzbox_host,
      fritzbox_username: row.fritzbox_username,
      fritzbox_password: row.fritzbox_password,
    };
  });

  return { hosts, gatewayIp, deviceTypes: DEVICE_TYPES };
}

async function updateClassification(hostId, deviceType, parentHostId) {
  const exists = await pool.query('SELECT id FROM hosts WHERE id = $1', [hostId]);
  if (exists.rows.length === 0) return null;

  if (parentHostId !== undefined && parentHostId !== null) {
    if (parentHostId === hostId) throw new Error('Host kann nicht sein eigener Parent sein');
    const parentExists = await pool.query('SELECT id FROM hosts WHERE id = $1', [parentHostId]);
    if (parentExists.rows.length === 0) throw new Error('Parent-Host nicht gefunden');
  }

  const sets = [];
  const params = [];
  let idx = 1;

  if (deviceType !== undefined) {
    sets.push(`device_type = $${idx++}`);
    params.push(deviceType);
  }
  if (parentHostId !== undefined) {
    sets.push(`parent_host_id = $${idx++}`);
    params.push(parentHostId);
  }

  if (sets.length === 0) return null;

  sets.push('updated_at = NOW()');
  params.push(hostId);

  const res = await pool.query(
    `UPDATE hosts SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );

  return res.rows[0];
}

module.exports = { getTopology, updateClassification };
