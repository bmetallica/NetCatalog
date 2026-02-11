#!/usr/bin/env node

/**
 * Debug script to discover FritzBox UPnP services
 * Usage: node debug-fritzbox.js <host> <username> <password>
 */

const https = require('https');
const http = require('http');
const xml2js = require('xml2js');

const host = process.argv[2] || 'http://192.168.66.91';
const username = process.argv[3] || 'netcatalog';
const password = process.argv[4] || 'netcatalog2026';

const xmlParser = new xml2js.Parser();

async function fetchXml(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'User-Agent': 'netcatalog/1.0',
      },
      rejectUnauthorized: false,
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const parsed = await xmlParser.parseStringPromise(data);
          resolve(parsed);
        } catch (err) {
          console.error(`XML parse error: ${err.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function debug() {
  console.log(`\n🔍 Discovering FritzBox at ${host}\n`);

  try {
    // Fetch root device descriptor
    console.log('📋 Fetching root device descriptor...');
    const rootDesc = await fetchXml(`${host}/rootDesc.xml`);
    
    if (!rootDesc) {
      console.error('❌ Failed to fetch root descriptor');
      return;
    }

    console.log('✅ Root descriptor fetched');
    
    const device = rootDesc.root?.device?.[0];
    if (device) {
      console.log(`\n📱 Device Info:`);
      console.log(`   Model: ${device.modelName?.[0] || 'Unknown'}`);
      console.log(`   Manufacturer: ${device.manufacturer?.[0] || 'Unknown'}`);
      console.log(`   Serial: ${device.serialNumber?.[0] || 'Unknown'}`);
    }

    // List available services
    const deviceList = rootDesc.root?.device?.[0]?.deviceList?.[0]?.device || [];
    console.log(`\n🔧 Found ${deviceList.length} sub-devices`);
    
    for (const subDevice of deviceList) {
      const deviceType = subDevice.deviceType?.[0];
      const friendlyName = subDevice.friendlyName?.[0];
      const serviceList = subDevice.serviceList?.[0]?.service || [];
      
      console.log(`\n   📦 ${friendlyName || deviceType}`);
      for (const svc of serviceList) {
        const serviceType = svc.serviceType?.[0];
        const serviceId = svc.serviceId?.[0];
        const controlUrl = svc.controlURL?.[0];
        
        console.log(`      • ${serviceType}`);
        console.log(`        Control: ${controlUrl}`);
      }
    }

    // Try specific services
    console.log(`\n\n🧪 Testing Common Services:\n`);

    // Test WLANConfiguration
    console.log('Trying WLANConfiguration...');
    try {
      const result = await testService('WLANConfiguration', 'GetInfo');
      console.log('✅ WLANConfiguration#GetInfo: WORKS');
    } catch (err) {
      console.log(`❌ WLANConfiguration: ${err.message}`);
    }

    // Test DeviceInfo
    console.log('Trying DeviceInfo...');
    try {
      const result = await testService('DeviceInfo', 'GetInfo');
      console.log('✅ DeviceInfo#GetInfo: WORKS');
    } catch (err) {
      console.log(`❌ DeviceInfo: ${err.message}`);
    }

    // Test Hosts
    console.log('Trying Hosts (LANHosts)...');
    try {
      const result = await testService('Hosts', 'GetHostNumberOfEntries');
      console.log('✅ Hosts#GetHostNumberOfEntries: WORKS');
    } catch (err) {
      console.log(`❌ Hosts: ${err.message}`);
    }

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
  }
}

async function testService(service, action) {
  return new Promise((resolve, reject) => {
    const servicePath = {
      'WLANConfiguration': '/upnp/control/wlanconfig1',
      'DeviceInfo': '/upnp/control/deviceinfo',
      'Hosts': '/upnp/control/hosts1',
    }[service];

    if (!servicePath) {
      reject(new Error(`Unknown service: ${service}`));
      return;
    }

    const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" 
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="urn:dslforum-org:service:${service}">
    </u:${action}>
  </s:Body>
</s:Envelope>`;

    const url = new URL(host);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: servicePath,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPAction': `urn:dslforum-org:service:${service}#${action}`,
        'User-Agent': 'netcatalog/1.0',
      },
      rejectUnauthorized: false,
    };

    const req = client.request(options, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(soapBody);
    req.end();
  });
}

debug();
