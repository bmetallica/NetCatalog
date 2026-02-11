import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, Shield, Network as NetworkIcon, Wifi, Layers, Box, Server,
  HardDrive, Printer, Cpu, Monitor, HelpCircle, Settings as SettingsIcon,
  ZoomIn, ZoomOut, Maximize, X, ExternalLink, Radar
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

// Tier assignment for hierarchical layout
const TIER = {
  gateway: 0, router: 0, firewall: 0,
  switch: 1, ap: 1, management: 1,
  hypervisor: 2, server: 2, nas: 2,
  vm: 3, client: 3, iot: 3, printer: 3, device: 3,
};

// Group order within a tier (for visual clustering)
const TYPE_ORDER = [
  'gateway', 'firewall', 'router',
  'switch', 'ap', 'management',
  'hypervisor', 'server', 'nas',
  'vm', 'client', 'iot', 'printer', 'device',
];

function computeEdges(hosts) {
  const edges = [];
  const hostIds = new Set(hosts.map(h => h.id));
  const gateway = hosts.find(h => h.computed_type === 'gateway');
  const infraTypes = new Set(['gateway', 'router', 'firewall', 'switch', 'ap', 'management']);
  const hypervisors = hosts.filter(h => h.computed_type === 'hypervisor');

  for (const h of hosts) {
    if (h.computed_type === 'gateway') continue;

    // 1. Explicit parent always wins
    if (h.parent_host_id && hostIds.has(h.parent_host_id)) {
      edges.push({ source: h.parent_host_id, target: h.id });
      continue;
    }

    // 2. VMs auto-attach to a hypervisor (first one found, or by subnet proximity)
    if (h.computed_type === 'vm' && hypervisors.length > 0) {
      const subnet = h.ip.split('.').slice(0, 3).join('.');
      const sameSubnetHV = hypervisors.find(hv => hv.ip.startsWith(subnet));
      const parent = sameSubnetHV || hypervisors[0];
      edges.push({ source: parent.id, target: h.id });
      continue;
    }

    // 3. Infrastructure → gateway
    if (infraTypes.has(h.computed_type) && gateway) {
      edges.push({ source: gateway.id, target: h.id });
      continue;
    }

    // 4. Servers/NAS/Hypervisors → gateway (or first infra device)
    if (['hypervisor', 'server', 'nas'].includes(h.computed_type) && gateway) {
      edges.push({ source: gateway.id, target: h.id });
      continue;
    }

    // 5. Remaining leaf devices: no edge (reduces clutter)
    // They are placed in their tier row and belong visually to the structure
  }
  return edges;
}

function layoutHierarchical(nodes, edges, W, H) {
  const PAD_X = 60, PAD_Y = 80;
  const NODE_SPACING = 58;
  const TIER_GAP = 160;

  // Group by tier, then by type within tier
  const tiers = [[], [], [], []];
  nodes.forEach(n => {
    const t = TIER[n.computed_type] ?? 3;
    tiers[t].push(n);
  });

  // Sort within each tier by type order, then by IP
  tiers.forEach(tier => {
    tier.sort((a, b) => {
      const ta = TYPE_ORDER.indexOf(a.computed_type);
      const tb = TYPE_ORDER.indexOf(b.computed_type);
      if (ta !== tb) return ta - tb;
      return a.ip.localeCompare(b.ip, undefined, { numeric: true });
    });
  });

  // Calculate dynamic canvas size
  const maxTierWidth = Math.max(...tiers.map(t => t.length * NODE_SPACING));
  const canvasW = Math.max(W, maxTierWidth + PAD_X * 2);
  const canvasH = Math.max(H, tiers.length * TIER_GAP + PAD_Y * 2);

  // Lay out each tier as a horizontal row, centered
  tiers.forEach((tier, ti) => {
    const y = PAD_Y + ti * TIER_GAP;
    const totalWidth = tier.length * NODE_SPACING;
    const startX = (canvasW - totalWidth) / 2 + NODE_SPACING / 2;

    // Sub-group by type for visual gaps
    let prevType = null;
    let xOffset = 0;

    tier.forEach((n, i) => {
      if (prevType !== null && n.computed_type !== prevType) {
        xOffset += NODE_SPACING * 0.5; // extra gap between type groups
      }
      n.x = startX + i * NODE_SPACING + xOffset;
      n.y = y;
      prevType = n.computed_type;
    });

    // Re-center after adding gaps
    if (tier.length > 0) {
      const actualWidth = tier[tier.length - 1].x - tier[0].x;
      const shift = (canvasW - actualWidth) / 2 - tier[0].x;
      tier.forEach(n => { n.x += shift; });
    }
  });

  // Now nudge child nodes horizontally toward their parent to show relationships
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  // For edges that cross tiers, gently pull child toward parent X
  for (let pass = 0; pass < 3; pass++) {
    for (const e of edges) {
      const parent = nodeMap.get(e.source);
      const child = nodeMap.get(e.target);
      if (!parent || !child) continue;
      const parentTier = TIER[parent.computed_type] ?? 3;
      const childTier = TIER[child.computed_type] ?? 3;
      if (childTier > parentTier) {
        // Pull child 20% toward parent X
        child.x += (parent.x - child.x) * 0.2;
      }
    }
  }

  // Resolve overlaps within each tier
  tiers.forEach(tier => {
    if (tier.length < 2) return;
    tier.sort((a, b) => a.x - b.x);
    for (let i = 1; i < tier.length; i++) {
      const minGap = 50;
      if (tier[i].x - tier[i - 1].x < minGap) {
        tier[i].x = tier[i - 1].x + minGap;
      }
    }
    // Re-center
    const actualWidth = tier[tier.length - 1].x - tier[0].x;
    const shift = (canvasW - actualWidth) / 2 - tier[0].x;
    tier.forEach(n => { n.x += shift; });
  });

  return { canvasW, canvasH };
}

function InfraMap() {
  const [topology, setTopology] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [canvasSize, setCanvasSize] = useState({ w: 2000, h: 900 });
  const [selectedId, setSelectedId] = useState(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [panning, setPanning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const svgRef = useRef(null);
  const navigate = useNavigate();

  const NODE_R = 22;

  const processTopology = useCallback((data, preservePositions = null) => {
    const newNodes = data.hosts.map(h => ({ ...h }));
    const newEdges = computeEdges(newNodes);
    const { canvasW, canvasH } = layoutHierarchical(newNodes, newEdges, 2000, 900);

    if (preservePositions) {
      newNodes.forEach(n => {
        const prev = preservePositions.get(n.id);
        if (prev && prev.pinned) {
          n.x = prev.x;
          n.y = prev.y;
          n.pinned = true;
        }
      });
    }

    return { newNodes, newEdges, canvasW, canvasH };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.getTopology();
      setTopology(data);
      const { newNodes, newEdges, canvasW, canvasH } = processTopology(data);
      setNodes(newNodes);
      setEdges(newEdges);
      setCanvasSize({ w: canvasW, h: canvasH });
    } catch (err) {
      console.error('Topology fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [processTopology]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(async () => {
      try {
        const data = await api.getTopology();
        setTopology(data);
        setNodes(prev => {
          const posMap = new Map(prev.map(n => [n.id, { x: n.x, y: n.y, pinned: n.pinned }]));
          const { newNodes, newEdges, canvasW, canvasH } = processTopology(data, posMap);
          setEdges(newEdges);
          setCanvasSize({ w: canvasW, h: canvasH });
          return newNodes;
        });
      } catch (err) { /* silent */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchData, processTopology]);

  const selected = nodes.find(n => n.id === selectedId);

  const getSvgPoint = (e) => {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const scaleX = canvasSize.w / rect.width;
    const scaleY = canvasSize.h / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX / transform.scale - transform.x / transform.scale,
      y: (e.clientY - rect.top) * scaleY / transform.scale - transform.y / transform.scale,
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
    setPanning({ startX: e.clientX - transform.x, startY: e.clientY - transform.y });
    setSelectedId(null);
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

    const target = nodes.find(n =>
      n.id !== dragging.id &&
      Math.hypot(n.x - nx, n.y - ny) < NODE_R * 2.5
    );
    setDragTarget(target ? target.id : null);
  };

  const onMouseUp = async () => {
    if (panning) { setPanning(null); return; }
    if (dragging && dragTarget) {
      try {
        await api.classifyHost(dragging.id, { parent_host_id: dragTarget });
        const data = await api.getTopology();
        setTopology(data);
        setNodes(prev => {
          const posMap = new Map(prev.map(n => [n.id, { x: n.x, y: n.y, pinned: n.pinned }]));
          const { newNodes, newEdges, canvasW, canvasH } = processTopology(data, posMap);
          setEdges(newEdges);
          setCanvasSize({ w: canvasW, h: canvasH });
          return newNodes;
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
      scale: Math.max(0.2, Math.min(4, t.scale + delta)),
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
      const topo = await api.getTopology();
      setTopology(topo);
      setNodes(prev => {
        const posMap = new Map(prev.map(n => [n.id, { x: n.x, y: n.y, pinned: n.pinned }]));
        const { newNodes, newEdges, canvasW, canvasH } = processTopology(topo, posMap);
        setEdges(newEdges);
        setCanvasSize({ w: canvasW, h: canvasH });
        return newNodes;
      });
    } catch (err) {
      console.error('Classify failed:', err);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" />Lade Infrastruktur...</div>;
  }

  const deviceTypes = topology?.deviceTypes || [];
  const legendTypes = [...new Set(nodes.map(n => n.computed_type))];
  legendTypes.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));

  // Tier labels
  const tierLabels = ['Netzwerk-Infrastruktur', 'Switches & Access Points', 'Server & Hypervisors', 'Endgeräte & VMs'];
  const tierYs = [0, 1, 2, 3].map(t => {
    const nodesInTier = nodes.filter(n => (TIER[n.computed_type] ?? 3) === t);
    if (nodesInTier.length === 0) return null;
    return nodesInTier[0].y;
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Infrastruktur</h2>
          <span className="subtitle">{nodes.length} Geräte klassifiziert</span>
        </div>
        <button
          className="btn btn-primary"
          disabled={discovering}
          onClick={async () => {
            setDiscovering(true);
            try {
              await api.runDiscovery();
              setTimeout(async () => {
                await fetchData();
                setDiscovering(false);
              }, 8000);
            } catch (err) {
              console.error('Discovery error:', err);
              setDiscovering(false);
            }
          }}
        >
          <Radar size={16} />
          {discovering ? 'Analysiere...' : 'Deep Discovery'}
        </button>
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
            viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
            preserveAspectRatio="xMidYMid meet"
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
          >
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
              {/* Tier background labels */}
              {tierYs.map((y, i) => y !== null && (
                <text key={i} x={30} y={y - 30}
                  fill="var(--text-muted)" fontSize="13" fontWeight="600" opacity="0.5"
                  fontFamily="Inter, sans-serif">
                  {tierLabels[i]}
                </text>
              ))}

              {/* Tier separator lines */}
              {tierYs.map((y, i) => y !== null && i > 0 && (
                <line key={`sep-${i}`}
                  x1={20} y1={y - 45} x2={canvasSize.w - 20} y2={y - 45}
                  stroke="var(--border)" strokeWidth="1" strokeDasharray="6 4" opacity="0.4" />
              ))}

              {/* Edges */}
              {edges.map((e, i) => {
                const s = nodes.find(n => n.id === e.source);
                const t = nodes.find(n => n.id === e.target);
                if (!s || !t) return null;
                const isHighlighted = selectedId && (e.source === selectedId || e.target === selectedId);

                // Curved edges for better readability
                const midY = (s.y + t.y) / 2;
                const dx = t.x - s.x;
                const curveOffset = Math.abs(dx) > 200 ? dx * 0.1 : 0;

                return (
                  <path key={i}
                    d={`M ${s.x} ${s.y} Q ${s.x + curveOffset} ${midY} ${t.x} ${t.y}`}
                    className={`map-edge ${isHighlighted ? 'highlighted' : ''}`}
                  />
                );
              })}

              {/* Nodes */}
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
                      fill="var(--bg-card)"
                      stroke={isDropTarget ? 'var(--warning)' : n.status === 'up' ? 'var(--success)' : 'var(--danger)'}
                      strokeWidth={isSelected ? 3 : 2}
                      strokeDasharray={isDropTarget ? '6 3' : 'none'}
                    />
                    <circle cx={n.x} cy={n.y} r={NODE_R - 5}
                      fill={color} opacity={0.18} />
                    <foreignObject x={n.x - 9} y={n.y - 9} width={18} height={18}>
                      <div style={{ color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon size={15} />
                      </div>
                    </foreignObject>
                    <text x={n.x} y={n.y + NODE_R + 13} className="node-label">
                      {(n.hostname || n.ip.split('.').slice(-1)[0])}
                    </text>
                    <title>
                      {n.hostname ? `${n.hostname} (${n.ip})` : n.ip}
                      {'\n'}Typ: {deviceTypes.find(d => d.value === n.computed_type)?.label || n.computed_type}
                      {'\n'}Status: {n.status === 'up' ? 'Online' : 'Offline'}
                      {'\n'}{n.service_count} Dienste
                      {n.vendor ? `\nHersteller: ${n.vendor}` : ''}
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
            {selected.mac_address && (
              <div className="info-item">
                <label>MAC-Adresse</label>
                <div className="value" style={{ fontFamily: 'monospace', fontSize: 12 }}>{selected.mac_address}</div>
              </div>
            )}
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

            {selected.discovery_info && Object.keys(selected.discovery_info).filter(k => k !== '_lastDiscovery').length > 0 && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Deep Discovery</div>
                {selected.discovery_info.snmp_info && (
                  <div className="info-item">
                    <label>SNMP</label>
                    <div className="value" style={{ fontSize: 11 }}>
                      {selected.discovery_info.snmp_info.sysName && <div>{selected.discovery_info.snmp_info.sysName}</div>}
                      <div style={{ color: 'var(--text-muted)' }}>{selected.discovery_info.snmp_info.sysDescr?.substring(0, 80)}</div>
                    </div>
                  </div>
                )}
                {selected.discovery_info.ttl && (
                  <div className="info-item">
                    <label>TTL</label>
                    <div className="value" style={{ fontSize: 12 }}>
                      {selected.discovery_info.ttl.ttl} (→ {selected.discovery_info.ttl.osGuess}, {selected.discovery_info.ttl.hops} Hop{selected.discovery_info.ttl.hops !== 1 ? 's' : ''})
                    </div>
                  </div>
                )}
                {selected.discovery_info.ping_cluster && (
                  <div className="info-item">
                    <label>L2-Cluster</label>
                    <div className="value" style={{ fontSize: 12 }}>
                      Cluster #{selected.discovery_info.ping_cluster.cluster} ({selected.discovery_info.ping_cluster.clusterSize} Geräte, {selected.discovery_info.ping_cluster.rtt}ms)
                    </div>
                  </div>
                )}
                {selected.discovery_info.ssdp && (
                  <div className="info-item">
                    <label>UPnP/SSDP</label>
                    <div className="value" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {selected.discovery_info.ssdp.server || selected.discovery_info.ssdp.st}
                    </div>
                  </div>
                )}
                {selected.discovery_info.mdns && (
                  <div className="info-item">
                    <label>mDNS</label>
                    <div className="value" style={{ fontSize: 11 }}>
                      {Array.isArray(selected.discovery_info.mdns)
                        ? selected.discovery_info.mdns.map(m => m.serviceType).join(', ')
                        : selected.discovery_info.mdns.serviceType}
                    </div>
                  </div>
                )}
                {selected.discovery_info.traceroute && (
                  <div className="info-item">
                    <label>Traceroute</label>
                    <div className="value" style={{ fontSize: 12 }}>
                      {selected.discovery_info.traceroute.direct ? 'Direkt (0 Hops)' : `${selected.discovery_info.traceroute.hops} Hops`}
                    </div>
                  </div>
                )}
              </>
            )}

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
