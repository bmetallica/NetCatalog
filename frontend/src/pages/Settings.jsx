import { useState, useEffect } from 'react';
import { Save, Check, Wifi, CheckCircle, AlertCircle, Loader, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';

function Settings() {
  const [settings, setSettings] = useState({});
  const [networks, setNetworks] = useState(['']);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showUnifi, setShowUnifi] = useState(false);
  const [unifiDetectedUrl, setUnifiDetectedUrl] = useState('');
  const [unifiTesting, setUnifiTesting] = useState(false);
  const [unifiTestResult, setUnifiTestResult] = useState(null);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getTopology()])
      .then(([data, topology]) => {
        const obj = {};
        data.forEach((s) => { obj[s.key] = s.value; });
        setSettings(obj);

        // Parse scan_network into array
        const nets = (obj.scan_network || '').split(',').map(s => s.trim()).filter(Boolean);
        setNetworks(nets.length > 0 ? nets : ['']);

        // Show UniFi section if any Ubiquiti device found, or UniFi service detected, or already configured
        const hasConfig = obj.unifi_url && obj.unifi_url.length > 0;
        const hosts = topology.hosts || [];
        const ubiquitiHost = hosts.find(h => /ubiquiti/i.test(h.vendor || ''));
        const unifiServiceHost = hosts.find(h =>
          (h.services || []).some(s => /unifi/i.test(s.identified_as || '') || /unifi/i.test(s.service_name || ''))
        );
        if (unifiServiceHost) {
          const svc = (unifiServiceHost.services || []).find(s => /unifi/i.test(s.identified_as || '') || /unifi/i.test(s.service_name || ''));
          setUnifiDetectedUrl(`https://${unifiServiceHost.ip}:${svc?.port || 8443}`);
        }
        setShowUnifi(hasConfig || !!ubiquitiHost || !!unifiServiceHost);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const validNets = networks.map(n => n.trim()).filter(Boolean);
      const merged = { ...settings, scan_network: validNets.join(',') };
      await api.updateSettings(merged);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const updateNetwork = (index, value) => {
    setNetworks(prev => prev.map((n, i) => i === index ? value : n));
  };

  const addNetwork = () => setNetworks(prev => [...prev, '']);

  const removeNetwork = (index) => {
    setNetworks(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
  };

  const update = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleUnifiTest = async () => {
    const url = settings.unifi_url || '';
    const token = settings.unifi_token || '';
    if (!url || !token) {
      setUnifiTestResult({ success: false, error: 'URL und API-Token erforderlich' });
      return;
    }
    setUnifiTesting(true);
    setUnifiTestResult(null);
    try {
      const result = await api.testUnifi(url, token);
      setUnifiTestResult(result);
    } catch (err) {
      setUnifiTestResult({ success: false, error: err.message });
    } finally {
      setUnifiTesting(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" />Lade Einstellungen...</div>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Einstellungen</h2>
          <div className="subtitle">Scan-Konfiguration anpassen</div>
        </div>
      </div>

      <div className="card settings-form">
        <div className="form-group">
          <label>Netzwerke (CIDR)</label>
          {networks.map((net, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input
                type="text"
                value={net}
                onChange={(e) => updateNetwork(i, e.target.value)}
                placeholder="z.B. 192.168.1.0/24"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => removeNetwork(i)}
                disabled={networks.length <= 1}
                style={{ padding: '6px 10px', flexShrink: 0 }}
                title="Netzwerk entfernen"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={addNetwork}
            style={{ marginTop: 4 }}
          >
            <Plus size={14} /> Netzwerk hinzufügen
          </button>
          <div className="hint" style={{ marginTop: 6 }}>
            Zu scannende Netzwerke im CIDR-Format. Mehrere Netzwerke werden nacheinander gescannt.
          </div>
        </div>

        <div className="form-group">
          <label>Port-Bereich</label>
          <input
            type="text"
            value={settings.scan_ports || ''}
            onChange={(e) => update('scan_ports', e.target.value)}
            placeholder="z.B. 1-10000"
          />
          <div className="hint">
            Zu scannende Ports, z.B. 1-1024, 1-65535 oder 22,80,443,8006,8080
          </div>
        </div>

        <div className="form-group">
          <label>Scan-Intervall (Minuten)</label>
          <input
            type="number"
            min="1"
            max="1440"
            value={settings.scan_interval || ''}
            onChange={(e) => update('scan_interval', e.target.value)}
          />
          <div className="hint">
            Wie oft das Netzwerk automatisch gescannt wird (1-1440 Minuten)
          </div>
        </div>

        <div className="form-group">
          <label>Automatisches Scannen</label>
          <select
            value={settings.scan_enabled || 'true'}
            onChange={(e) => update('scan_enabled', e.target.value)}
          >
            <option value="true">Aktiviert</option>
            <option value="false">Deaktiviert</option>
          </select>
          <div className="hint">
            Aktivieren oder deaktivieren Sie das automatische periodische Scannen
          </div>
        </div>

        <div className="settings-separator" />
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--text-secondary)' }}>
          Deep Discovery
        </h3>

        <div className="form-group">
          <label>Deep Discovery</label>
          <select
            value={settings.deep_discovery_enabled || 'true'}
            onChange={(e) => update('deep_discovery_enabled', e.target.value)}
          >
            <option value="true">Aktiviert</option>
            <option value="false">Deaktiviert</option>
          </select>
          <div className="hint">
            Erweiterte Topologie-Erkennung mittels SNMP, mDNS, SSDP, Traceroute, TTL, Ping-Clustering und Proxmox
          </div>
        </div>

        <div className="form-group">
          <label>Deep Discovery Intervall (Minuten)</label>
          <input
            type="number"
            min="5"
            max="1440"
            value={settings.deep_discovery_interval || '60'}
            onChange={(e) => update('deep_discovery_interval', e.target.value)}
          />
          <div className="hint">
            Wie oft Deep Discovery automatisch ausgeführt wird (5-1440 Minuten). Läuft unabhängig vom normalen Scan.
          </div>
        </div>

        <div className="form-group">
          <label>SNMP Community-Strings</label>
          <input
            type="text"
            value={settings.snmp_community || ''}
            onChange={(e) => update('snmp_community', e.target.value)}
            placeholder="z.B. public, private, MeinNetz"
          />
          <div className="hint">
            Kommagetrennte Liste von SNMP Community-Strings zum Abfragen von Switches und Routern.
            Standard: public
          </div>
        </div>

        {showUnifi && (
          <>
            <div className="settings-separator" />
            <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wifi size={15} /> UISP / Ubiquiti
            </h3>
            <div className="hint" style={{ marginBottom: 12 }}>
              {unifiDetectedUrl
                ? 'Ubiquiti-Geräte wurden im Netzwerk erkannt. UISP-API-Token eingeben um WLAN-Clients ihren Access Points zuzuordnen.'
                : 'UISP-Integration für WLAN-Client-Zuordnung zu Access Points.'}
            </div>

            <div className="form-group">
              <label>UISP-URL</label>
              <input
                type="text"
                value={settings.unifi_url || ''}
                onChange={(e) => update('unifi_url', e.target.value)}
                placeholder={unifiDetectedUrl || 'https://192.168.1.1'}
              />
              <div className="hint">HTTPS-URL des UISP Controllers. Selbstsignierte Zertifikate werden akzeptiert.</div>
            </div>

            <div className="form-group">
              <label>API-Token</label>
              <input
                type="password"
                value={settings.unifi_token || ''}
                onChange={(e) => update('unifi_token', e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                autoComplete="off"
                style={{ fontFamily: 'monospace' }}
              />
              <div className="hint">
                API-Token aus UISP: Benutzer-Einstellungen &rarr; API Tokens &rarr; Token erstellen
              </div>
            </div>

            <button
              className="btn btn-secondary"
              onClick={handleUnifiTest}
              disabled={unifiTesting}
              style={{ marginBottom: 8 }}
            >
              {unifiTesting ? <Loader size={14} className="spin" /> : <Wifi size={14} />}
              {unifiTesting ? 'Teste Verbindung...' : 'Verbindung testen'}
            </button>

            {unifiTestResult && (
              <div style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                marginBottom: 8,
                background: unifiTestResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: unifiTestResult.success ? 'var(--success)' : 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                {unifiTestResult.success
                  ? <><CheckCircle size={14} /> Verbunden: {unifiTestResult.deviceCount} Geräte, {unifiTestResult.clientCount} WLAN-Clients</>
                  : <><AlertCircle size={14} /> {unifiTestResult.error}</>}
              </div>
            )}
          </>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: 8 }}
        >
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? 'Gespeichert' : saving ? 'Speichert...' : 'Speichern'}
        </button>
      </div>

      {saved && (
        <div className="toast success">Einstellungen gespeichert</div>
      )}
    </>
  );
}

export default Settings;
