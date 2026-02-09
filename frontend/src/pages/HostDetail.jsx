import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Server, ExternalLink, Trash2 } from 'lucide-react';
import { api } from '../api';

function HostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [host, setHost] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getHost(id)
      .then(setHost)
      .catch(() => navigate('/hosts'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="loading"><div className="spinner" />Lade Host-Details...</div>;
  }

  if (!host) return null;

  const openServices = (host.services || []).filter(s => s.state === 'open');

  const deleteHost = async () => {
    if (!confirm(`Host ${host.hostname || host.ip} wirklich loeschen?`)) return;
    try {
      await api.deleteHost(id);
      navigate('/hosts');
    } catch (err) {
      alert(err.message || 'Loeschen fehlgeschlagen');
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
          <ArrowLeft size={16} /> Zurueck
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
            title="Host loeschen"
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
                            <ExternalLink size={14} /> Oeffnen
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
