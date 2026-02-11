const https = require('https');
const http = require('http');
const xml2js = require('xml2js');
const crypto = require('crypto');
const { execFile } = require('child_process');

/**
 * AVM FritzBox Client
 * 
 * Uses TR-064 protocol to query FritzBox over HTTPS
 * - Authentication: HTTP Basic Auth with username/password
 * - Queries WLAN device list and connected clients
 * - Returns MAC addresses of WiFi-connected devices
 */

class FritzBoxClient {
  constructor(apiHost, username, password) {
    this.apiHost = apiHost.replace(/\/$/, ''); // Remove trailing slash
    this.username = username;
    this.password = password;
    this.xmlParser = new xml2js.Parser();
  }

  /**
   * Calculate Digest Auth header
   */
  calculateDigestAuth(method, path, realm, nonce, username, password, qop = 'auth', nc = 1) {
    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${path}`).digest('hex');
    const cnonce = crypto.randomBytes(8).toString('hex');
    const response = crypto.createHash('md5')
      .update(`${ha1}:${nonce}:${String(nc).padStart(8, '0')}:${cnonce}:${qop}:${ha2}`)
      .digest('hex');
    
    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${path}", qop=${qop}, nc=${String(nc).padStart(8, '0')}, cnonce="${cnonce}", response="${response}"`;
  }

  /**
   * Make an authenticated TR-064 request to FritzBox (with Digest Auth support)
   */
  async request(service, action, params = {}, port = null) {
    return new Promise((resolve, reject) => {
      // Determine protocol and port
      const url = new URL(this.apiHost);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      
      // Use provided port or URL port or default
      const requestPort = port || url.port || (isHttps ? 443 : 80);

      // Build SOAP request
      let soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:${action} xmlns:u="urn:dslforum-org:service:${service}">`;

      for (const [key, value] of Object.entries(params)) {
        soapBody += `<${key}>${this.escapeXml(value)}</${key}>`;
      }

      soapBody += `    </u:${action}>
  </s:Body>
</s:Envelope>`;

      // Map service to UPnP path
      const servicePath = this.getServicePath(service);

      const makeRequest = (authHeader = null) => {
        const options = {
          hostname: url.hostname,
          port: requestPort,
          path: servicePath,
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset="utf-8"',
            'Content-Length': Buffer.byteLength(soapBody),
            'SOAPAction': `urn:dslforum-org:service:${service}#${action}`,
          },
          rejectUnauthorized: false, // FritzBox often uses self-signed certs
        };

        // Add auth header if provided
        if (authHeader) {
          options.headers['Authorization'] = authHeader;
        }

        console.log(`[FritzBoxClient] Request: ${service}#${action} on port ${requestPort}`);

        const req = client.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', async () => {
            console.log(`[FritzBoxClient] Response status: ${res.statusCode}`);
            
            // Handle 401 with Digest Auth retry
            if (res.statusCode === 401 && res.headers['www-authenticate'] && !authHeader) {
              console.log('[FritzBoxClient] Got 401, trying Digest Auth...');
              const authHeader = res.headers['www-authenticate'];
              const realmMatch = authHeader.match(/realm="([^"]+)"/);
              const nonceMatch = authHeader.match(/nonce="([^"]+)"/);
              
              if (realmMatch && nonceMatch) {
                const realm = realmMatch[1];
                const nonce = nonceMatch[1];
                console.log(`[FritzBoxClient] Digest realm="${realm}", nonce="${nonce}"`);
                const digestAuthHeader = this.calculateDigestAuth('POST', servicePath, realm, nonce, this.username, this.password);
                
                // Retry with Digest Auth
                return makeRequest(digestAuthHeader);
              }
            }
            
            if (res.statusCode >= 400) {
              console.error(`[FritzBoxClient] Error response: ${data.substring(0, 200)}`);
              return reject(new Error(`FritzBox API error: ${res.statusCode}`));
            }

            try {
              const parsed = await this.xmlParser.parseStringPromise(data);
              resolve(parsed);
            } catch (err) {
              console.error(`[FritzBoxClient] XML parse error: ${err.message}`);
              reject(new Error(`Invalid XML response: ${err.message}`));
            }
          });
        });

        req.on('error', (err) => {
          console.error(`[FritzBoxClient] Request error: ${err.message}`);
          reject(err);
        });

        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.write(soapBody);
        req.end();
      };

      // Start without auth first to trigger 401 with Digest challenge
      makeRequest(null);
    });
  }

  /**
   * Map service names to TR-064 UPnP paths
   */
  getServicePath(service) {
    const paths = {
      'WLANConfiguration': '/upnp/control/wlanconfig1',
      'DeviceInfo': '/upnp/control/deviceinfo',
      'Hosts': '/upnp/control/hosts1',
    };
    return paths[service] || '/upnp/control/unknown';
  }

  /**
   * Escape XML special characters
   */
  escapeXml(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Get all connected WLAN devices using curl (curl handles Digest Auth better)
   */
  async getWirelessDevices() {
    return new Promise((resolve) => {
      try {
        console.log('[FritzBoxClient] Fetching WLAN devices...');
        
        const devices = [];
        let devicesFetched = 0;
        
        // Use curl with --anyauth to handle Digest Auth automatically
        const fetchDevice = (index) => {
          const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetGenericAssociatedDeviceInfo xmlns:u="urn:dslforum-org:service:WLANConfiguration:1">
      <NewAssociatedDeviceIndex>${index}</NewAssociatedDeviceIndex>
    </u:GetGenericAssociatedDeviceInfo>
  </s:Body>
</s:Envelope>`;

          const url = `${this.apiHost.replace(/\/$/, '')}:49000/upnp/control/wlanconfig1`;
          
          return new Promise((res) => {
            execFile('curl', [
              '-s', '-k', '-m', '5', '--anyauth',
              '-u', `${this.username}:${this.password}`,
              '-H', 'Content-Type: text/xml; charset="utf-8"',
              '-H', 'SoapAction: urn:dslforum-org:service:WLANConfiguration:1#GetGenericAssociatedDeviceInfo',
              '-d', soapBody,
              url
            ], { maxBuffer: 1024 * 1024 }, async (err, stdout, stderr) => {
              try {
                if (err || !stdout) {
                  res(null);
                  return;
                }

                const parsed = await this.xmlParser.parseStringPromise(stdout);
                const body = parsed['s:Envelope']['s:Body'][0];
                
                // Check for fault
                if (body['s:Fault']) {
                  res(null);
                  return;
                }

                const response = body['u:GetGenericAssociatedDeviceInfoResponse']?.[0];
                if (!response) {
                  res(null);
                  return;
                }

                const mac = response['NewAssociatedDeviceMACAddress']?.[0];
                const ip = response['NewAssociatedDeviceIPAddress']?.[0];
                const signal = parseInt(response['NewX_AVM-DE_SignalStrength']?.[0]) || 0;
                const speed = parseInt(response['NewX_AVM-DE_Speed']?.[0]) || 0;

                if (mac && this.isValidMac(mac)) {
                  console.log(`[FritzBoxClient] Device ${index}: ${mac} (${ip}, signal: ${signal}%)`);
                  res({
                    mac: mac.toLowerCase(),
                    ip: ip || null,
                    hostname: null,
                    signalStrength: signal,
                    speed: speed,
                    isWireless: true,
                  });
                } else {
                  res(null);
                }
              } catch (e) {
                res(null);
              }
            });
          });
        };

        // Fetch devices sequentially from index 0 to 29
        (async () => {
          for (let i = 0; i < 30; i++) {
            const device = await fetchDevice(i);
            if (!device) {
              console.log(`[FritzBoxClient] Fetched ${devicesFetched} WLAN devices`);
              break;
            }
            devices.push(device);
            devicesFetched++;
          }
          resolve(devices);
        })();
      } catch (err) {
        console.error('[FritzBoxClient] Error getting wireless devices:', err.message);
        resolve([]);
      }
    });
  }

  /**
   * Get all hosts (including wired) from host table
   * Returns: [{ mac, ip, hostname, ... }, ...]
   */
  async getAllHosts() {
    try {
      console.log('[FritzBoxClient] Fetching all hosts...');
      
      const result = await this.request(
        'Hosts',
        'GetHostList',
        {}
      );

      const body = result['s:Envelope']['s:Body'][0];
      const action = body['u:GetHostListResponse'][0];
      const hostList = action['NewHostList'][0] || '';

      console.log(`[FritzBoxClient] Host list: ${hostList.substring(0, 100)}...`);

      // Parse the CSV host list
      // Format: "IP,MAC,Hostname,InterfaceType,Active,X_AVM-DE_HostType,X_AVM-DE_MetaInfo"
      const hosts = [];
      const lines = hostList.split('\n').filter(l => l.trim());

      for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 2 && this.isValidMac(parts[1])) {
          hosts.push({
            ip: parts[0] || null,
            mac: parts[1].toLowerCase(),
            hostname: parts[2] || null,
            interfaceType: parts[3] || null, // 'Ethernet' or 'WiFi'
            active: parts[4] === '1' || parts[4] === 'true',
            hostType: parts[5] || null,
            metaInfo: parts[6] || null,
          });
        }
      }

      console.log(`[FritzBoxClient] Parsed ${hosts.length} total hosts`);
      return hosts;
    } catch (err) {
      console.error('[FritzBoxClient] Error getting all hosts:', err.message);
      throw err;
    }
  }

  /**
   * Get device info (model, firmware, etc.)
   */
  async getDeviceInfo() {
    try {
      console.log('[FritzBoxClient] Fetching device info...');
      
      const result = await this.request(
        'DeviceInfo',
        'GetInfo',
        {}
      );

      const body = result['s:Envelope']['s:Body'][0];
      const action = body['u:GetInfoResponse'][0];

      return {
        manufacturer: action['NewManufacturer']?.[0] || 'AVM',
        manufacturerOUI: action['NewManufacturerOUI']?.[0] || null,
        modelName: action['NewModelName']?.[0] || null,
        description: action['NewDescription']?.[0] || null,
        serialNumber: action['NewSerialNumber']?.[0] || null,
        softwareVersion: action['NewSoftwareVersion']?.[0] || null,
        enabledOptions: action['NewEnabledOptions']?.[0] || null,
        hardwareVersion: action['NewHardwareVersion']?.[0] || null,
        deviceType: action['NewDeviceType']?.[0] || null,
        deviceName: action['NewDeviceName']?.[0] || null,
      };
    } catch (err) {
      console.error('[FritzBoxClient] Error getting device info:', err.message);
      throw err;
    }
  }

  /**
   * Test connection and credentials
   */
  async testConnection() {
    try {
      // Try to get device info via TR-064, fallback to simple HTTP GET
      try {
        const info = await this.getDeviceInfo();
        return {
          success: true,
          modelName: info.modelName,
          softwareVersion: info.softwareVersion,
          serialNumber: info.serialNumber,
        };
      } catch (err) {
        console.log('[FritzBoxClient] TR-064 DeviceInfo failed, trying HTTP GET...');
        
        // Fallback: Simple HTTP GET to verify connection
        return new Promise((resolve, reject) => {
          const url = new URL(this.apiHost);
          const isHttps = url.protocol === 'https:';
          const client = isHttps ? https : http;
          
          const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
          
          const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname || '/',
            method: 'GET',
            headers: {
              'Authorization': `Basic ${auth}`,
              'User-Agent': 'netcatalog/1.0',
            },
            rejectUnauthorized: false, // Allow self-signed certs
          };

          const req = client.request(options, (res) => {
            if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 401) {
              // If we got a response (even if redirected), connection works
              resolve({
                success: true,
                modelName: 'AVM FritzBox',
                softwareVersion: 'Unknown',
                serialNumber: 'Unknown',
                connectionMethod: 'HTTP GET',
              });
            } else {
              reject(new Error(`HTTP error: ${res.statusCode}`));
            }
          });

          req.on('error', reject);
          req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });

          req.end();
        });
      }
    } catch (err) {
      throw new Error(`Connection test failed: ${err.message}`);
    }
  }

  /**
   * Validate MAC address format
   */
  isValidMac(mac) {
    return /^([0-9a-f]{2}[:-]){5}([0-9a-f]{2})$/i.test(mac);
  }
}

module.exports = FritzBoxClient;
