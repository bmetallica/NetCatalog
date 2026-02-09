import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { api } from '../api';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildSegments(checks) {
  if (!checks || checks.length === 0) return [];

  const segments = [];
  let current = null;

  for (const c of checks) {
    const t = new Date(c.checked_at);
    if (!current || current.status !== c.status) {
      if (current) current.end = t;
      current = { status: c.status, start: t, end: null };
      segments.push(current);
    }
  }
  // Last segment extends to its own start (single point) — we'll handle width below
  if (current && !current.end) {
    current.end = current.start;
  }

  return segments;
}

function Timeline({ checks, date }) {
  const dayStart = new Date(date + 'T00:00:00');
  const dayEnd = new Date(date + 'T23:59:59.999');
  const dayMs = dayEnd - dayStart;
  const segments = buildSegments(checks);

  if (segments.length === 0) {
    return (
      <div className="timeline-bar">
        <div className="timeline-segment no-data" style={{ width: '100%' }}
          title="Keine Daten" />
      </div>
    );
  }

  // Build visual segments between checks
  const visual = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const start = Math.max(seg.start - dayStart, 0);
    const end = i < segments.length - 1
      ? Math.max(segments[i + 1].start - dayStart, 0)
      : Math.min(Date.now() - dayStart, dayMs);
    const left = (start / dayMs) * 100;
    const width = Math.max(((end - start) / dayMs) * 100, 0.3);

    const startTime = new Date(dayStart.getTime() + start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const endTime = new Date(dayStart.getTime() + end).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    visual.push(
      <div
        key={i}
        className={`timeline-segment ${seg.status}`}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={`${startTime} - ${endTime}: ${seg.status === 'up' ? 'Online' : 'Offline'}`}
      />
    );
  }

  return <div className="timeline-bar">{visual}</div>;
}

function Availability() {
  const [date, setDate] = useState(formatDate(new Date()));
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const result = await api.getAvailability(date);
      setData(result);
    } catch (err) {
      console.error('Failed to load availability:', err);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [date]);

  const today = formatDate(new Date());
  const minDate = formatDate(new Date(Date.now() - 30 * 86400000));

  const changeDate = (delta) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const nd = formatDate(d);
    if (nd >= minDate && nd <= today) setDate(nd);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Verfuegbarkeit</h2>
        <div className="availability-nav">
          <button className="btn btn-sm" onClick={() => changeDate(-1)}
            disabled={date <= minDate}>
            <ChevronLeft size={16} />
          </button>
          <input type="date" value={date} min={minDate} max={today}
            onChange={(e) => setDate(e.target.value)} className="date-input" />
          <button className="btn btn-sm" onClick={() => changeDate(1)}
            disabled={date >= today}>
            <ChevronRight size={16} />
          </button>
          <button className="btn btn-sm" onClick={() => setDate(today)}
            disabled={date === today}>
            Heute
          </button>
        </div>
      </div>

      <div className="timeline-hours">
        {HOURS.map(h => (
          <span key={h} className="timeline-hour">{String(h).padStart(2, '0')}</span>
        ))}
      </div>

      {loading ? (
        <div className="loading">Lade Daten...</div>
      ) : data.length === 0 ? (
        <div className="empty-state">
          <Calendar size={48} />
          <p>Keine Verfuegbarkeitsdaten fuer diesen Tag</p>
        </div>
      ) : (
        <div className="availability-list">
          {data.map((host) => (
            <div key={host.host_id} className="availability-row">
              <div className="availability-host">
                <span className="host-ip">{host.ip_address}</span>
                {host.hostname && <span className="host-name">{host.hostname}</span>}
              </div>
              <Timeline checks={host.checks} date={date} />
            </div>
          ))}
        </div>
      )}

      <div className="timeline-legend">
        <span className="legend-item"><span className="legend-dot up" /> Online</span>
        <span className="legend-item"><span className="legend-dot down" /> Offline</span>
        <span className="legend-item"><span className="legend-dot no-data" /> Keine Daten</span>
      </div>
    </div>
  );
}

export default Availability;
