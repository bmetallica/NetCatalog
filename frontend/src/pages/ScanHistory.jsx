import { useState, useEffect } from 'react';
import { RefreshCw, History } from 'lucide-react';
import { api } from '../api';

function ScanHistory() {
  const [scans, setScans] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [s, status] = await Promise.all([api.getScans(), api.getScanStatus()]);
      setScans(s);
      setScanning(status.scanning);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const startScan = async () => {
    try {
      await api.startScan();
      setScanning(true);
      setTimeout(fetchData, 2000);
    } catch (err) {
      console.error('Scan start failed:', err);
      alert(err.message || 'Scan konnte nicht gestartet werden');
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" />Lade Scan-Verlauf...</div>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Scan-Verlauf</h2>
          <div className="subtitle">{scans.length} Scans durchgeführt</div>
        </div>
        <button
          className="btn btn-primary"
          onClick={startScan}
          disabled={scanning}
        >
          <RefreshCw size={16} />
          {scanning ? 'Scannt...' : 'Scan starten'}
        </button>
      </div>

      {scans.length === 0 ? (
        <div className="card empty-state">
          <History size={48} />
          <h3>Noch keine Scans</h3>
          <p>Starten Sie einen Scan, um Ihr Netzwerk zu katalogisieren.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: '8px 20px' }}>
          {scans.map((scan) => (
            <div key={scan.id} className="scan-item">
              <div className={`scan-status ${scan.status}`} />
              <div className="scan-info">
                <div className="scan-network">{scan.network}</div>
                <div className="scan-time">
                  {new Date(scan.started_at).toLocaleString('de-DE')}
                  {scan.finished_at && (
                    <>
                      {' '}&mdash;{' '}
                      {formatDuration(new Date(scan.finished_at) - new Date(scan.started_at))}
                    </>
                  )}
                </div>
                {scan.error && (
                  <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
                    {scan.error}
                  </div>
                )}
              </div>
              <div className="scan-results">
                <div>{scan.hosts_found} Hosts</div>
                <div>{scan.services_found} Dienste</div>
              </div>
              <span className={`status-badge ${scan.status === 'completed' ? 'up' : scan.status === 'running' ? 'scanning' : 'down'}`}>
                {scan.status === 'completed' ? 'Abgeschlossen' : scan.status === 'running' ? 'Läuft' : 'Fehler'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remaining = s % 60;
  if (m < 60) return `${m}m ${remaining}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default ScanHistory;
