import { useState, useEffect } from 'react';
import { Save, Check } from 'lucide-react';
import { api } from '../api';

function Settings() {
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSettings()
      .then((data) => {
        const obj = {};
        data.forEach((s) => { obj[s.key] = s.value; });
        setSettings(obj);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const update = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
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
          <label>Netzwerk (CIDR)</label>
          <input
            type="text"
            value={settings.scan_network || ''}
            onChange={(e) => update('scan_network', e.target.value)}
            placeholder="z.B. 192.168.1.0/24"
          />
          <div className="hint">
            Das zu scannende Netzwerk im CIDR-Format, z.B. 192.168.1.0/24 oder 10.0.0.0/16
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
