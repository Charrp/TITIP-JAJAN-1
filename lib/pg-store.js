'use strict';

/* Postgres lewat paket "pg" untuk server Node biasa (Render, VPS, laptop). Tidak dipakai di Cloudflare. */

const { createStore } = require('./store');

function createPgStore(databaseUrl) {
  const { Pool } = require('pg');
  let cs = databaseUrl;
  try {
    const u = new URL(databaseUrl);
    u.searchParams.delete('channel_binding');
    cs = u.toString();
  } catch (e) { /* pakai apa adanya */ }
  const pool = new Pool({ connectionString: cs, max: 4, idleTimeoutMillis: 20000, connectionTimeoutMillis: 20000 });
  pool.on('error', (e) => console.error('Koneksi database terputus, akan disambung lagi:', e.message));
  const store = createStore(async (text, params) => (await pool.query(text, params)).rows);
  store.close = () => pool.end();
  return store;
}

module.exports = { createPgStore };
