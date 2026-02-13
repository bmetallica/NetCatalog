const https = require('https');
const http = require('http');

/**
 * Proxmox VE API Client
 * 
 * Queries Proxmox API to get list of VMs with their network interfaces and MAC addresses
 * Uses API token authentication (safer than username/password)
 */

class ProxmoxClient {
  constructor(apiHost, tokenId, tokenSecret) {
    this.apiHost = apiHost.replace(/\/$/, ''); // Remove trailing slash
    this.tokenId = tokenId; // Format: USER@REALM!TOKENID
    this.tokenSecret = tokenSecret;
  }

  /**
   * Make an authenticated request to Proxmox API
   */
  async request(endpoint) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.apiHost);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 8006 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Authorization': `PVEAPIToken=${this.tokenId}=${this.tokenSecret}`,
        },
        // Allow self-signed certificates (common for Proxmox)
        rejectUnauthorized: false,
      };

      console.log(`[ProxmoxClient] Request: ${options.method} ${url.href}`);

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log(`[ProxmoxClient] Response status: ${res.statusCode}`);
          if (res.statusCode !== 200) {
            console.error(`[ProxmoxClient] Error response: ${data}`);
            return reject(new Error(`Proxmox API error: ${res.statusCode} ${data}`));
          }
          try {
            const json = JSON.parse(data);
            console.log(`[ProxmoxClient] Response data type: ${typeof json.data}, is array: ${Array.isArray(json.data)}`);
            resolve(json.data);
          } catch (err) {
            console.error(`[ProxmoxClient] JSON parse error: ${err.message}`);
            reject(new Error(`Invalid JSON response: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => {
        console.error(`[ProxmoxClient] Request error: ${err.message}`);
        reject(err);
      });
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  /**
   * Get all VMs across all nodes with their MAC addresses
   * Returns: [{ vmid, name, node, status, macs: [mac1, mac2, ...] }, ...]
   */
  async getVMs() {
    try {
      // 1. Get all nodes
      console.log('[ProxmoxClient] Fetching nodes...');
      const nodes = await this.request('/api2/json/nodes');
      console.log(`[ProxmoxClient] Found ${nodes ? nodes.length : 0} nodes:`, nodes);
      
      if (!nodes || nodes.length === 0) {
        console.warn('[Proxmox] No nodes found');
        return [];
      }

      const allVMs = [];

      // 2. For each node, get QEMU VMs and LXC containers
      for (const node of nodes) {
        console.log(`[ProxmoxClient] Node: ${node.node}, Status: ${node.status}`);
        if (node.status !== 'online') {
          console.log(`[ProxmoxClient] Skipping node ${node.node} (offline)`);
          continue;
        }

        // Get QEMU VMs
        try {
          console.log(`[ProxmoxClient] Fetching QEMU VMs for node ${node.node}...`);
          const vms = await this.request(`/api2/json/nodes/${node.node}/qemu`);
          console.log(`[ProxmoxClient] Node ${node.node}: ${vms ? vms.length : 0} QEMU VMs found`);

          if (vms && vms.length > 0) {
            // 3. For each VM, get network configuration
            for (const vm of vms) {
              try {
                console.log(`[ProxmoxClient] Fetching config for QEMU VM ${vm.vmid} (${vm.name})...`);
                const config = await this.request(`/api2/json/nodes/${node.node}/qemu/${vm.vmid}/config`);
                console.log(`[ProxmoxClient] VM ${vm.vmid} config keys:`, Object.keys(config));
                
                const macs = this.extractMACAddresses(config);
                console.log(`[ProxmoxClient] VM ${vm.vmid}: Extracted MACs:`, macs);

                allVMs.push({
                  vmid: vm.vmid,
                  name: vm.name || `VM-${vm.vmid}`,
                  node: node.node,
                  status: vm.status,
                  type: 'qemu',
                  macs: macs,
                });
              } catch (err) {
                console.error(`[Proxmox] Error getting config for QEMU VM ${vm.vmid}:`, err.message);
              }
            }
          }
        } catch (err) {
          console.error(`[Proxmox] Error getting QEMU VMs for node ${node.node}:`, err.message);
        }

        // Get LXC containers
        try {
          console.log(`[ProxmoxClient] Fetching LXC containers for node ${node.node}...`);
          const containers = await this.request(`/api2/json/nodes/${node.node}/lxc`);
          console.log(`[ProxmoxClient] Node ${node.node}: ${containers ? containers.length : 0} LXC containers found`);

          if (containers && containers.length > 0) {
            for (const ct of containers) {
              try {
                console.log(`[ProxmoxClient] Fetching config for LXC ${ct.vmid} (${ct.name})...`);
                const config = await this.request(`/api2/json/nodes/${node.node}/lxc/${ct.vmid}/config`);
                console.log(`[ProxmoxClient] LXC ${ct.vmid} config keys:`, Object.keys(config));
                
                const macs = this.extractMACAddresses(config);
                console.log(`[ProxmoxClient] LXC ${ct.vmid}: Extracted MACs:`, macs);

                allVMs.push({
                  vmid: ct.vmid,
                  name: ct.name || `CT-${ct.vmid}`,
                  node: node.node,
                  status: ct.status,
                  type: 'lxc',
                  macs: macs,
                });
              } catch (err) {
                console.error(`[Proxmox] Error getting config for LXC ${ct.vmid}:`, err.message);
              }
            }
          }
        } catch (err) {
          console.error(`[Proxmox] Error getting LXC containers for node ${node.node}:`, err.message);
        }
      }

      console.log(`[ProxmoxClient] Total VMs found: ${allVMs.length} (QEMU + LXC)`);
      return allVMs;
    } catch (err) {
      console.error('[Proxmox] Error in getVMs:', err.message);
      throw err;
    }
  }

  /**
   * Extract MAC addresses from VM config
   * Network interfaces are stored as net0, net1, etc. with format like:
   * "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0"
   */
  extractMACAddresses(config) {
    const macs = [];
    
    console.log('[ProxmoxClient] Extracting MACs from config...');
    for (const [key, value] of Object.entries(config)) {
      if (/^net\d+$/.test(key) && typeof value === 'string') {
        console.log(`[ProxmoxClient]   ${key}: ${value}`);
        // Extract MAC from format like "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0"
        const match = value.match(/([0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2})/);
        if (match) {
          macs.push(match[1].toLowerCase());
          console.log(`[ProxmoxClient]     -> Found MAC: ${match[1].toLowerCase()}`);
        }
      }
    }

    return macs;
  }

  /**
   * Test connection to Proxmox API
   */
  async testConnection() {
    try {
      const version = await this.request('/api2/json/version');
      return {
        success: true,
        version: version.version,
        release: version.release,
      };
    } catch (err) {
      throw new Error(`Proxmox connection failed: ${err.message}`);
    }
  }

  /**
   * Get node -> management IP mapping (best-effort)
   */
  async getNodeAddressMap() {
    const map = new Map();
    const nodes = await this.request('/api2/json/nodes');
    if (!nodes || nodes.length === 0) return map;

    const results = await Promise.allSettled(nodes.map(async (n) => {
      const ips = new Set();
      try {
        const status = await this.request(`/api2/json/nodes/${n.node}/status`);
        const ip = status?.ip || status?.address || null;
        if (ip) ips.add(String(ip));
      } catch {}

      try {
        const net = await this.request(`/api2/json/nodes/${n.node}/network`);
        if (Array.isArray(net)) {
          for (const iface of net) {
            const addr = iface?.address || '';
            if (addr && addr.includes('.')) {
              const ipOnly = String(addr).split('/')[0];
              if (ipOnly) ips.add(ipOnly);
            }
          }
        }
      } catch {}

      return { node: n.node, ips: Array.from(ips) };
    }));

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.node) {
        map.set(String(r.value.node), r.value.ips || []);
      }
    }

    return map;
  }
}

/**
 * Get VMs from a Proxmox host
 */
async function getVMsFromHost(apiHost, tokenId, tokenSecret) {
  const client = new ProxmoxClient(apiHost, tokenId, tokenSecret);
  return await client.getVMs();
}

/**
 * Test Proxmox connection
 */
async function testProxmoxConnection(apiHost, tokenId, tokenSecret) {
  const client = new ProxmoxClient(apiHost, tokenId, tokenSecret);
  return await client.testConnection();
}

/**
 * Get Proxmox node -> IP map
 */
async function getNodeAddressMap(apiHost, tokenId, tokenSecret) {
  const client = new ProxmoxClient(apiHost, tokenId, tokenSecret);
  return await client.getNodeAddressMap();
}

module.exports = {
  ProxmoxClient,
  getVMsFromHost,
  testProxmoxConnection,
  getNodeAddressMap,
};
