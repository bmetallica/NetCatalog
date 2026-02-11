/**
 * UISP (Ubiquiti ISP) / UNMS API Client
 *
 * Communicates with UISP controller via its REST API using curl.
 * Uses API token authentication (x-auth-token header).
 * Self-signed certificates are accepted (-k flag).
 * No additional npm packages required.
 */

const { execFile } = require('child_process');

function curlRequest(url, opts = {}) {
  return new Promise((resolve) => {
    const args = [
      '-s',                              // silent
      '-i',                              // include response headers
      '-k',                              // accept self-signed certs
      '--max-time', String(opts.timeout || 10),
      '--connect-timeout', '5',
    ];

    if (opts.token) {
      args.push('-H', `x-auth-token: ${opts.token}`);
    }

    if (opts.method === 'POST') {
      args.push('-X', 'POST');
    }

    if (opts.body) {
      args.push('-H', 'Content-Type: application/json');
      args.push('-d', opts.body);
    }

    args.push(url);

    execFile('curl', args, {
      maxBuffer: 2 * 1024 * 1024,
      timeout: (opts.timeout || 10) * 1000 + 5000,
    }, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve({ error: err.message, status: 0, headers: '', body: '' });
        return;
      }

      // Split headers from body
      const headerEndIdx = stdout.indexOf('\r\n\r\n');
      if (headerEndIdx === -1) {
        resolve({ error: 'No response headers', status: 0, headers: '', body: '' });
        return;
      }

      const headers = stdout.substring(0, headerEndIdx);
      const body = stdout.substring(headerEndIdx + 4);

      // Extract status code
      const statusMatch = headers.match(/HTTP\/[\d.]+ (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 0;

      let json = null;
      try { json = JSON.parse(body); } catch {}

      resolve({ status, headers, body, json });
    });
  });
}

/**
 * Get all UISP devices (APs, switches, bridges).
 * Returns array of { id, mac, name, model, modelName, ip, ssid, stationsCount, status, type }
 */
async function getDevices(baseUrl, token) {
  const res = await curlRequest(`${baseUrl}/nms/api/v2.1/devices`, {
    token,
    timeout: 15,
  });

  if (res.status === 401) throw new Error('Ungültiger API-Token');
  if (res.status !== 200 || !res.json) {
    if (res.status === 0) throw new Error('Controller nicht erreichbar');
    throw new Error(`Geräte abrufen fehlgeschlagen: HTTP ${res.status}`);
  }

  const data = Array.isArray(res.json) ? res.json : [];
  return data.map(d => {
    const ident = d.identification || {};
    const overview = d.overview || {};
    const attrs = d.attributes || {};
    const ipRaw = d.ipAddress || '';
    return {
      id: ident.id,
      mac: ident.mac || null,
      name: ident.name || null,
      model: ident.model || null,
      modelName: ident.modelName || null,
      firmware: ident.firmwareVersion || null,
      ip: ipRaw.split('/')[0] || null,  // strip CIDR suffix
      ssid: attrs.ssid || null,
      stationsCount: overview.stationsCount || 0,
      status: overview.status || null,   // active, disconnected
      signal: overview.signal || null,
    };
  });
}

/**
 * Get stations (WLAN clients) for a specific device.
 * UISP devices can be aircubes or airmaxes — try both.
 * Returns array of { mac, ip, vendor, radio, signal, uptime }
 */
async function getStationsForDevice(baseUrl, token, deviceId) {
  // Try aircubes first (airCube APs), then airmaxes (NanoStation etc.)
  for (const type of ['aircubes', 'airmaxes']) {
    const res = await curlRequest(
      `${baseUrl}/nms/api/v2.1/devices/${type}/${deviceId}/stations`,
      { token, timeout: 15 }
    );

    if (res.status === 200 && Array.isArray(res.json)) {
      return res.json.map(s => ({
        mac: s.mac || null,
        ip: s.ipAddress || null,
        name: s.name || null,
        vendor: s.vendor || null,
        radio: s.radio || null,
        signal: s.txSignal || null,
        uptime: s.uptime ? Math.round(parseFloat(s.uptime)) : null,
        interfaceId: s.interfaceId || null,
      }));
    }
  }

  return [];
}

/**
 * Get all devices + all their stations.
 * Returns { devices, stationsByDeviceId }
 */
async function getDevicesWithStations(baseUrl, token) {
  const devices = await getDevices(baseUrl, token);

  // Fetch stations for all active devices in parallel
  const activeDevices = devices.filter(d => d.status === 'active' && d.id);
  const stationResults = await Promise.allSettled(
    activeDevices.map(d => getStationsForDevice(baseUrl, token, d.id))
  );

  const stationsByDeviceId = new Map();
  for (let i = 0; i < activeDevices.length; i++) {
    if (stationResults[i].status === 'fulfilled') {
      stationsByDeviceId.set(activeDevices[i].id, stationResults[i].value);
    }
  }

  return { devices, stationsByDeviceId };
}

/**
 * Test connection to UISP controller.
 * Returns { success, deviceCount, clientCount } or throws on error.
 */
async function testConnection(url, token) {
  const baseUrl = url.replace(/\/+$/, '');
  const { devices, stationsByDeviceId } = await getDevicesWithStations(baseUrl, token);

  let totalClients = 0;
  for (const stations of stationsByDeviceId.values()) {
    totalClients += stations.length;
  }

  return {
    success: true,
    deviceCount: devices.length,
    clientCount: totalClients,
  };
}

module.exports = {
  getDevices,
  getStationsForDevice,
  getDevicesWithStations,
  testConnection,
};
