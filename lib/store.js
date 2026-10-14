'use strict';

/*
 * Lapisan database. SQL-nya sengaja dibuat sederhana dan sama di Postgres.
 * createStore menerima fungsi query(teks, parameter) yang mengembalikan array baris.
 */

/* WebCrypto bawaan, jalan di Node 20+ dan Cloudflare Workers tanpa modul tambahan. */
const crypto = globalThis.crypto;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLS = ['id', 'kode', 'nama', 'hp', 'email', 'jenis', 'pesan', 'daerah', 'kec', 'alamat', 'tanggal', 'jam', 'status', 'biaya', 'metode', 'bayar', 'dibayar_at', 'created_at', 'source'];
const PATCHABLE = ['status', 'biaya', 'metode', 'bayar', 'dibayar_at'];

function randomCode(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

function isUnique(e) {
  return !!e && (e.code === '23505' || /unique constraint/i.test(String(e.message)));
}

function mapRow(r) {
  return {
    id: r.id,
    kode: r.kode,
    nama: r.nama,
    hp: r.hp,
    email: r.email,
    jenis: r.jenis,
    pesan: r.pesan,
    daerah: r.daerah,
    kec: r.kec,
    alamat: r.alamat,
    tanggal: r.tanggal,
    jam: r.jam,
    status: r.status,
    biaya: Number(r.biaya) || 0,
    metode: r.metode,
    bayar: r.bayar,
    dibayarAt: r.dibayar_at == null ? null : Number(r.dibayar_at),
    createdAt: Number(r.created_at),
    source: r.source,
  };
}

function createStore(query) {
  async function init() {
    await query(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      kode TEXT NOT NULL UNIQUE,
      nama TEXT NOT NULL,
      hp TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      jenis TEXT NOT NULL DEFAULT '',
      pesan TEXT NOT NULL,
      daerah TEXT NOT NULL,
      kec TEXT NOT NULL DEFAULT '',
      alamat TEXT NOT NULL DEFAULT '',
      tanggal TEXT NOT NULL,
      jam TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'baru',
      biaya BIGINT NOT NULL DEFAULT 0,
      metode TEXT NOT NULL DEFAULT '',
      bayar TEXT NOT NULL DEFAULT 'belum',
      dibayar_at BIGINT,
      created_at BIGINT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web'
    )`, []);
    await query('CREATE INDEX IF NOT EXISTS requests_created_idx ON requests (created_at)', []);
    await query('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)', []);
    await query('CREATE TABLE IF NOT EXISTS ratelimit (id TEXT PRIMARY KEY, k TEXT NOT NULL, t BIGINT NOT NULL)', []);
    await query('CREATE INDEX IF NOT EXISTS ratelimit_k_idx ON ratelimit (k, t)', []);
  }

  /* opts: { nowMs, md (MMDD Jakarta), source, kode (opsional, harus unik) } */
  async function create(value, opts) {
    const id = crypto.randomUUID();
    const fixed = opts.kode || '';
    for (let attempt = 0; attempt < 8; attempt++) {
      const kode = fixed || `TD-${opts.md}-${randomCode(attempt < 6 ? 3 : 4)}`;
      const params = [id, kode, value.nama, value.hp, value.email, value.jenis, value.pesan, value.daerah, value.kec, value.alamat, value.tanggal, value.jam, 'baru', 0, '', 'belum', null, opts.nowMs, opts.source || 'web'];
      try {
        const rows = await query(`INSERT INTO requests (${COLS.join(', ')}) VALUES (${COLS.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`, params);
        return mapRow(rows[0]);
      } catch (e) {
        if (isUnique(e)) {
          if (fixed) { const err = new Error('Nota sudah ada.'); err.code = 'DUPLICATE_KODE'; throw err; }
          continue;
        }
        throw e;
      }
    }
    throw new Error('Tidak bisa membuat nomor nota yang unik.');
  }

  async function list(limit) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 500)) | 0;
    const rows = await query(`SELECT * FROM requests ORDER BY created_at DESC LIMIT ${n}`, []);
    return rows.map(mapRow);
  }

  async function get(id) {
    const rows = await query('SELECT * FROM requests WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async function update(id, patch) {
    const keys = Object.keys(patch).filter((k) => PATCHABLE.includes(k));
    if (!keys.length) return get(id);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const rows = await query(`UPDATE requests SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`, keys.map((k) => patch[k]).concat([id]));
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async function remove(id) {
    const rows = await query('DELETE FROM requests WHERE id = $1 RETURNING id', [id]);
    return rows.length > 0;
  }

  async function getSetting(k) {
    const rows = await query('SELECT v FROM settings WHERE k = $1', [k]);
    return rows[0] ? String(rows[0].v) : '';
  }

  async function setSetting(k, v) {
    await query('INSERT INTO settings (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v', [k, v]);
  }

  async function ping() {
    await query('SELECT 1 AS ok', []);
  }

  /* Pembatas laju disimpan di database supaya tetap berlaku di server tanpa memori bersama (Cloudflare Workers). */
  async function rlTake(key, limit, windowMs, nowMs) {
    const rows = await query(
      'INSERT INTO ratelimit (id, k, t) SELECT CAST($1 AS TEXT), CAST($2 AS TEXT), CAST($3 AS BIGINT) WHERE (SELECT COUNT(*) FROM ratelimit WHERE k = $2 AND t > $4) < $5 RETURNING id',
      [crypto.randomUUID(), key, nowMs, nowMs - windowMs, limit]);
    return rows.length > 0;
  }
  async function rlCount(key, windowMs, nowMs) {
    const rows = await query('SELECT COUNT(*) AS n FROM ratelimit WHERE k = $1 AND t > $2', [key, nowMs - windowMs]);
    return Number(rows[0] && rows[0].n) || 0;
  }
  async function rlAdd(key, nowMs) {
    await query('INSERT INTO ratelimit (id, k, t) VALUES ($1, $2, $3)', [crypto.randomUUID(), key, nowMs]);
  }
  async function rlClear(key) {
    await query('DELETE FROM ratelimit WHERE k = $1', [key]);
  }
  async function rlSweep(beforeMs) {
    await query('DELETE FROM ratelimit WHERE t < $1', [beforeMs]);
  }

  return { init, create, list, get, update, remove, getSetting, setSetting, ping, rlTake, rlCount, rlAdd, rlClear, rlSweep };
}

/* Menjalankan init() dengan beberapa kali percobaan, karena database Neon bisa perlu beberapa detik untuk bangun. */
async function initWithRetry(store, tries, delayMs) {
  const n = tries || 6;
  for (let i = 1; i <= n; i++) {
    try { await store.init(); return; } catch (e) {
      console.error(`Database belum siap (percobaan ${i}/${n}): ${e.message}`);
      if (i === n) throw e;
      await new Promise((r) => setTimeout(r, delayMs || 3000));
    }
  }
}

module.exports = { createStore, initWithRetry, mapRow };
