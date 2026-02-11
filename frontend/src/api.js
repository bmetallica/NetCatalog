const BASE = '/api';

async function fetchJson(url, options = {}) {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  getStats: () => fetchJson('/stats'),
  getHosts: () => fetchJson('/hosts'),
  getHost: (id) => fetchJson(`/hosts/${id}`),
  deleteHost: (id) => fetchJson(`/hosts/${id}`, { method: 'DELETE' }),
  getScans: () => fetchJson('/scans'),
  getScanStatus: () => fetchJson('/scans/status'),
  startScan: () => fetchJson('/scans/start', { method: 'POST' }),
  getSettings: () => fetchJson('/settings'),
  updateSettings: (settings) =>
    fetchJson('/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),
  getAvailability: (date) => fetchJson(`/availability?date=${date}`),
  getTopology: () => fetchJson('/topology'),
  classifyHost: (id, data) =>
    fetchJson(`/hosts/${id}/classify`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getDeviceTypes: () => fetchJson('/device-types'),
  runDiscovery: () => fetchJson('/discovery/run', { method: 'POST' }),
  testUnifi: (url, token) =>
    fetchJson('/unifi/test', {
      method: 'POST',
      body: JSON.stringify({ url, token }),
    }),
  updateProxmoxCredentials: (id, credentials) =>
    fetchJson(`/hosts/${id}/proxmox`, {
      method: 'PUT',
      body: JSON.stringify(credentials),
    }),
  testProxmoxConnection: (credentials) =>
    fetchJson('/proxmox/test', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  updateFritzBoxCredentials: (id, credentials) =>
    fetchJson(`/hosts/${id}/fritzbox`, {
      method: 'PUT',
      body: JSON.stringify(credentials),
    }),
  testFritzBoxConnection: (credentials) =>
    fetchJson('/fritzbox/test', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
};
