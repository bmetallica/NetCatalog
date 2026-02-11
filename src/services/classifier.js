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
  { value: 'camera', label: 'IP-Kamera', icon: 'eye' },
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

const OS_RULES = [
  { pattern: /pfsense/i, type: 'firewall' },
  { pattern: /opnsense/i, type: 'firewall' },
  { pattern: /sophos/i, type: 'firewall' },
  { pattern: /openwrt/i, type: 'router' },
  { pattern: /routeros/i, type: 'router' },
  { pattern: /fritz[!.]?os|avm/i, type: 'router' },
  { pattern: /h3c\s*comware|comware/i, type: 'switch' },
  { pattern: /cisco\s*(ios|nx-os|sg)/i, type: 'switch' },
  { pattern: /esxi|vmware\s*esx/i, type: 'hypervisor' },
  { pattern: /proxmox/i, type: 'hypervisor' },
  { pattern: /philips.*hue.*bridge/i, type: 'iot' },
  { pattern: /schrack.*meter|smart\s*meter/i, type: 'iot' },
  { pattern: /nodemcu|esp8266|esp32|lwip/i, type: 'iot' },
];

function classifyHost(host, services) {
  // 1. Manual override
  if (host.device_type) {
    return { type: host.device_type, confidence: 100, reason: 'Manuell gesetzt' };
  }

  const mac = (host.mac_address || '').toLowerCase();
  const vendor = host.vendor || '';
  const os = host.os_guess || '';
  const openServices = (services || []).filter(s => s.state === 'open' || !s.state);
  const di = host.discovery_info || {};

  // 2. SNMP sysDescr — most reliable source
  const snmpDescr = (di.snmp_info?.sysDescr || '').toLowerCase();
  if (snmpDescr) {
    if (/switch|sg\d{3}|catalyst|procurve|1920|2530|2540|2920|comware/i.test(snmpDescr)) {
      return { type: 'switch', confidence: 97, reason: `SNMP: ${di.snmp_info.sysDescr.substring(0, 60)}` };
    }
    if (/router|routeros|mikrotik/i.test(snmpDescr)) {
      return { type: 'router', confidence: 97, reason: `SNMP: ${di.snmp_info.sysDescr.substring(0, 60)}` };
    }
    if (/firewall|fortigate|sophos|pfsense|opnsense/i.test(snmpDescr)) {
      return { type: 'firewall', confidence: 97, reason: `SNMP: ${di.snmp_info.sysDescr.substring(0, 60)}` };
    }
    if (/access.point|wireless|unifi.*ap|aironet/i.test(snmpDescr)) {
      return { type: 'ap', confidence: 97, reason: `SNMP: ${di.snmp_info.sysDescr.substring(0, 60)}` };
    }
    if (/printer|laserjet|officejet|mfp/i.test(snmpDescr)) {
      return { type: 'printer', confidence: 97, reason: `SNMP: ${di.snmp_info.sysDescr.substring(0, 60)}` };
    }
    if (/nas|synology|qnap/i.test(snmpDescr)) {
      return { type: 'nas', confidence: 97, reason: `SNMP: ${di.snmp_info.sysDescr.substring(0, 60)}` };
    }
  }

  // 3. MAC OUI → VM detection
  for (const vm of VM_MAC_PREFIXES) {
    if (mac.startsWith(vm.prefix)) {
      return { type: 'vm', confidence: 90, reason: `MAC: ${vm.label}` };
    }
  }

  // 4. OS rules — check before services, as OS is quite reliable
  for (const rule of OS_RULES) {
    if (rule.pattern.test(os)) {
      return { type: rule.type, confidence: 85, reason: `OS: ${os}` };
    }
  }

  // 5. TTL=255 + vendor hints → network device
  const ttl = di.ttl?.ttl;
  if (ttl === 255 || (ttl >= 253 && ttl <= 255)) {
    // TTL 255 = network equipment (routers, switches, firewalls)
    // Try to narrow down based on other clues
    if (/comware|h3c|switch|catalyst|procurve/i.test(os + vendor)) {
      return { type: 'switch', confidence: 92, reason: `TTL ${ttl} + ${vendor || os}` };
    }
    if (/sophos|fortinet|fortigate/i.test(vendor + os)) {
      return { type: 'firewall', confidence: 92, reason: `TTL ${ttl} + ${vendor}` };
    }
    if (/ubiquiti|aruba|ruckus/i.test(vendor)) {
      return { type: 'ap', confidence: 92, reason: `TTL ${ttl} + ${vendor}` };
    }
    if (/cisco/i.test(vendor)) {
      return { type: 'switch', confidence: 88, reason: `TTL ${ttl} + ${vendor}` };
    }
    if (/hp|hewlett/i.test(vendor)) {
      return { type: 'switch', confidence: 88, reason: `TTL ${ttl} + ${vendor} (Netzwerkgerät)` };
    }
    if (/espressif/i.test(vendor)) {
      return { type: 'iot', confidence: 85, reason: `TTL ${ttl} + Espressif IoT` };
    }
    // Generic network device with TTL 255
    return { type: 'switch', confidence: 70, reason: `TTL ${ttl} (Netzwerkgerät)` };
  }

  // 6. Services/Ports
  const hasPrinterPort = openServices.some(s =>
    s.port === 631 || s.port === 9100 || /cups|ipp|printer|jetdirect/i.test(
      (s.identified_as || '') + (s.service_name || '')));

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
    // Switch management web UIs
    if (/comware.*switch|switch.*telnet/i.test(product + id)) {
      return { type: 'switch', confidence: 88, reason: `Switch-Dienst: ${product || id}` };
    }
    // RTSP = IP camera
    if (svc.port === 554 || /rtsp/i.test(name + id)) {
      return { type: 'camera', confidence: 85, reason: `RTSP-Stream (Port ${svc.port})` };
    }
    if (svc.port === 1883 || svc.port === 8883 || /mqtt/i.test(id + name)) {
      return { type: 'iot', confidence: 80, reason: 'MQTT-Broker' };
    }
  }

  // Printer detection — only if printer ports are present
  if (hasPrinterPort) {
    return { type: 'printer', confidence: 85, reason: 'Druckdienst erkannt' };
  }

  // 7. Vendor rules — refined, HP no longer blanket-printer
  const vendorRules = [
    { pattern: /cisco/i, type: 'switch', reason: 'Cisco' },
    { pattern: /juniper/i, type: 'router', reason: 'Juniper' },
    { pattern: /mikrotik/i, type: 'router', reason: 'MikroTik' },
    { pattern: /fortinet|fortigate/i, type: 'firewall', reason: 'Fortinet' },
    { pattern: /sophos/i, type: 'firewall', reason: 'Sophos' },
    { pattern: /avm/i, type: 'router', reason: 'AVM Fritz!Box' },
    { pattern: /ubiquiti/i, type: 'ap', reason: 'Ubiquiti' },
    { pattern: /aruba/i, type: 'ap', reason: 'Aruba' },
    { pattern: /ruckus/i, type: 'ap', reason: 'Ruckus' },
    { pattern: /tp-link/i, type: 'switch', reason: 'TP-Link' },
    { pattern: /netgear/i, type: 'switch', reason: 'Netgear' },
    { pattern: /d-link/i, type: 'switch', reason: 'D-Link' },
    { pattern: /zyxel/i, type: 'switch', reason: 'ZyXEL' },
    { pattern: /synology/i, type: 'nas', reason: 'Synology' },
    { pattern: /qnap/i, type: 'nas', reason: 'QNAP' },
    { pattern: /buffalo/i, type: 'nas', reason: 'Buffalo' },
    { pattern: /raspberry pi/i, type: 'iot', reason: 'Raspberry Pi' },
    { pattern: /espressif/i, type: 'iot', reason: 'Espressif (ESP)' },
    { pattern: /sonos/i, type: 'iot', reason: 'Sonos' },
    { pattern: /philips.*hue|signify/i, type: 'iot', reason: 'Philips Hue' },
    { pattern: /shenzhen baichuan/i, type: 'camera', reason: 'IP-Kamera (Baichuan)' },
    { pattern: /hikvision/i, type: 'camera', reason: 'Hikvision' },
    { pattern: /dahua/i, type: 'camera', reason: 'Dahua' },
    { pattern: /axis\s*communications/i, type: 'camera', reason: 'Axis' },
    { pattern: /brother/i, type: 'printer', reason: 'Brother' },
    { pattern: /canon/i, type: 'printer', reason: 'Canon' },
    { pattern: /epson/i, type: 'printer', reason: 'Epson' },
    { pattern: /lexmark/i, type: 'printer', reason: 'Lexmark' },
    { pattern: /xerox/i, type: 'printer', reason: 'Xerox' },
    { pattern: /nintendo/i, type: 'client', reason: 'Nintendo' },
    { pattern: /apple/i, type: 'client', reason: 'Apple' },
    { pattern: /samsung/i, type: 'client', reason: 'Samsung' },
    { pattern: /amazon/i, type: 'iot', reason: 'Amazon (Echo/IoT)' },
    { pattern: /google/i, type: 'iot', reason: 'Google (Home/IoT)' },
    { pattern: /robotron/i, type: 'iot', reason: 'Robotron (Smart Meter)' },
    { pattern: /edimax/i, type: 'iot', reason: 'Edimax' },
  ];

  // HP/Hewlett special handling: determine type by context
  if (/hp\b|hewlett.packard/i.test(vendor)) {
    // Check if it has switch indicators
    if (/comware|switch|procurve|1920|2530|2540|2920|3500|5400/i.test(os + snmpDescr)) {
      return { type: 'switch', confidence: 85, reason: `Hersteller: ${vendor} (Switch)` };
    }
    // Check if it has printer ports
    if (hasPrinterPort) {
      return { type: 'printer', confidence: 85, reason: `Hersteller: ${vendor} (Drucker)` };
    }
    // Telnet-only or web-only on HP → likely managed switch
    const ports = openServices.map(s => s.port);
    if (ports.includes(23) && !ports.includes(22) && ports.length <= 3) {
      return { type: 'switch', confidence: 75, reason: `Hersteller: ${vendor} (Telnet-Management)` };
    }
    // HP with Linux and server ports → server
    if (/linux/i.test(os)) {
      const serverPorts = openServices.filter(s => [22, 80, 443, 3306, 5432, 8080].includes(s.port));
      if (serverPorts.length >= 2) {
        return { type: 'server', confidence: 70, reason: `Hersteller: ${vendor} (Server)` };
      }
    }
    // Fallback: HP with no clear indication
    return { type: 'device', confidence: 40, reason: `Hersteller: ${vendor}` };
  }

  for (const rule of vendorRules) {
    if (rule.pattern.test(vendor)) {
      return { type: rule.type, confidence: 70, reason: `Hersteller: ${rule.reason}` };
    }
  }

  // 8. Heuristic: many server services
  const serverPorts = openServices.filter(s => {
    const p = s.port;
    return p === 22 || p === 80 || p === 443 || p === 3306 || p === 5432 ||
      p === 6379 || p === 27017 || p === 8080 || p === 8443;
  });
  if (serverPorts.length >= 2) {
    return { type: 'server', confidence: 60, reason: `${serverPorts.length} Server-Dienste` };
  }

  // 9. Windows without server services → client
  if (/windows/i.test(os) && serverPorts.length === 0) {
    return { type: 'client', confidence: 50, reason: 'Windows-Client' };
  }

  // 10. Has DNS port → DNS server
  if (openServices.some(s => s.port === 53)) {
    return { type: 'server', confidence: 55, reason: 'DNS-Server (Port 53)' };
  }

  // 11. Single SSH host without other services → likely server
  if (openServices.length === 1 && openServices[0].port === 22) {
    if (/linux/i.test(os)) {
      return { type: 'server', confidence: 45, reason: 'Linux + SSH' };
    }
  }

  // 12. Default
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
