'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/validate');
const { BACKENDS, startServer, BASE_CONFIG } = require('./helpers');

function order(extra) {
  const tomorrow = V.jakartaParts(Date.now() + 36 * 3600e3).ymd;
  return Object.assign({
    nama: 'Budi Santoso', hp: '0812 3456 7890', email: 'budi@mail.com', jenis: 'Titip beli',
    pesan: 'Tolong titip beli obat flu di apotek dekat Stasiun Tebet.', daerah: 'jaksel', kec: 'Tebet',
    alamat: 'Dekat stasiun', tanggal: tomorrow, jam: '10:00',
  }, extra || {});
}
let ipn = 10;
const ip = () => ({ 'X-Forwarded-For': `10.0.0.${ipn++}` });

for (const kind of BACKENDS) {
  test(`[${kind}] halaman, config, dan header keamanan`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    assert.equal((await s.req('GET', '/healthz')).status, 200);
    for (const p of ['/', '/admin', '/style.css', '/app.js', '/admin.js', '/common.js', '/favicon.svg']) {
      const r = await s.req('GET', p);
      assert.equal(r.status, 200, p);
    }
    const home = await s.req('GET', '/');
    assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    const cfg = await s.req('GET', '/api/config');
    assert.deepEqual(cfg.data, { adminWa: '6281234567890', payInfo: '' });
    for (const p of ['/etc/passwd', '/server.js', '/..%2Fserver.js', '/lib/store.js', '/public/app.js']) {
      assert.equal((await s.req('GET', p)).status, 404, p);
    }
  });

  test(`[${kind}] pesanan pelanggan valid masuk ke papan admin`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    const r = await s.req('POST', '/api/requests', { json: order(), headers: ip() });
    assert.equal(r.status, 201);
    assert.match(r.data.kode, /^TD-\d{4}-[A-Z2-9]{3,4}$/);
    assert.equal((await s.req('GET', '/api/admin/requests', { admin: false })).status, 401);
    assert.equal((await s.login()).status, 200);
    const list = await s.req('GET', '/api/admin/requests');
    assert.equal(list.data.items.length, 1);
    const it = list.data.items[0];
    assert.equal(it.nama, 'Budi Santoso');
    assert.equal(it.hp, '6281234567890');
    assert.equal(it.status, 'baru');
    assert.equal(it.bayar, 'belum');
    assert.equal(it.biaya, 0);
    assert.equal(it.source, 'web');
    assert.equal(it.kode, r.data.kode);
  });

  test(`[${kind}] validasi pesanan menolak data salah dengan pesan bahasa Indonesia`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    const bad = await s.req('POST', '/api/requests', { json: { nama: 'A', hp: '123', email: 'x', pesan: 'pendek', daerah: 'bogor', tanggal: '2020-01-01', jam: '99:99' }, headers: ip() });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.data.fields).sort(), ['daerah', 'email', 'hp', 'jam', 'nama', 'pesan', 'tanggal']);
    assert.match(bad.data.fields.hp, /Nomor HP belum benar/);
    const past = await s.req('POST', '/api/requests', { json: order({ tanggal: '2020-01-01' }), headers: ip() });
    assert.equal(past.status, 400);
    assert.match(past.data.fields.tanggal, /sudah lewat/);
    const today = V.jakartaParts(Date.now());
    const earlier = await s.req('POST', '/api/requests', { json: order({ tanggal: today.ymd, jam: '00:00' }), headers: ip() });
    if (today.hm > '00:00') { assert.equal(earlier.status, 400); assert.match(earlier.data.fields.jam, /sudah lewat/); }
    const evil = await s.req('POST', '/api/requests', { json: order({ nama: 'Eve\u0000<script>', kec: 'Bukan Kecamatan', jenis: 'Hack' }), headers: ip() });
    assert.equal(evil.status, 201);
    await s.login();
    const it = (await s.req('GET', '/api/admin/requests')).data.items[0];
    assert.equal(it.kec, '');
    assert.equal(it.jenis, '');
    assert.ok(!it.nama.includes('\u0000'));
    assert.equal((await s.req('GET', '/api/admin/requests')).data.items.length, 1);
  });

  test(`[${kind}] bentuk permintaan: tipe konten, ukuran, JSON rusak, honeypot`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    const a = await s.req('POST', '/api/requests', { raw: 'nama=a', headers: Object.assign({ 'Content-Type': 'text/plain' }, ip()) });
    assert.equal(a.status, 415);
    const b = await s.req('POST', '/api/requests', { raw: '{rusak', headers: Object.assign({ 'Content-Type': 'application/json' }, ip()) });
    assert.equal(b.status, 400);
    const c = await s.req('POST', '/api/requests', { json: order({ pesan: 'x'.repeat(20000) }), headers: ip() });
    assert.equal(c.status, 413);
    const d = await s.req('POST', '/api/requests', { raw: '[1,2]', headers: Object.assign({ 'Content-Type': 'application/json' }, ip()) });
    assert.equal(d.status, 400);
    const e = await s.req('POST', '/api/requests', { json: order({ website: 'http://spam.example' }), headers: ip() });
    assert.equal(e.status, 200);
    await s.login();
    assert.equal((await s.req('GET', '/api/admin/requests')).data.items.length, 0);
    assert.equal((await s.req('GET', '/api/requests', { admin: false })).status, 405);
  });

  test(`[${kind}] login, cookie, CSRF, dan kedaluwarsa sesi`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    assert.equal((await s.login('salah-banget')).status, 401);
    const ok = await s.login();
    assert.equal(ok.status, 200);
    const sc = ok.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Strict/);
    assert.equal((await s.req('GET', '/api/admin/me')).status, 200);
    /* tanpa header X-Requested-With, perubahan ditolak */
    assert.equal((await s.req('POST', '/api/admin/requests', { json: order(), xrw: false })).status, 403);
    /* cookie dipalsukan */
    const good = s.getCookie();
    s.setCookie(good.slice(0, -3) + 'AAA');
    assert.equal((await s.req('GET', '/api/admin/me')).status, 401);
    s.setCookie('td_admin=' + (Date.now() + 1e9) + '.abc');
    assert.equal((await s.req('GET', '/api/admin/me')).status, 401);
    s.setCookie('td_admin=garbage');
    assert.equal((await s.req('GET', '/api/admin/me')).status, 401);
    /* kedaluwarsa setelah 7 hari */
    s.setCookie(good);
    assert.equal((await s.req('GET', '/api/admin/me')).status, 200);
    s.clock.t += 8 * 864e5;
    assert.equal((await s.req('GET', '/api/admin/me')).status, 401);
    /* keluar */
    s.clock.t -= 8 * 864e5;
    const out = await s.req('POST', '/api/admin/logout', { json: {} });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  });

  test(`[${kind}] login dikunci setelah 5 kali salah`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    for (let i = 0; i < 5; i++) assert.equal((await s.login('salah-' + i)).status, 401);
    const r = await s.login();
    assert.equal(r.status, 429);
    s.clock.t += 11 * 60e3;
    assert.equal((await s.login()).status, 200);
  });

  test(`[${kind}] pembatas pesanan per perangkat`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    const h = { 'X-Forwarded-For': '203.0.113.9' };
    for (let i = 0; i < 8; i++) assert.equal((await s.req('POST', '/api/requests', { json: order(), headers: h })).status, 201);
    assert.equal((await s.req('POST', '/api/requests', { json: order(), headers: h })).status, 429);
    assert.equal((await s.req('POST', '/api/requests', { json: order(), headers: { 'X-Forwarded-For': '203.0.113.10' } })).status, 201);
    s.clock.t += 16 * 60e3;
    assert.equal((await s.req('POST', '/api/requests', { json: order(), headers: h })).status, 201);
  });

  test(`[${kind}] status, pembayaran, dan hapus`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    await s.req('POST', '/api/requests', { json: order(), headers: ip() });
    await s.login();
    const id = (await s.req('GET', '/api/admin/requests')).data.items[0].id;
    const P = (body) => s.req('PATCH', '/api/admin/requests/' + id, { json: body });

    assert.equal((await P({ status: 'proses' })).data.item.status, 'proses');
    assert.equal((await P({ status: 'ngawur' })).status, 400);
    assert.equal((await P({})).status, 400);
    assert.equal((await P({ biaya: -5 })).status, 400);
    assert.equal((await P({ biaya: 1.5 })).status, 400);
    assert.equal((await P({ biaya: 1000000000 })).status, 400);
    assert.equal((await P({ metode: 'bitcoin' })).status, 400);

    const noFee = await P({ bayar: 'lunas' });
    assert.equal(noFee.status, 400);
    assert.match(noFee.data.error, /biaya/i);

    const saved = await P({ biaya: 25000, metode: 'qris' });
    assert.equal(saved.data.item.biaya, 25000);
    assert.equal(saved.data.item.metode, 'qris');
    assert.equal(saved.data.item.dibayarAt, null);

    const paid = await P({ bayar: 'lunas' });
    assert.equal(paid.data.item.bayar, 'lunas');
    assert.ok(paid.data.item.dibayarAt > 0);
    const firstPaidAt = paid.data.item.dibayarAt;
    s.clock.t += 5000;
    assert.equal((await P({ bayar: 'lunas' })).data.item.dibayarAt, firstPaidAt);
    assert.equal((await P({ biaya: 0 })).status, 400);

    const undone = await P({ bayar: 'belum' });
    assert.equal(undone.data.item.bayar, 'belum');
    assert.equal(undone.data.item.dibayarAt, null);

    assert.equal((await s.req('PATCH', '/api/admin/requests/tidak-ada-id-ini', { json: { status: 'baru' } })).status, 404);
    assert.equal((await s.req('DELETE', '/api/admin/requests/tidak-ada-id-ini')).status, 404);
    assert.equal((await s.req('DELETE', '/api/admin/requests/' + id)).status, 200);
    assert.equal((await s.req('GET', '/api/admin/requests')).data.items.length, 0);
    assert.equal((await s.req('DELETE', '/api/admin/requests/' + id)).status, 404);
  });

  test(`[${kind}] pesanan manual: tanggal lampau boleh, nota ganda ditolak`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    await s.login();
    const a = await s.req('POST', '/api/admin/requests', { json: order({ tanggal: '2024-03-05', kode: 'td-0305-abc' }) });
    assert.equal(a.status, 201);
    assert.equal(a.data.item.kode, 'TD-0305-ABC');
    assert.equal(a.data.item.source, 'manual');
    const dup = await s.req('POST', '/api/admin/requests', { json: order({ kode: 'TD-0305-ABC' }) });
    assert.equal(dup.status, 409);
    const noKode = await s.req('POST', '/api/admin/requests', { json: order() });
    assert.equal(noKode.status, 201);
    assert.match(noKode.data.item.kode, /^TD-\d{4}-[A-Z2-9]{3,4}$/);
    const bad = await s.req('POST', '/api/admin/requests', { json: { nama: 'x' } });
    assert.equal(bad.status, 400);
  });

  test(`[${kind}] info pembayaran tampil ke pelanggan`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    await s.login();
    assert.equal((await s.req('GET', '/api/admin/settings')).data.payInfo, '');
    assert.equal((await s.req('PUT', '/api/admin/settings', { json: { payInfo: 'Transfer BCA 123\nA/n Gabriel' } })).status, 200);
    assert.equal((await s.req('GET', '/api/config', { admin: false })).data.payInfo, 'Transfer BCA 123\nA/n Gabriel');
    await s.req('PUT', '/api/admin/settings', { json: { payInfo: 'z'.repeat(1000) } });
    assert.equal((await s.req('GET', '/api/admin/settings')).data.payInfo.length, 300);
    await s.req('PUT', '/api/admin/settings', { json: { payInfo: 'ganti' } });
    assert.equal((await s.req('GET', '/api/admin/settings')).data.payInfo, 'ganti');
    assert.equal((await s.req('PUT', '/api/admin/settings', { json: { payInfo: 'x' }, admin: false, headers: { Cookie: '' } })).status, 401);
  });

  test(`[${kind}] ekspor CSV aman dan lengkap`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    await s.login();
    await s.req('POST', '/api/admin/requests', { json: order({ nama: '=HYPERLINK("x")', pesan: 'Halo, "dunia"\nbaris dua ya', kode: 'TD-0101-AAA' }) });
    const r = await s.req('GET', '/api/admin/export.csv');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="pesanan-tolong-dong-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.ok(r.text.startsWith('﻿Nota,'));
    assert.ok(r.text.includes('"\'=HYPERLINK(""x"")"'), 'rumus dinetralkan');
    assert.ok(r.text.includes('"Halo, ""dunia""\nbaris dua ya"'));
    assert.ok(r.text.includes('Jakarta Selatan'));
    assert.equal((await s.req('GET', '/api/admin/export.csv', { admin: false, headers: { Cookie: '' } })).status, 401);
  });

  test(`[${kind}] rute tidak dikenal dan metode salah`, async (t) => {
    const s = await startServer(kind);
    t.after(s.close);
    assert.equal((await s.req('GET', '/api/nope')).status, 404);
    assert.equal((await s.req('POST', '/', { json: {} })).status, 405);
    assert.equal((await s.req('GET', '/api/admin/login', { admin: false })).status, 405);
    await s.login();
    assert.equal((await s.req('GET', '/api/admin/lain')).status, 404);
  });
}

test('validasi: nomor HP dan zona waktu Jakarta', () => {
  assert.equal(V.normHp('0812-3456-7890'), '6281234567890');
  assert.equal(V.normHp('+62 812 3456 7890'), '6281234567890');
  assert.equal(V.normHp('81234567890'), '6281234567890');
  assert.equal(V.normHp('0212345'), null);
  assert.equal(V.normHp(''), null);
  /* 17:30 UTC tanggal 31 = 00:30 WIB tanggal 1 bulan berikutnya */
  const p = V.jakartaParts(Date.UTC(2026, 0, 31, 17, 30));
  assert.deepEqual(p, { ymd: '2026-02-01', hm: '00:30', md: '0201' });
});

test('konfigurasi: pesan galat jelas bila pengaturan kurang', () => {
  const { loadConfig } = require('../server');
  const a = loadConfig({});
  assert.equal(a.problems.length, 3);
  const b = loadConfig({ DATABASE_URL: 'postgres://x', ADMIN_PASSWORD: 'panjang-banget', SESSION_SECRET: 'x'.repeat(20), ADMIN_WA: '0812 3456 7890' });
  assert.deepEqual(b.problems, []);
  assert.equal(b.config.adminWa, '6281234567890');
  const c = loadConfig({ DATABASE_URL: 'postgres://x', ADMIN_PASSWORD: 'panjang-banget', SESSION_SECRET: 'x'.repeat(20), ADMIN_WA: 'abc' });
  assert.equal(c.problems.length, 1);
  assert.ok(BASE_CONFIG);
});
