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
};
