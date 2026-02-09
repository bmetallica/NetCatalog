import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, Search, Filter } from 'lucide-react';
import { api } from '../api';

function Hosts() {
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();

  useEffect(() => {
    api.getHosts()
      .then(setHosts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading"><div className="spinner" />Lade Hosts...</div>;
  }

  const filtered = hosts.filter((h) => {
    if (filter === 'up' && h.status !== 'up') return false;
    if (filter === 'down' && h.status !== 'down') return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        h.ip?.toLowerCase().includes(s) ||
        h.hostname?.toLowerCase().includes(s) ||
        h.vendor?.toLowerCase().includes(s) ||
        h.os_guess?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Hosts</h2>
          <div className="subtitle">{hosts.length} Hosts katalogisiert</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search
            size={16}
            style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)', color: 'var(--text-muted)'
            }}
          />
          <input
            type="text"
            placeholder="Suche nach IP, Hostname, Hersteller..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '10px 14px 10px 36px',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-input)', color: 'var(--text-primary)',
              fontSize: 14, fontFamily: 'inherit'
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'up', 'down'].map((f) => (
            <button
              key={f}
              className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(f)}
              style={{ padding: '8px 16px' }}
            >
              {f === 'all' ? 'Alle' : f === 'up' ? 'Online' : 'Offline'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <Server size={48} />
          <h3>Keine Hosts gefunden</h3>
          <p>Passen Sie Ihre Suche oder Filter an.</p>
        </div>
      ) : (
        <div className="hosts-grid">
          {filtered.map((host) => (
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
                {host.os_guess && (
                  <span className="tag">
                    {host.os_guess.split(' ').slice(0, 3).join(' ')}
                  </span>
                )}
                {host.vendor && <span className="tag">{host.vendor}</span>}
                {host.mac_address && <span className="tag">{host.mac_address}</span>}
                <span className="tag blue">{host.service_count} Dienste</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default Hosts;
