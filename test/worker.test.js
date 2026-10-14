'use strict';

/*
 * Tes jalur Cloudflare Worker (worker.mjs) memakai database pengganti dan ASSETS palsu.
 * Yang tidak bisa dites di sini: wrangler, runtime workerd, dan driver Neon asli.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../lib/validate');
const { BACKENDS, makeStore } = require('./helpers');

const ENV_BASE = { DATABASE_URL: 'postgresql://x', ADMIN_PASSWORD: 'rahasia-banget', SESSION_SECRET: 'secret-secret-secret-1234', ADMIN_WA: '081234567890' };

function fakeAssets() {
  return {
    async fetch(req) {
      const f = path.join(__dirname, '..', 'public', new URL(req.url).pathname);
      if (!fs.existsSync(f)) return new Response('nope', { status: 404 });
      return new Response(fs.readFileSync(f), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    },
  };
}
function order() {
  return {
    nama: 'Citra Lestari', hp: '0812 9999 1111', pesan: 'Tolong antar paket ke kantor pos Margonda.', daerah: 'depok', kec: 'Beji',
    tanggal: V.jakartaParts(Date.now() + 36 * 3600e3).ymd, jam: '11:00',
  };
}

for (const kind of BACKENDS) {
  test(`[worker/${kind}] halaman, pesanan, login, dan pembatas di database`, async () => {
    const { createWorker } = await import('../worker.mjs');
    const store = await makeStore(kind);
    const clock = { t: Date.now() };
    const w = createWorker({ makeStore: () => store, now: () => clock.t });
    const env = Object.assign({ ASSETS: fakeAssets() }, ENV_BASE);
    let cookie = '';
    async function call(method, p, o) {
      const x = o || {};
      const headers = Object.assign({ 'cf-connecting-ip': x.ip || '198.51.100.7' }, x.headers || {});
      if (x.json !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET') headers['X-Requested-With'] = 'tolong-dong';
      if (cookie && x.cookie !== false) headers.Cookie = cookie;
      const res = await w.fetch(new Request('https://tolong.example' + p, { method, headers, body: x.json !== undefined ? JSON.stringify(x.json) : undefined }), env);
      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch (e) { /* bukan JSON */ }
      return { status: res.status, headers: res.headers, text, data };
    }

    /* halaman statis lewat ASSETS */
    const home = await call('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(home.headers.get('strict-transport-security'), /max-age/);
    assert.ok(home.text.includes('Ada yang perlu dibantu'));
    assert.equal((await call('GET', '/admin')).status, 200);
    const css = await call('GET', '/style.css');
    assert.match(css.headers.get('content-type'), /text\/css/);
    for (const p of ['/server.js', '/worker.mjs', '/lib/store.js', '/index.html']) assert.equal((await call('GET', p)).status, 404, p);
    assert.equal((await call('POST', '/', { json: {} })).status, 405);
    assert.equal((await call('GET', '/healthz')).status, 200);

    /* konfigurasi dan pesanan */
    assert.deepEqual((await call('GET', '/api/config')).data, { adminWa: '6281234567890', payInfo: '' });
    const o = await call('POST', '/api/requests', { json: order() });
    assert.equal(o.status, 201);
    assert.match(o.data.kode, /^TD-\d{4}-[A-Z2-9]{3,4}$/);
    assert.equal((await call('POST', '/api/requests', { json: { nama: 'x' } })).status, 400);

    /* login memberi cookie Secure, lalu papan terbaca */
    assert.equal((await call('GET', '/api/admin/requests')).status, 401);
    const bad = await call('POST', '/api/admin/login', { json: { password: 'salah-salah' } });
    assert.equal(bad.status, 401);
    const ok = await call('POST', '/api/admin/login', { json: { password: ENV_BASE.ADMIN_PASSWORD } });
    assert.equal(ok.status, 200);
    const sc = ok.headers.get('set-cookie');
    assert.match(sc, /Secure/); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
    cookie = sc.split(';')[0];
    const list = await call('GET', '/api/admin/requests');
    assert.equal(list.data.items.length, 1);
    assert.equal(list.data.items[0].nama, 'Citra Lestari');
    const id = list.data.items[0].id;
    assert.equal((await call('PATCH', '/api/admin/requests/' + id, { json: { status: 'selesai', biaya: 30000, metode: 'transfer', bayar: 'lunas' } })).data.item.bayar, 'lunas');
    const csv = await call('GET', '/api/admin/export.csv');
    assert.ok(csv.text.includes('Citra Lestari'));

    /* pembatas di database: 8 pesanan per IP per 15 menit */
    for (let i = 0; i < 7; i++) assert.equal((await call('POST', '/api/requests', { json: order(), ip: '203.0.113.50' })).status, 201);
    assert.equal((await call('POST', '/api/requests', { json: order(), ip: '203.0.113.50' })).status, 201);
    assert.equal((await call('POST', '/api/requests', { json: order(), ip: '203.0.113.50' })).status, 429);
    assert.equal((await call('POST', '/api/requests', { json: order(), ip: '203.0.113.51' })).status, 201);
    clock.t += 16 * 60e3;
    assert.equal((await call('POST', '/api/requests', { json: order(), ip: '203.0.113.50' })).status, 201);

    /* kunci login setelah 5 kali salah, per IP */
    cookie = '';
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/admin/login', { json: { password: 'salah-' + i }, ip: '192.0.2.99' })).status, 401);
    assert.equal((await call('POST', '/api/admin/login', { json: { password: ENV_BASE.ADMIN_PASSWORD }, ip: '192.0.2.99' })).status, 429);
    assert.equal((await call('POST', '/api/admin/login', { json: { password: ENV_BASE.ADMIN_PASSWORD }, ip: '192.0.2.100' })).status, 200);
    clock.t += 11 * 60e3;
    assert.equal((await call('POST', '/api/admin/login', { json: { password: ENV_BASE.ADMIN_PASSWORD }, ip: '192.0.2.99' })).status, 200);
  });
}

test('[worker] pengaturan kurang menghasilkan pesan jelas, bukan galat', async () => {
  const { createWorker } = await import('../worker.mjs');
  const w = createWorker({ makeStore: () => { throw new Error('tidak boleh dipanggil'); } });
  const res = await w.fetch(new Request('https://tolong.example/'), { ASSETS: fakeAssets() });
  assert.equal(res.status, 500);
  assert.match(await res.text(), /belum dikonfigurasi/);
});

test('[worker] database mati menghasilkan 503, bukan crash', async () => {
  const { createWorker } = await import('../worker.mjs');
  const store = { init: async () => { throw new Error('koneksi putus'); } };
  const w = createWorker({ makeStore: () => store });
  const res = await w.fetch(new Request('https://tolong.example/api/config'), Object.assign({ ASSETS: fakeAssets() }, ENV_BASE));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Database belum bisa dihubungi/);
});
