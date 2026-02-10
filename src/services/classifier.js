const { execFile } = require('child_process');

const DEVICE_TYPES = [
  { value: 'gateway', label: 'Gateway/Router', icon: 'globe' },
  { value: 'router', label: 'Router', icon: 'globe' },
  { value: 'firewall', label: 'Firewall', icon: 'shield' },
  { value: 'switch', label: 'Switch', icon: 'network' },
  { value: 'ap', label: 'Access Point', icon: 'wifi' },
  { value: 'hypervisor', label: 'Hypervisor', icon: 'layers' },
  { value: 'vm', label: 'Virtuelle Maschine', icon: 'box' },
  { value: 'server', label: 'Server', icon: 'server' },
  { value: 'nas', label: 'NAS', icon: 'hard-drive' },
  { value: 'printer', label: 'Drucker', icon: 'printer' },
  { value: 'iot', label: 'IoT-Gerät', icon: 'cpu' },
  { value: 'client', label: 'Client', icon: 'monitor' },
  { value: 'management', label: 'Netzwerk-Management', icon: 'settings' },
  { value: 'device', label: 'Unbekannt', icon: 'help-circle' },
];

const VM_MAC_PREFIXES = [
  { prefix: '00:50:56', label: 'VMware VM' },
  { prefix: '00:0c:29', label: 'VMware VM' },
  { prefix: '52:54:00', label: 'KVM/QEMU VM' },
  { prefix: '08:00:27', label: 'VirtualBox VM' },
  { prefix: '00:15:5d', label: 'Hyper-V VM' },
  { prefix: 'bc:24:11', label: 'Proxmox VM' },
];

const VENDOR_RULES = [
  { pattern: /cisco/i, type: 'switch' },
  { pattern: /juniper/i, type: 'router' },
  { pattern: /mikrotik/i, type: 'router' },
  { pattern: /fortinet|fortigate/i, type: 'firewall' },
  { pattern: /ubiquiti/i, type: 'ap' },
  { pattern: /aruba/i, type: 'ap' },
  { pattern: /tp-link/i, type: 'switch' },
  { pattern: /synology/i, type: 'nas' },
  { pattern: /qnap/i, type: 'nas' },
  { pattern: /buffalo/i, type: 'nas' },
  { pattern: /raspberry pi/i, type: 'iot' },
  { pattern: /espressif/i, type: 'iot' },
  { pattern: /sonos/i, type: 'iot' },
  { pattern: /philips.*hue|signify/i, type: 'iot' },
  { pattern: /hp\b|hewlett.packard/i, type: 'printer' },
  { pattern: /brother/i, type: 'printer' },
  { pattern: /canon/i, type: 'printer' },
  { pattern: /epson/i, type: 'printer' },
  { pattern: /apple/i, type: 'client' },
  { pattern: /samsung/i, type: 'client' },
];

const OS_RULES = [
  { pattern: /pfsense/i, type: 'firewall' },
  { pattern: /opnsense/i, type: 'firewall' },
  { pattern: /openwrt/i, type: 'router' },
  { pattern: /routeros/i, type: 'router' },
  { pattern: /esxi|vmware/i, type: 'hypervisor' },
  { pattern: /proxmox/i, type: 'hypervisor' },
];

function classifyHost(host, services) {
  // 1. Manual override
  if (host.device_type) {
    return { type: host.device_type, confidence: 100, reason: 'Manuell gesetzt' };
  }

  const mac = (host.mac_address || '').toLowerCase();
  const openServices = (services || []).filter(s => s.state === 'open' || !s.state);

  // 2. MAC OUI → VM detection
  for (const vm of VM_MAC_PREFIXES) {
    if (mac.startsWith(vm.prefix)) {
      return { type: 'vm', confidence: 90, reason: `MAC: ${vm.label}` };
    }
  }

  // 3. Services/Ports
  for (const svc of openServices) {
    const id = (svc.identified_as || '').toLowerCase();
    const name = (svc.service_name || '').toLowerCase();
    const product = (svc.service_product || '').toLowerCase();

    if (svc.port === 8006 && /proxmox/i.test(id)) {
      return { type: 'hypervisor', confidence: 95, reason: 'Proxmox Web UI (Port 8006)' };
    }
    if (/vmware|vsphere|esxi/i.test(id) || /vmware|esxi/i.test(product)) {
      return { type: 'hypervisor', confidence: 90, reason: 'VMware/ESXi erkannt' };
    }
    if (/proxmox/i.test(id)) {
      return { type: 'hypervisor', confidence: 90, reason: 'Proxmox erkannt' };
    }
    if (/unifi.*(controller|network)/i.test(id)) {
      return { type: 'management', confidence: 85, reason: 'UniFi Controller' };
    }
    if (svc.port === 631 || svc.port === 9100 || /cups|ipp|printer|jetdirect/i.test(id + name)) {
      return { type: 'printer', confidence: 85, reason: `Druckdienst (Port ${svc.port})` };
    }
    if (svc.port === 1883 || svc.port === 8883 || /mqtt/i.test(id + name)) {
      return { type: 'iot', confidence: 80, reason: 'MQTT-Broker' };
    }
  }

  // 4. Vendor
  const vendor = host.vendor || '';
  for (const rule of VENDOR_RULES) {
    if (rule.pattern.test(vendor)) {
      return { type: rule.type, confidence: 70, reason: `Hersteller: ${vendor}` };
    }
  }

  // 5. OS
  const os = host.os_guess || '';
  for (const rule of OS_RULES) {
    if (rule.pattern.test(os)) {
      return { type: rule.type, confidence: 65, reason: `OS: ${os}` };
    }
  }

  // 6. Heuristic: many server services
  const serverPorts = openServices.filter(s => {
    const p = s.port;
    return p === 22 || p === 80 || p === 443 || p === 3306 || p === 5432 ||
      p === 6379 || p === 27017 || p === 8080 || p === 8443;
  });
  if (serverPorts.length >= 2) {
    return { type: 'server', confidence: 60, reason: `${serverPorts.length} Server-Dienste` };
  }

  // 7. Windows without server services → client
  if (/windows/i.test(os) && serverPorts.length === 0) {
    return { type: 'client', confidence: 50, reason: 'Windows-Client' };
  }

  // 8. Has DNS port → DNS server
  if (openServices.some(s => s.port === 53)) {
    return { type: 'server', confidence: 55, reason: 'DNS-Server (Port 53)' };
  }

  // 9. Default
  return { type: 'device', confidence: 10, reason: 'Nicht klassifiziert' };
}

function getGatewayIp() {
  return new Promise((resolve) => {
    execFile('ip', ['route', 'show', 'default'], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      const match = stdout.match(/default via ([\d.]+)/);
      resolve(match ? match[1] : null);
    });
  });
}

module.exports = { classifyHost, getGatewayIp, DEVICE_TYPES };
