import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, Shield, Network as NetworkIcon, Wifi, Layers, Box, Server,
  HardDrive, Printer, Cpu, Monitor, HelpCircle, Settings as SettingsIcon,
  ZoomIn, ZoomOut, Maximize, X, ExternalLink, Radar, Eye
} from 'lucide-react';
import { api } from '../api';

const ICON_MAP = {
  gateway: Globe, router: Globe, firewall: Shield, switch: NetworkIcon,
  ap: Wifi, hypervisor: Layers, vm: Box, server: Server, nas: HardDrive,
  printer: Printer, camera: Eye, iot: Cpu, client: Monitor, management: SettingsIcon,
  device: HelpCircle,
};

const TYPE_COLORS = {
  gateway: '#f59e0b', router: '#f59e0b', firewall: '#ef4444', switch: '#3b82f6',
  ap: '#8b5cf6', hypervisor: '#06b6d4', vm: '#6366f1', server: '#22c55e',
  nas: '#f97316', printer: '#a3a3a3', camera: '#f43f5e', iot: '#14b8a6', client: '#64748b',
  management: '#ec4899', device: '#6b7280',
};

const TYPE_ORDER = [
  'gateway', 'firewall', 'router',
  'switch', 'ap', 'management',
  'hypervisor', 'server', 'nas',
  'vm', 'client', 'iot', 'camera', 'printer', 'device',
];

function computeEdges(hosts) {
  const edges = [];
  const hostIds = new Set(hosts.map(h => h.id));
  const gateway = hosts.find(h => h.computed_type === 'gateway');
  const hypervisors = hosts.filter(h => h.computed_type === 'hypervisor');

  for (const h of hosts) {
    if (h.computed_type === 'gateway') continue;

    // 1. Explicit parent always wins
    if (h.parent_host_id && hostIds.has(h.parent_host_id)) {
      edges.push({ source: h.parent_host_id, target: h.id });
      continue;
    }

    // 2. VMs auto-attach to a hypervisor
    if (h.computed_type === 'vm' && hypervisors.length > 0) {
      const vmSubnet = h.ip.split('.').slice(0, 3).join('.');
      
      // Try to find hypervisor in same /24 subnet with exact match
      const sameSubnetHV = hypervisors.find(hv => {
        const hvSubnet = hv.ip.split('.').slice(0, 3).join('.');
        return hvSubnet === vmSubnet;
      });
      
      // If no exact subnet match, check for ping cluster or traceroute info
      let clusterHV = null;
      if (!sameSubnetHV && h.discovery_info?.ping_cluster) {
        clusterHV = hypervisors.find(hv => 
          hv.discovery_info?.ping_cluster?.cluster === h.discovery_info.ping_cluster.cluster
        );
      }
      
      // Use: same subnet > same cluster > first hypervisor
      const parent = sameSubnetHV || clusterHV || hypervisors[0];
      edges.push({ source: parent.id, target: h.id });
      continue;
    }

    // 3. Everything → gateway so the tree is complete
    if (gateway) {
      edges.push({ source: gateway.id, target: h.id });
    }
  }
  return edges;
}

// ── Radial-tree layout ───────────────────────────────────────
//
// Hub nodes (have children) → tree layout below their parent
// Leaf nodes (no children)  → radial arc around their parent

function layoutTree(nodes, edges) {
  const LEVEL_H = 500;   // even more vertical gap between hub levels
  const PAD = 100;
  const MIN_ARC_SPACING = 60; // min gap between leaf nodes on the arc

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const childrenOf = new Map();
  const parentOf = new Map();

  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source).push(e.target);
    parentOf.set(e.target, e.source);
  }

  // Classify each child as hub (has own children) or leaf
  function getHubs(id) {
    return (childrenOf.get(id) || []).filter(c => (childrenOf.get(c) || []).length > 0);
  }
  function getLeaves(id) {
    return (childrenOf.get(id) || []).filter(c => (childrenOf.get(c) || []).length === 0);
  }

  // Sort children by type then IP
  for (const [, children] of childrenOf) {
    children.sort((a, b) => {
      const na = nodeMap.get(a), nb = nodeMap.get(b);
      if (!na || !nb) return 0;
      const ta = TYPE_ORDER.indexOf(na.computed_type);
      const tb = TYPE_ORDER.indexOf(nb.computed_type);
      if (ta !== tb) return ta - tb;
      return na.ip.localeCompare(nb.ip, undefined, { numeric: true });
    });
  }

  // Radial dimensions - tight, compact circles
  function ringRadius(n) {
    if (n === 0) return 0;
    if (n === 1) return 60;
    if (n === 2) return 70;
    if (n === 3) return 80;
    if (n === 4) return 90;
    if (n === 5) return 100;
    if (n <= 8) return 100 + (n - 5) * 12;
    if (n <= 12) return 136 + (n - 8) * 15;
    if (n <= 20) return 196 + (n - 12) * 18;
    // Large groups
    return 340 + (n - 20) * 20;
  }

  // Subtree width in pixels - must account for full radial extent
  const widthOf = new Map();
  function calcWidth(id) {
    if (widthOf.has(id)) return widthOf.get(id);
    const hubs = getHubs(id);
    const leaves = getLeaves(id);

    if (hubs.length === 0 && leaves.length === 0) {
      widthOf.set(id, 100);
      return 100;
    }

    const hubW = hubs.reduce((s, c) => s + calcWidth(c), 0)
               + Math.max(0, hubs.length - 1) * 120;
    
    // For leaves: full diameter with moderate margin (circles are now compact)
    const leafW = leaves.length > 0 ? (ringRadius(leaves.length) * 2 + 200) : 0;
    
    const w = Math.max(hubW, leafW, 150);
    widthOf.set(id, w);
    return w;
  }

  const roots = nodes.filter(n => !parentOf.has(n.id));
  roots.sort((a, b) => TYPE_ORDER.indexOf(a.computed_type) - TYPE_ORDER.indexOf(b.computed_type));
  roots.forEach(r => calcWidth(r.id));
  nodes.forEach(n => { if (!widthOf.has(n.id)) widthOf.set(n.id, 55); });

  // Position recursively
  function position(id, left, depth) {
    const node = nodeMap.get(id);
    if (!node) return;

    const hubs = getHubs(id);
    const leaves = getLeaves(id);
    const myW = widthOf.get(id);

    node.y = PAD + depth * LEVEL_H;

    // Position hub children below in a tree row
    if (hubs.length > 0) {
      const hubTotalW = hubs.reduce((s, c) => s + widthOf.get(c), 0) + (hubs.length - 1) * 80;
      let hLeft = left + (myW - hubTotalW) / 2;
      for (const cid of hubs) {
        position(cid, hLeft, depth + 1);
        hLeft += widthOf.get(cid) + 80;
      }
      // Center this node over its hub children
      const first = nodeMap.get(hubs[0]);
      const last = nodeMap.get(hubs[hubs.length - 1]);
      node.x = (first.x + last.x) / 2;
    } else {
      node.x = left + myW / 2;
    }

    // Position leaf children radially around this node
    if (leaves.length > 0) {
      const R = ringRadius(leaves.length);
      const cx = node.x;
      const cy = node.y;

      if (leaves.length === 1) {
        const ln = nodeMap.get(leaves[0]);
        if (ln) { ln.x = cx; ln.y = cy + R; }
      } else {
        // Always use a full circular distribution around the parent node
        // Distribute leaves evenly around the parent in a circle
        const fullCircle = Math.PI * 2;
        const startAngle = -Math.PI / 2; // Start at the top

        for (let i = 0; i < leaves.length; i++) {
          const angle = startAngle + (i / leaves.length) * fullCircle;
          const ln = nodeMap.get(leaves[i]);
          if (ln) {
            ln.x = cx + R * Math.cos(angle);
            ln.y = cy + R * Math.sin(angle);
          }
        }
      }
    }
  }

  let totalLeft = PAD;
  for (const root of roots) {
    position(root.id, totalLeft, 0);
    // Add MUCH more horizontal space between trees
    totalLeft += widthOf.get(root.id) + 600;
  }

  // Ensure no negative positions & compute canvas size
  let minX = Infinity, maxX = 0, maxY = 0;
  for (const n of nodes) {
    if (n.x != null) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
  }
  if (minX < PAD) {
    const shift = PAD - minX;
    nodes.forEach(n => { if (n.x != null) n.x += shift; });
    maxX += shift;
  }

  return {
    canvasW: Math.max(2000, maxX + PAD * 2),
    canvasH: Math.max(900, maxY + PAD + 100),
  };
}

// ── Descendants helper (for subtree dragging) ────────────────

function getDescendantIds(nodeId, edges) {
  const childrenOf = new Map();
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source).push(e.target);
  }
  const result = new Set();
  const queue = [...(childrenOf.get(nodeId) || [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (result.has(id)) continue;
    result.add(id);
    for (const cid of (childrenOf.get(id) || [])) queue.push(cid);
  }
  return result;
}

// ── Component ────────────────────────────────────────────────

function InfraMap() {
  const [topology, setTopology] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [canvasSize, setCanvasSize] = useState({ w: 2000, h: 900 });
  const [selectedId, setSelectedId] = useState(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(null);
  const [panning, setPanning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const svgRef = useRef(null);
  const navigate = useNavigate();

  const NODE_R = 22;

  const processTopology = useCallback((data, preservePositions = null) => {
    const newNodes = data.hosts.map(h => ({ ...h }));
    const newEdges = computeEdges(newNodes);
    const { canvasW, canvasH } = layoutTree(newNodes, newEdges);

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
    const descendants = getDescendantIds(nodeId, edges);
    setDragging({ id: nodeId, offsetX: pt.x - node.x, offsetY: pt.y - node.y, descendants });
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

    setNodes(prev => {
      const current = prev.find(n => n.id === dragging.id);
      if (!current) return prev;
      const dx = nx - current.x;
      const dy = ny - current.y;
      return prev.map(n => {
        if (n.id === dragging.id || dragging.descendants.has(n.id)) {
          return { ...n, x: n.x + dx, y: n.y + dy, pinned: true };
        }
        return n;
      });
    });
  };

  const onMouseUp = () => {
    if (panning) { setPanning(null); return; }
    setDragging(null);
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
      const { newNodes, newEdges, canvasW, canvasH } = processTopology(topo);
      setNodes(newNodes);
      setEdges(newEdges);
      setCanvasSize({ w: canvasW, h: canvasH });
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Infrastruktur</h2>
          <span className="subtitle">{nodes.length} Geräte klassifiziert</span>
        </div>
        <button
          className={`btn btn-primary ${discovering ? 'discovering' : ''}`}
          disabled={discovering}
          onClick={async () => {
            setDiscovering(true);
            try {
              await api.runDiscovery();
              let polls = 0;
              const poll = setInterval(async () => {
                polls++;
                try {
                  const data = await api.getTopology();
                  setTopology(data);
                  const { newNodes, newEdges, canvasW, canvasH } = processTopology(data);
                  setNodes(newNodes);
                  setEdges(newEdges);
                  setCanvasSize({ w: canvasW, h: canvasH });
                } catch {}
                if (polls >= 8) {
                  clearInterval(poll);
                  setDiscovering(false);
                }
              }, 5000);
            } catch (err) {
              console.error('Discovery error:', err);
              setDiscovering(false);
            }
          }}
        >
          <Radar size={16} className={discovering ? 'spin' : ''} />
          {discovering ? 'Analysiere Netzwerk...' : 'Deep Discovery'}
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
              {/* Edges */}
              {edges.map((e, i) => {
                const s = nodes.find(n => n.id === e.source);
                const t = nodes.find(n => n.id === e.target);
                if (!s || !t) return null;
                const isHighlighted = selectedId && (e.source === selectedId || e.target === selectedId);

                // Vertical tree edges: straight down then horizontal
                const midY = (s.y + t.y) / 2;
                return (
                  <path key={i}
                    d={`M ${s.x} ${s.y + NODE_R} C ${s.x} ${midY}, ${t.x} ${midY}, ${t.x} ${t.y - NODE_R}`}
                    className={`map-edge ${isHighlighted ? 'highlighted' : ''}`}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map(n => {
                const Icon = ICON_MAP[n.computed_type] || HelpCircle;
                const color = TYPE_COLORS[n.computed_type] || '#6b7280';
                const isSelected = selectedId === n.id;
                return (
                  <g key={n.id}
                    className={`map-node ${isSelected ? 'selected' : ''}`}
                    onMouseDown={(e) => onMouseDown(e, n.id)}
                    style={{ cursor: 'grab' }}
                  >
                    <circle cx={n.x} cy={n.y} r={NODE_R}
                      fill="var(--bg-card)"
                      stroke={n.status === 'up' ? 'var(--success)' : 'var(--danger)'}
                      strokeWidth={isSelected ? 3 : 2}
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
                {selected.discovery_info.unifi_client && (
                  <div className="info-item">
                    <label>WLAN</label>
                    <div className="value" style={{ fontSize: 12 }}>
                      {selected.discovery_info.unifi_client.ssid && <div>SSID: {selected.discovery_info.unifi_client.ssid}</div>}
                      {selected.discovery_info.unifi_client.signal != null && <div>Signal: {selected.discovery_info.unifi_client.signal} dBm</div>}
                      {selected.discovery_info.unifi_client.radio && <div>Band: {selected.discovery_info.unifi_client.radio}</div>}
                      {selected.discovery_info.unifi_client.ap_name && <div>AP: {selected.discovery_info.unifi_client.ap_name}</div>}
                    </div>
                  </div>
                )}
                {selected.discovery_info.unifi_device && (
                  <div className="info-item">
                    <label>UISP</label>
                    <div className="value" style={{ fontSize: 12 }}>
                      {selected.discovery_info.unifi_device.name && <div>{selected.discovery_info.unifi_device.name}</div>}
                      {selected.discovery_info.unifi_device.model && <div>Model: {selected.discovery_info.unifi_device.model}</div>}
                      {selected.discovery_info.unifi_device.ssid && <div>SSID: {selected.discovery_info.unifi_device.ssid}</div>}
                      {selected.discovery_info.unifi_device.num_sta != null && <div>Clients: {selected.discovery_info.unifi_device.num_sta}</div>}
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

            {(selected.computed_type === 'hypervisor' || selected.device_type === 'hypervisor') && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Proxmox API</div>
                
                <div className="info-item">
                  <label>API Host</label>
                  <input
                    type="text"
                    placeholder="https://192.168.1.10:8006"
                    defaultValue={selected.proxmox_api_host || ''}
                    onBlur={async (e) => {
                      if (e.target.value !== (selected.proxmox_api_host || '')) {
                        try {
                          await api.updateProxmoxCredentials(selected.id, {
                            api_host: e.target.value || null,
                            token_id: selected.proxmox_api_token_id,
                            token_secret: selected.proxmox_api_token_secret,
                          });
                          const topo = await api.getTopology();
                          setTopology(topo);
                          const { newNodes, newEdges, canvasW, canvasH } = processTopology(topo);
                          setNodes(newNodes);
                          setEdges(newEdges);
                          setCanvasSize({ w: canvasW, h: canvasH });
                        } catch (err) {
                          console.error('Proxmox update failed:', err);
                          alert('Fehler beim Speichern: ' + err.message);
                        }
                      }
                    }}
                  />
                </div>

                <div className="info-item">
                  <label>Token ID</label>
                  <input
                    type="text"
                    placeholder="root@pam!monitoring"
                    defaultValue={selected.proxmox_api_token_id || ''}
                    onBlur={async (e) => {
                      if (e.target.value !== (selected.proxmox_api_token_id || '')) {
                        try {
                          await api.updateProxmoxCredentials(selected.id, {
                            api_host: selected.proxmox_api_host,
                            token_id: e.target.value || null,
                            token_secret: selected.proxmox_api_token_secret,
                          });
                          const topo = await api.getTopology();
                          setTopology(topo);
                          const { newNodes, newEdges, canvasW, canvasH } = processTopology(topo);
                          setNodes(newNodes);
                          setEdges(newEdges);
                          setCanvasSize({ w: canvasW, h: canvasH });
                        } catch (err) {
                          console.error('Proxmox update failed:', err);
                          alert('Fehler beim Speichern: ' + err.message);
                        }
                      }
                    }}
                  />
                </div>

                <div className="info-item">
                  <label>Token Secret</label>
                  <input
                    type="password"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    defaultValue={selected.proxmox_api_token_secret || ''}
                    onBlur={async (e) => {
                      if (e.target.value !== (selected.proxmox_api_token_secret || '')) {
                        try {
                          await api.updateProxmoxCredentials(selected.id, {
                            api_host: selected.proxmox_api_host,
                            token_id: selected.proxmox_api_token_id,
                            token_secret: e.target.value || null,
                          });
                          const topo = await api.getTopology();
                          setTopology(topo);
                          const { newNodes, newEdges, canvasW, canvasH } = processTopology(topo);
                          setNodes(newNodes);
                          setEdges(newEdges);
                          setCanvasSize({ w: canvasW, h: canvasH });
                        } catch (err) {
                          console.error('Proxmox update failed:', err);
                          alert('Fehler beim Speichern: ' + err.message);
                        }
                      }
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  VMs werden bei Deep Discovery automatisch zugeordnet
                </div>
                
                {selected.proxmox_api_host && selected.proxmox_api_token_id && selected.proxmox_api_token_secret && (
                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: 8, width: '100%' }}
                    onClick={async () => {
                      try {
                        const result = await api.testProxmoxConnection({
                          api_host: selected.proxmox_api_host,
                          token_id: selected.proxmox_api_token_id,
                          token_secret: selected.proxmox_api_token_secret,
                        });
                        alert(`✅ Verbindung erfolgreich!\n\nProxmox Version: ${result.version}\n${result.vm_count} VMs gefunden`);
                      } catch (err) {
                        alert(`❌ Verbindung fehlgeschlagen:\n\n${err.message}`);
                      }
                    }}
                  >
                    Verbindung testen
                  </button>
                )}
              </>
            )}

            {(selected.vendor?.includes('AVM') || selected.discovery_info?.ssdp?.server?.includes('FRITZ!Box')) && (selected.computed_type === 'gateway' || selected.computed_type === 'router' || selected.device_type === 'gateway' || selected.device_type === 'router' || selected.computed_type === 'firewall' || selected.device_type === 'firewall' || selected.computed_type === 'ap' || selected.device_type === 'ap') && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>FritzBox Zugangsdaten</div>
                
                <div className="info-item">
                  <label>FritzBox Host/URL</label>
                  <input
                    type="text"
                    placeholder="https://fritz.box oder https://192.168.178.1"
                    defaultValue={selected.fritzbox_host || ''}
                    onBlur={async (e) => {
                      if (e.target.value !== (selected.fritzbox_host || '')) {
                        try {
                          await api.updateFritzBoxCredentials(selected.id, {
                            fritzbox_host: e.target.value || null,
                            fritzbox_username: selected.fritzbox_username,
                            fritzbox_password: selected.fritzbox_password,
                          });
                          const topo = await api.getTopology();
                          setTopology(topo);
                          const { newNodes, newEdges, canvasW, canvasH } = processTopology(topo);
                          setNodes(newNodes);
                          setEdges(newEdges);
                          setCanvasSize({ w: canvasW, h: canvasH });
                        } catch (err) {
                          console.error('FritzBox update failed:', err);
                          alert('Fehler beim Speichern: ' + err.message);
                        }
                      }
                    }}
                  />
                </div>

                <div className="info-item">
                  <label>Benutzername</label>
                  <input
                    type="text"
                    placeholder="admin"
                    defaultValue={selected.fritzbox_username || ''}
                    onBlur={async (e) => {
                      if (e.target.value !== (selected.fritzbox_username || '')) {
                        try {
                          await api.updateFritzBoxCredentials(selected.id, {
                            fritzbox_host: selected.fritzbox_host,
                            fritzbox_username: e.target.value || null,
                            fritzbox_password: selected.fritzbox_password,
                          });
                          const topo = await api.getTopology();
                          setTopology(topo);
                          const { newNodes, newEdges, canvasW, canvasH } = processTopology(topo);
                          setNodes(newNodes);
                          setEdges(newEdges);
                          setCanvasSize({ w: canvasW, h: canvasH });
                        } catch (err) {
                          console.error('FritzBox update failed:', err);
                          alert('Fehler beim Speichern: ' + err.message);
                        }
                      }
                    }}
                  />
                </div>

                <div className="info-item">
                  <label>Passwort</label>
                  <input
                    type="password"
                    placeholder="Passwort"
                    defaultValue={selected.fritzbox_password || ''}
                    onBlur={async (e) => {
                      if (e.target.value !== (selected.fritzbox_password || '')) {
                        try {
                          await api.updateFritzBoxCredentials(selected.id, {
                            fritzbox_host: selected.fritzbox_host,
                            fritzbox_username: selected.fritzbox_username,
                            fritzbox_password: e.target.value || null,
                          });
                          const topo = await api.getTopology();
                          setTopology(topo);
                          const { newNodes, newEdges, canvasW, canvasH } = processTopology(topo);
                          setNodes(newNodes);
                          setEdges(newEdges);
                          setCanvasSize({ w: canvasW, h: canvasH });
                        } catch (err) {
                          console.error('FritzBox update failed:', err);
                          alert('Fehler beim Speichern: ' + err.message);
                        }
                      }
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  WLAN-Geräte werden bei Deep Discovery automatisch erkannt
                </div>
                
                {selected.fritzbox_host && selected.fritzbox_username && selected.fritzbox_password && (
                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: 8, width: '100%' }}
                    onClick={async () => {
                      try {
                        const result = await api.testFritzBoxConnection({
                          fritzbox_host: selected.fritzbox_host,
                          fritzbox_username: selected.fritzbox_username,
                          fritzbox_password: selected.fritzbox_password,
                        });
                        alert(`✅ Verbindung erfolgreich!\n\nModell: ${result.modelName}\nFirmware: ${result.softwareVersion}\nSerial: ${result.serialNumber}\n\nWLAN-Geräte: ${result.wlanDevices?.length || 0}`);
                      } catch (err) {
                        alert(`❌ Verbindung fehlgeschlagen:\n\n${err.message}`);
                      }
                    }}
                  >
                    Verbindung testen
                  </button>
                )}
              </>
            )}

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
