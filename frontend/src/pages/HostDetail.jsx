import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Server, ExternalLink, Trash2 } from 'lucide-react';
import { api } from '../api';

function HostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [host, setHost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [allHosts, setAllHosts] = useState([]);

  useEffect(() => {
    Promise.all([
      api.getHost(id),
      api.getDeviceTypes(),
      api.getHosts(),
    ]).then(([h, dt, hosts]) => {
      setHost(h);
      setDeviceTypes(dt);
      setAllHosts(hosts);
    }).catch(() => navigate('/hosts'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleClassify = async (field, value) => {
    try {
      const data = {};
      if (field === 'device_type') data.device_type = value || null;
      if (field === 'parent_host_id') data.parent_host_id = value ? parseInt(value) : null;
      await api.classifyHost(id, data);
      const updated = await api.getHost(id);
      setHost(updated);
    } catch (err) {
      console.error('Classify failed:', err);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" />Lade Host-Details...</div>;
  }

  if (!host) return null;

  const openServices = (host.services || []).filter(s => s.state === 'open');

  const deleteHost = async () => {
    if (!confirm(`Host ${host.hostname || host.ip} wirklich löschen?`)) return;
    try {
      await api.deleteHost(id);
      navigate('/hosts');
    } catch (err) {
      alert(err.message || 'Löschen fehlgeschlagen');
    }
  };

  const getServiceLink = (service) => {
    const port = service.port;
    const extra = service.extra_info || {};
    const isHttps = extra.protocol === 'https' ||
      service.service_name?.match(/ssl|https/i) ||
      service.identified_as?.match(/HTTPS/i);
    const isHttp = extra.protocol === 'http' ||
      service.service_name?.match(/http/i) ||
      service.http_title;

    if (isHttps) return `https://${host.ip}:${port}`;
    if (isHttp) return `http://${host.ip}:${port}`;
    return null;
  };

  return (
    <>
      <div className="host-detail-header">
        <button className="back-btn" onClick={() => navigate('/hosts')}>
          <ArrowLeft size={16} /> Zurück
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className={`host-avatar ${host.status}`} style={{ width: 52, height: 52 }}>
            <Server size={24} />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>{host.hostname || host.ip}</h2>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14, fontFamily: 'monospace' }}>
              {host.ip}
            </div>
          </div>
          <span className={`status-badge ${host.status}`} style={{ marginLeft: 8 }}>
            <span className="status-dot" />
            {host.status === 'up' ? 'Online' : 'Offline'}
          </span>
          <button
            className="btn btn-secondary"
            style={{ marginLeft: 'auto', color: 'var(--danger)', padding: '8px 14px' }}
            onClick={deleteHost}
            title="Host löschen"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="info-grid">
          <div className="info-item">
            <label>IP-Adresse</label>
            <div className="value" style={{ fontFamily: 'monospace' }}>{host.ip}</div>
          </div>
          <div className="info-item">
            <label>Hostname</label>
            <div className="value">{host.hostname || '-'}</div>
          </div>
          <div className="info-item">
            <label>MAC-Adresse</label>
            <div className="value" style={{ fontFamily: 'monospace' }}>{host.mac_address || '-'}</div>
          </div>
          <div className="info-item">
            <label>Hersteller</label>
            <div className="value">{host.vendor || '-'}</div>
          </div>
          <div className="info-item">
            <label>Betriebssystem</label>
            <div className="value">{host.os_guess || '-'}</div>
          </div>
          <div className="info-item">
            <label>Zuerst gesehen</label>
            <div className="value">{new Date(host.first_seen).toLocaleString('de-DE')}</div>
          </div>
          <div className="info-item">
            <label>Zuletzt gesehen</label>
            <div className="value">{new Date(host.last_seen).toLocaleString('de-DE')}</div>
          </div>
          <div className="info-item">
            <label>Offene Dienste</label>
            <div className="value">{openServices.length}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Klassifizierung</h3>
        <div className="info-grid">
          <div className="info-item">
            <label>Gerätetyp</label>
            <select
              value={host.device_type || ''}
              onChange={(e) => handleClassify('device_type', e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">
                Automatisch ({deviceTypes.find(d => d.value === host.computed_type)?.label || host.computed_type || 'Unbekannt'})
              </option>
              {deviceTypes.map(dt => (
                <option key={dt.value} value={dt.value}>{dt.label}</option>
              ))}
            </select>
            {!host.device_type && host.classification_reason && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {host.classification_reason} ({host.classification_confidence}%)
              </div>
            )}
          </div>
          <div className="info-item">
            <label>Übergeordnetes Gerät</label>
            <select
              value={host.parent_host_id || ''}
              onChange={(e) => handleClassify('parent_host_id', e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Kein (direkt am Gateway)</option>
              {allHosts
                .filter(h => h.id !== host.id)
                .map(h => (
                  <option key={h.id} value={h.id}>
                    {h.hostname || h.ip} ({h.ip})
                  </option>
                ))}
            </select>
            {host.parent_host_id && host.parent_hostname && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Aktuell: {host.parent_hostname} ({host.parent_ip})
              </div>
            )}
            {host.parent_host_id && !host.parent_hostname && host.parent_ip && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Aktuell: {host.parent_ip}
              </div>
            )}
          </div>
        </div>
      </div>

      <h3 style={{ marginBottom: 16, fontSize: 18, fontWeight: 600 }}>
        Dienste ({openServices.length})
      </h3>

      {openServices.length === 0 ? (
        <div className="card empty-state">
          <h3>Keine offenen Dienste</h3>
          <p>Auf diesem Host wurden keine offenen Ports erkannt.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="services-table-wrapper">
            <table className="services-table">
              <thead>
                <tr>
                  <th>Port</th>
                  <th>Erkannter Dienst</th>
                  <th>Produkt / Version</th>
                  <th>HTTP-Titel</th>
                  <th>Banner</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {openServices.map((svc) => {
                  const link = getServiceLink(svc);
                  return (
                    <tr key={`${svc.port}-${svc.protocol}`}>
                      <td className="port-cell">
                        {svc.port}/{svc.protocol}
                      </td>
                      <td className="identified">
                        {svc.identified_as || svc.service_name || '-'}
                      </td>
                      <td>
                        {svc.service_product
                          ? `${svc.service_product}${svc.service_version ? ' ' + svc.service_version : ''}`
                          : '-'}
                      </td>
                      <td>
                        {svc.http_title || '-'}
                      </td>
                      <td>
                        <div className="banner-text" title={svc.banner}>
                          {svc.banner || '-'}
                        </div>
                      </td>
                      <td>
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink size={14} /> Öffnen
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export default HostDetail;
