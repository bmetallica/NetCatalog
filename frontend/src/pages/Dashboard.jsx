import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server, Wifi, WifiOff, Radio, Globe, RefreshCw
} from 'lucide-react';
import { api } from '../api';

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const [s, h] = await Promise.all([api.getStats(), api.getHosts()]);
      setStats(s);
      setHosts(h);
      setScanning(s.scanning);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const startScan = async () => {
    try {
      await api.startScan();
      setScanning(true);
    } catch (err) {
      console.error('Scan start failed:', err);
      alert(err.message || 'Scan konnte nicht gestartet werden');
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Lade Daten...
      </div>
    );
  }

  const recentHosts = hosts
    .filter(h => h.status === 'up')
    .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen))
    .slice(0, 8);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <div className="subtitle">
            Netzwerk-Uebersicht
            {stats?.latestScan && (
              <> &middot; Letzter Scan: {new Date(stats.latestScan.finished_at || stats.latestScan.started_at).toLocaleString('de-DE')}</>
            )}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={startScan}
          disabled={scanning}
        >
          <RefreshCw size={16} className={scanning ? 'spinning' : ''} />
          {scanning ? 'Scannt...' : 'Scan starten'}
        </button>
      </div>

      <div className="stats-grid">
        <div className="card stat-card">
          <div className="stat-icon blue"><Server size={22} /></div>
          <div>
            <div className="stat-value">{stats?.hosts_total || 0}</div>
            <div className="stat-label">Hosts gesamt</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon green"><Wifi size={22} /></div>
          <div>
            <div className="stat-value">{stats?.hosts_up || 0}</div>
            <div className="stat-label">Hosts online</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon red"><WifiOff size={22} /></div>
          <div>
            <div className="stat-value">{stats?.hosts_down || 0}</div>
            <div className="stat-label">Hosts offline</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon cyan"><Radio size={22} /></div>
          <div>
            <div className="stat-value">{stats?.services_total || 0}</div>
            <div className="stat-label">Offene Dienste</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon yellow"><Globe size={22} /></div>
          <div>
            <div className="stat-value">{stats?.unique_ports || 0}</div>
            <div className="stat-label">Einzigartige Ports</div>
          </div>
        </div>
      </div>

      <h3 style={{ marginBottom: 16, fontSize: 18, fontWeight: 600 }}>
        Zuletzt gesehene Hosts
      </h3>
      {recentHosts.length === 0 ? (
        <div className="card empty-state">
          <Server size={48} />
          <h3>Keine Hosts gefunden</h3>
          <p>Starten Sie einen Scan, um Ihr Netzwerk zu katalogisieren.</p>
        </div>
      ) : (
        <div className="hosts-grid">
          {recentHosts.map((host) => (
            <div
              key={host.id}
              className="card card-clickable host-card"
              onClick={() => navigate(`/hosts/${host.id}`)}
            >
              <div className="host-header">
                <div className={`host-avatar ${host.status}`}>
                  <Server size={20} />
                </div>
                <div className="host-info">
                  <h3>{host.hostname || host.ip}</h3>
                  <div className="host-ip">{host.ip}</div>
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <span className={`status-badge ${host.status}`}>
                    <span className="status-dot" />
                    {host.status === 'up' ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
              <div className="host-meta">
                {host.os_guess && <span className="tag">{host.os_guess.split(' ').slice(0,3).join(' ')}</span>}
                {host.vendor && <span className="tag">{host.vendor}</span>}
                <span className="tag blue">{host.service_count} Dienste</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`.spinning { animation: spin 1s linear infinite; }`}</style>
    </>
  );
}

export default Dashboard;
