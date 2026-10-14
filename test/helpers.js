'use strict';

/*
 * Pembantu tes. Tes memakai SQLite bawaan Node (tanpa instalasi apa pun).
 * Kalau TD_TEST_PG diisi (string koneksi psql), tes yang sama dijalankan juga ke Postgres sungguhan lewat psql.
 */

const http = require('http');
const { execFileSync } = require('child_process');
const { createStore } = require('../lib/store');
const { createApp } = require('../server');
const { dbLimiter } = require('../lib/limiter');

function sqliteQuery() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return async (text, params) => {
    const sql = text.replace(/\$(\d+)/g, '?$1');
    const args = (params || []).map((x) => (x === undefined ? null : x));
    const stmt = db.prepare(sql);
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(sql) && (/^\s*SELECT/i.test(sql) || /RETURNING/i.test(sql))) {
      return stmt.all(...args).map((r) => Object.assign({}, r));
    }
    stmt.run(...args);
    return [];
  };
}

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/* Adaptor Postgres sungguhan lewat psql: parameter ditanam sebagai literal yang di-escape. */
function psqlQuery(conn) {
  return async (text, params) => {
    const sql = text.replace(/\$(\d+)/g, (_, n) => lit((params || [])[Number(n) - 1]));
    let wrapped = sql;
    if (/^\s*SELECT/i.test(sql)) wrapped = `SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t`;
    else if (/RETURNING/i.test(sql)) wrapped = `WITH t AS (${sql}) SELECT coalesce(json_agg(t), '[]'::json) FROM t`;
    try {
      const out = execFileSync('psql', [conn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', wrapped], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const s = out.trim();
      return s ? JSON.parse(s.split('\n')[0]) : [];
    } catch (e) {
      const err = new Error(String(e.stderr || e.message));
      const m = /ERROR:\s+duplicate key/.test(String(e.stderr)) ? '23505' : undefined;
      if (m) err.code = m;
      throw err;
    }
  };
}

async function makeStore(kind) {
  const query = kind === 'pg' ? psqlQuery(process.env.TD_TEST_PG) : sqliteQuery();
  const store = createStore(query);
  if (kind === 'pg') {
    await query('DROP TABLE IF EXISTS requests', []);
    await query('DROP TABLE IF EXISTS settings', []);
    await query('DROP TABLE IF EXISTS ratelimit', []);
  }
  await store.init();
  return store;
}

const BACKENDS = ['sqlite'].concat(process.env.TD_TEST_PG ? ['pg'] : []);

const BASE_CONFIG = {
  production: false, port: 0, databaseUrl: 'x', adminPassword: 'rahasia-banget', sessionSecret: 'secret-secret-secret-1234', adminWa: '6281234567890',
};

/* Menyalakan server di port acak. clock.t bisa diubah dari tes. */
async function startServer(kind, overrides) {
  const store = await makeStore(kind);
  const clock = { t: Date.now() };
  const config = Object.assign({}, BASE_CONFIG, overrides || {});
  const limiter = process.env.TD_TEST_LIMITER === 'db' ? dbLimiter(store) : undefined;
  const server = http.createServer(createApp({ store, config, now: () => clock.t, limiter }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function req(method, path, opts) {
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {});
    if (o.json !== undefined) {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }
    if (o.admin !== false && cookie && !headers.Cookie) headers.Cookie = cookie;
    if (method !== 'GET' && o.xrw !== false) headers['X-Requested-With'] = 'tolong-dong';
    const res = await fetch(base + path, { method, headers, body: o.raw !== undefined ? o.raw : (o.json !== undefined ? JSON.stringify(o.json) : undefined) });
    const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* bukan JSON */ }
    return { status: res.status, headers: res.headers, text, data };
  }
  async function login(pw) {
    const r = await req('POST', '/api/admin/login', { json: { password: pw || BASE_CONFIG.adminPassword }, admin: false });
    const sc = r.headers.get('set-cookie');
    if (r.status === 200 && sc) cookie = sc.split(';')[0];
    return r;
  }
  return {
    base, store, clock, req, login, config,
    setCookie: (c) => { cookie = c; },
    getCookie: () => cookie,
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { BACKENDS, startServer, BASE_CONFIG, makeStore };
