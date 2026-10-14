'use strict';

/*
 * Database Neon lewat HTTP (paket @neondatabase/serverless). Dipakai di Cloudflare Workers,
 * karena Workers tidak menjaga koneksi terbuka. Setiap query satu permintaan HTTP.
 */

const { createStore } = require('./store');

function createNeonStore(databaseUrl) {
  let cs = databaseUrl;
  try {
    const u = new URL(databaseUrl);
    u.searchParams.delete('channel_binding');
    cs = u.toString();
  } catch (e) { /* pakai apa adanya */ }
  let sqlPromise = null;
  function getSql() {
    if (!sqlPromise) {
      /* Impor dinamis dengan nama tetap: wrangler menyatukannya ke dalam paket Worker saat deploy. */
      sqlPromise = import('@neondatabase/serverless').then((m) => m.neon(cs));
    }
    return sqlPromise;
  }
  return createStore(async (text, params) => {
    const sql = await getSql();
    const rows = await sql.query(text, params);
    return Array.isArray(rows) ? rows : (rows && rows.rows) || [];
  });
}

module.exports = { createNeonStore };
