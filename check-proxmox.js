#!/usr/bin/env node
require('dotenv').config();
const pool = require('./src/db/pool');

async function check() {
  try {
    console.log('Prüfe Proxmox-Konfiguration für 192.168.66.134...\n');
    
    const res = await pool.query(`
      SELECT id, host(ip_address) as ip, hostname, device_type, os_guess,
             proxmox_api_host, proxmox_api_token_id, 
             CASE WHEN proxmox_api_token_secret IS NOT NULL THEN 'GESETZT (' || length(proxmox_api_token_secret) || ' Zeichen)' ELSE 'NICHT GESETZT' END as token_secret
      FROM hosts 
      WHERE host(ip_address) = '192.168.66.134'
    `);
    
    if (res.rows.length === 0) {
      console.log('❌ Host 192.168.66.134 nicht in Datenbank gefunden!');
      process.exit(1);
    }
    
    const host = res.rows[0];
    console.log('Host-Details:');
    console.log('  ID:', host.id);
    console.log('  IP:', host.ip);
    console.log('  Hostname:', host.hostname || '(nicht gesetzt)');
    console.log('  Device Type:', host.device_type || '(nicht gesetzt)');
    console.log('  OS Guess:', host.os_guess || '(nicht gesetzt)');
    console.log('\nProxmox-Credentials:');
    console.log('  API Host:', host.proxmox_api_host || '❌ NICHT GESETZT');
    console.log('  Token ID:', host.proxmox_api_token_id || '❌ NICHT GESETZT');
    console.log('  Token Secret:', host.token_secret);
    
    if (!host.proxmox_api_host || !host.proxmox_api_token_id || host.token_secret === 'NICHT GESETZT') {
      console.log('\n❌ Proxmox-Credentials sind unvollständig!');
      process.exit(1);
    }
    
    console.log('\n✅ Credentials sind gesetzt!');
    
    // Prüfe, ob Host als Hypervisor erkannt werden würde
    const hvCheck = await pool.query(`
      SELECT id FROM hosts 
      WHERE host(ip_address) = '192.168.66.134'
        AND (device_type = 'hypervisor' OR os_guess ILIKE '%proxmox%')
        AND proxmox_api_host IS NOT NULL
        AND proxmox_api_token_id IS NOT NULL
        AND proxmox_api_token_secret IS NOT NULL
    `);
    
    if (hvCheck.rows.length === 0) {
      console.log('\n⚠️  Host wird NICHT als Proxmox-Hypervisor erkannt!');
      console.log('   Grund: device_type ist nicht "hypervisor" und os_guess enthält nicht "proxmox"');
      console.log('   Setze device_type manuell auf "hypervisor" in der UI');
    } else {
      console.log('\n✅ Host wird als Proxmox-Hypervisor erkannt und bei Deep Discovery abgefragt');
    }
    
    await pool.end();
  } catch (err) {
    console.error('Fehler:', err.message);
    process.exit(1);
  }
}

check();
