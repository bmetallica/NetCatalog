import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, Shield, Network as NetworkIcon, Wifi, Layers, Box, Server,
  HardDrive, Printer, Cpu, Monitor, HelpCircle, Settings as SettingsIcon,
  ZoomIn, ZoomOut, Maximize, X, ExternalLink
} from 'lucide-react';
import { api } from '../api';

const ICON_MAP = {
  gateway: Globe, router: Globe, firewall: Shield, switch: NetworkIcon,
  ap: Wifi, hypervisor: Layers, vm: Box, server: Server, nas: HardDrive,
  printer: Printer, iot: Cpu, client: Monitor, management: SettingsIcon,
  device: HelpCircle,
};

const TYPE_COLORS = {
  gateway: '#f59e0b', router: '#f59e0b', firewall: '#ef4444', switch: '#3b82f6',
  ap: '#8b5cf6', hypervisor: '#06b6d4', vm: '#6366f1', server: '#22c55e',
  nas: '#f97316', printer: '#a3a3a3', iot: '#14b8a6', client: '#64748b',
  management: '#ec4899', device: '#6b7280',
};

const LAYER = {
  gateway: 0, router: 0, firewall: 0,
  switch: 1, ap: 1, management: 1,
  hypervisor: 2, server: 2, nas: 2,
  vm: 3, client: 3, iot: 3, printer: 3, device: 3,
};

function initPositions(nodes, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const layerRadii = [0, 150, 280, 420];
  const layers = [[], [], [], []];

  nodes.forEach(n => {
    const l = LAYER[n.computed_type] ?? 3;
    layers[l].push(n);
  });

  layers.forEach((layer, li) => {
    const r = layerRadii[li];
    layer.forEach((n, i) => {
      if (r === 0) {
        n.x = cx;
        n.y = cy;
      } else {
        const angle = (2 * Math.PI * i) / layer.length - Math.PI / 2;
        n.x = cx + r * Math.cos(angle);
        n.y = cy + r * Math.sin(angle);
      }
      n.vx = 0;
      n.vy = 0;
    });
  });
}

function runForceLayout(nodes, edges, width, height) {
  const ITERATIONS = 120;
  const REPULSION = 3000;
  const ATTRACTION = 0.004;
  const DAMPING = 0.85;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = dist * ATTRACTION;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Apply + damping + bounds
    const pad = 40;
    for (const n of nodes) {
      if (n.pinned) continue;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(pad, Math.min(width - pad, n.x));
      n.y = Math.max(pad, Math.min(height - pad, n.y));
    }
  }
}

function computeEdges(hosts) {
  const edges = [];
  const gateway = hosts.find(h => h.computed_type === 'gateway');
  const hostIds = new Set(hosts.map(h => h.id));

  for (const h of hosts) {
    if (h.computed_type === 'gateway') continue;
    if (h.parent_host_id && hostIds.has(h.parent_host_id)) {
      edges.push({ source: h.parent_host_id, target: h.id });
    } else if (gateway) {
      edges.push({ source: gateway.id, target: h.id });
    }
  }
  return edges;
}

function InfraMap() {
  const [topology, setTopology] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [panning, setPanning] = useState(null);
  const [loading, setLoading] = useState(true);
  const svgRef = useRef(null);
  const navigate = useNavigate();

  const W = 1200, H = 900;
  const NODE_R = 24;

  const fetchData = useCallback(async () => {
    try {
      const data = await api.getTopology();
      setTopology(data);
      const newNodes = data.hosts.map(h => ({ ...h }));
      initPositions(newNodes, W, H);
      const newEdges = computeEdges(newNodes);
      runForceLayout(newNodes, newEdges, W, H);
      setNodes(newNodes);
      setEdges(newEdges);
    } catch (err) {
      console.error('Topology fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(async () => {
      try {
        const data = await api.getTopology();
        setTopology(data);
        setNodes(prev => {
          const posMap = new Map(prev.map(n => [n.id, { x: n.x, y: n.y, pinned: n.pinned }]));
          const updated = data.hosts.map(h => {
            const pos = posMap.get(h.id);
            return pos ? { ...h, x: pos.x, y: pos.y, pinned: pos.pinned } : { ...h, x: W / 2, y: H / 2 };
          });
          setEdges(computeEdges(updated));
          return updated;
        });
      } catch (err) { /* silent */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const selected = nodes.find(n => n.id === selectedId);

  const getSvgPoint = (e) => {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - transform.x) / transform.scale,
      y: (e.clientY - rect.top - transform.y) / transform.scale,
    };
  };

  const onMouseDown = (e, nodeId) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedId(nodeId);
    const pt = getSvgPoint(e);
    const node = nodes.find(n => n.id === nodeId);
    setDragging({ id: nodeId, offsetX: pt.x - node.x, offsetY: pt.y - node.y });
  };

  const onCanvasMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target === svgRef.current || e.target.tagName === 'svg') {
      setPanning({ startX: e.clientX - transform.x, startY: e.clientY - transform.y });
      setSelectedId(null);
    }
  };

  const onMouseMove = (e) => {
    if (panning) {
      setTransform(t => ({ ...t, x: e.clientX - panning.startX, y: e.clientY - panning.startY }));
      return;
    }
    if (!dragging) return;
    const pt = getSvgPoint(e);
    const nx = pt.x - dragging.offsetX;
    const ny = pt.y - dragging.offsetY;

    setNodes(prev => prev.map(n => n.id === dragging.id ? { ...n, x: nx, y: ny, pinned: true } : n));

    // Check drop target
    const target = nodes.find(n =>
      n.id !== dragging.id &&
      Math.hypot(n.x - nx, n.y - ny) < NODE_R * 2
    );
    setDragTarget(target ? target.id : null);
  };

  const onMouseUp = async () => {
    if (panning) { setPanning(null); return; }
    if (dragging && dragTarget) {
      try {
        await api.classifyHost(dragging.id, { parent_host_id: dragTarget });
        setNodes(prev => {
          const updated = prev.map(n =>
            n.id === dragging.id ? { ...n, parent_host_id: dragTarget } : n
          );
          setEdges(computeEdges(updated));
          return updated;
        });
      } catch (err) {
        console.error('Parent assignment failed:', err);
      }
    }
    setDragging(null);
    setDragTarget(null);
  };

  const zoom = (delta) => {
    setTransform(t => ({
      ...t,
      scale: Math.max(0.3, Math.min(3, t.scale + delta)),
    }));
  };

  const onWheel = (e) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? -0.1 : 0.1);
  };

  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  const handleClassify = async (field, value) => {
    if (!selectedId) return;
    try {
      const data = {};
      if (field === 'device_type') data.device_type = value || null;
      if (field === 'parent_host_id') data.parent_host_id = value ? parseInt(value) : null;
      await api.classifyHost(selectedId, data);
      // Refetch to get updated computed_type
      const topo = await api.getTopology();
      setTopology(topo);
      setNodes(prev => {
        const posMap = new Map(prev.map(n => [n.id, { x: n.x, y: n.y, pinned: n.pinned }]));
        const updated = topo.hosts.map(h => {
          const pos = posMap.get(h.id);
          return pos ? { ...h, x: pos.x, y: pos.y, pinned: pos.pinned } : { ...h, x: W / 2, y: H / 2 };
        });
        setEdges(computeEdges(updated));
        return updated;
      });
    } catch (err) {
      console.error('Classify failed:', err);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" />Lade Infrastruktur...</div>;
  }

  const deviceTypes = topology?.deviceTypes || [];
  const legendTypes = [...new Set(nodes.map(n => n.computed_type))].sort();

  return (
    <div className="page">
      <div className="page-header">
        <h2>Infrastruktur</h2>
        <span className="subtitle">{nodes.length} Geräte klassifiziert</span>
      </div>

      <div className="map-legend">
        {legendTypes.map(t => {
          const Icon = ICON_MAP[t] || HelpCircle;
          const dt = deviceTypes.find(d => d.value === t);
          return (
            <span key={t} className="map-legend-item">
              <span className="map-legend-dot" style={{ background: TYPE_COLORS[t] }} />
              <Icon size={13} />
              {dt?.label || t}
            </span>
          );
        })}
      </div>

      <div className="infra-map-container">
        <div className="infra-map-canvas">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
          >
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
              {edges.map((e, i) => {
                const s = nodes.find(n => n.id === e.source);
                const t = nodes.find(n => n.id === e.target);
                if (!s || !t) return null;
                const isHighlighted = selectedId && (e.source === selectedId || e.target === selectedId);
                return (
                  <line key={i}
                    x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                    className={`map-edge ${isHighlighted ? 'highlighted' : ''}`}
                  />
                );
              })}

              {nodes.map(n => {
                const Icon = ICON_MAP[n.computed_type] || HelpCircle;
                const color = TYPE_COLORS[n.computed_type] || '#6b7280';
                const isSelected = selectedId === n.id;
                const isDropTarget = dragTarget === n.id;
                return (
                  <g key={n.id}
                    className={`map-node ${isSelected ? 'selected' : ''} ${isDropTarget ? 'drag-target' : ''}`}
                    onMouseDown={(e) => onMouseDown(e, n.id)}
                  >
                    <circle cx={n.x} cy={n.y} r={NODE_R}
                      className={`node-ring ${n.status}`}
                      style={isDropTarget ? {} : { fill: 'var(--bg-card)', stroke: n.status === 'up' ? 'var(--success)' : 'var(--danger)' }}
                    />
                    <circle cx={n.x} cy={n.y} r={NODE_R - 4}
                      fill={color} opacity={0.15} />
                    <foreignObject x={n.x - 10} y={n.y - 10} width={20} height={20}>
                      <div style={{ color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon size={16} />
                      </div>
                    </foreignObject>
                    <text x={n.x} y={n.y + NODE_R + 14} className="node-label">
                      {n.hostname || n.ip}
                    </text>
                    <title>
                      {n.hostname ? `${n.hostname} (${n.ip})` : n.ip}
                      {'\n'}Typ: {deviceTypes.find(d => d.value === n.computed_type)?.label || n.computed_type}
                      {'\n'}Status: {n.status === 'up' ? 'Online' : 'Offline'}
                      {'\n'}{n.service_count} Dienste
                    </title>
                  </g>
                );
              })}
            </g>
          </svg>

          <div className="map-controls">
            <button onClick={() => zoom(0.2)} title="Vergrößern"><ZoomIn size={16} /></button>
            <button onClick={() => zoom(-0.2)} title="Verkleinern"><ZoomOut size={16} /></button>
            <button onClick={resetView} title="Ansicht zurücksetzen"><Maximize size={16} /></button>
          </div>
        </div>

        {selected && (
          <div className="map-sidepanel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{selected.hostname || selected.ip}</h3>
              <button className="btn btn-sm" onClick={() => setSelectedId(null)}
                style={{ padding: '4px 8px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={14} />
              </button>
            </div>

            <div className="info-item">
              <label>IP-Adresse</label>
              <div className="value" style={{ fontFamily: 'monospace' }}>{selected.ip}</div>
            </div>
            <div className="info-item">
              <label>Status</label>
              <div>
                <span className={`status-badge ${selected.status}`}>
                  <span className="status-dot" />
                  {selected.status === 'up' ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
            {selected.vendor && (
              <div className="info-item">
                <label>Hersteller</label>
                <div className="value">{selected.vendor}</div>
              </div>
            )}
            {selected.os_guess && (
              <div className="info-item">
                <label>Betriebssystem</label>
                <div className="value">{selected.os_guess}</div>
              </div>
            )}
            <div className="info-item">
              <label>Dienste</label>
              <div className="value">{selected.service_count} offen</div>
            </div>
            <div className="info-item">
              <label>Erkennung</label>
              <div className="value" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {selected.classification_reason} ({selected.classification_confidence}%)
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

            <div className="info-item">
              <label>Gerätetyp</label>
              <select
                value={selected.device_type || ''}
                onChange={(e) => handleClassify('device_type', e.target.value)}
              >
                <option value="">Automatisch ({deviceTypes.find(d => d.value === selected.computed_type)?.label || selected.computed_type})</option>
                {deviceTypes.map(dt => (
                  <option key={dt.value} value={dt.value}>{dt.label}</option>
                ))}
              </select>
            </div>

            <div className="info-item">
              <label>Übergeordnetes Gerät</label>
              <select
                value={selected.parent_host_id || ''}
                onChange={(e) => handleClassify('parent_host_id', e.target.value)}
              >
                <option value="">Kein (direkt am Gateway)</option>
                {nodes
                  .filter(n => n.id !== selected.id)
                  .map(n => (
                    <option key={n.id} value={n.id}>
                      {n.hostname || n.ip} ({deviceTypes.find(d => d.value === n.computed_type)?.label || n.computed_type})
                    </option>
                  ))}
              </select>
            </div>

            <button
              className="btn btn-secondary"
              style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
              onClick={() => navigate(`/hosts/${selected.id}`)}
            >
              <ExternalLink size={14} /> Host-Details
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default InfraMap;
