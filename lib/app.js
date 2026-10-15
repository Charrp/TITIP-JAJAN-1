'use strict';

/*
 * Inti aplikasi: menerima Request standar web, mengembalikan Response standar web.
 * Dipakai oleh server Node (server.js) dan Cloudflare Worker (worker.mjs).
 * Halaman statis (HTML, CSS, JS) disajikan oleh masing-masing adaptor.
 */

const V = require('./validate');

const SESSION_DAYS = 7;
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  'frame-src https://www.google.com https://maps.google.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Kriptografi (WebCrypto, tersedia di Node 20+ dan Cloudflare Workers) ---------- */
const enc = new TextEncoder();
function b64url(buf) {
  let s = '';
  new Uint8Array(buf).forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(secret, msg) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
async function sha256(s) { return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(s))); }
function eqBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function safeEqual(a, b) { return eqBytes(await sha256(a), await sha256(b)); }

/* ---------- CSV ---------- */
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function fmtJakarta(ms) {
  return new Date(Number(ms) + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
}
function buildCsv(items) {
  const head = ['Nota', 'Dibuat (WIB)', 'Nama', 'No. HP', 'Email', 'Jenis', 'Permintaan', 'Daerah', 'Kecamatan', 'Alamat', 'Tanggal', 'Jam', 'Status', 'Biaya (Rp)', 'Metode', 'Status bayar', 'Dibayar (WIB)'];
  const rows = items.map((i) => [
    i.kode, fmtJakarta(i.createdAt), i.nama, i.hp, i.email, i.jenis, i.pesan,
    V.DAERAH[i.daerah] ? V.DAERAH[i.daerah].nama : i.daerah, i.kec, i.alamat, i.tanggal, i.jam,
    i.status, i.biaya, i.metode, i.bayar, i.dibayarAt ? fmtJakarta(i.dibayarAt) : '',
  ]);
  return '﻿' + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/* ---------- Header keamanan ---------- */
function secureHeaders(headers, opts) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Frame-Options', 'DENY');
  if (opts.production) headers.set('Strict-Transport-Security', 'max-age=15552000');
  if (opts.html) headers.set('Content-Security-Policy', CSP);
  return headers;
}

/*
 * createHandler({ store, config, limiter, now })
 *  - store: lihat lib/store.js
 *  - config: lihat lib/config.js
 *  - limiter: lihat lib/limiter.js
 *  - now: fungsi jam (untuk tes)
 * Mengembalikan { handle(request) -> Response | null, decorate(response, html) -> Response }.
 * handle() mengembalikan null kalau jalurnya bukan milik API (adaptor lalu menyajikan file statis).
 */
function createHandler({ store, config, limiter, now }) {
  const clock = now || (() => Date.now());

  function decorate(res, html) {
    const h = new Headers(res.headers);
    secureHeaders(h, { production: config.production, html: !!html });
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
  function json(status, obj, setCookie) {
    const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (setCookie) h.append('Set-Cookie', setCookie);
    secureHeaders(h, { production: config.production, html: false });
    return new Response(JSON.stringify(obj), { status, headers: h });
  }
  function text(status, body, type, extra) {
    const h = new Headers(Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, extra || {}));
    secureHeaders(h, { production: config.production, html: false });
    return new Response(body, { status, headers: h });
  }

  function clientIp(request) {
    const raw = request.headers.get(config.ipHeader || 'x-forwarded-for') || '';
    return raw.split(',')[0].trim().slice(0, 64) || 'unknown';
  }

  async function readJson(request, max) {
    const ct = String(request.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('application/json')) throw new HttpError(415, 'Format data tidak didukung.');
    const body = await request.text();
    if (body.length > max) throw new HttpError(413, 'Data terlalu besar.');
    if (!body) return {};
    let v;
    try { v = JSON.parse(body); } catch (e) { throw new HttpError(400, 'Format data salah.'); }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Format data salah.');
    return v;
  }

  /* Sesi admin: cookie bertanda tangan, tanpa penyimpanan di server. */
  async function makeToken() {
    const exp = clock() + SESSION_DAYS * 864e5;
    return exp + '.' + await hmac(config.sessionSecret, 'admin.' + exp);
  }
  async function verifyToken(tok) {
    const i = tok.indexOf('.');
    if (i < 1) return false;
    const exp = Number(tok.slice(0, i));
    if (!(exp > clock())) return false;
    const expected = await hmac(config.sessionSecret, 'admin.' + exp);
    return eqBytes(enc.encode(tok.slice(i + 1)), enc.encode(expected));
  }
  function getCookie(request, name) {
    const raw = String(request.headers.get('cookie') || '');
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return '';
  }
  function cookieHeader(value, maxAge) {
    return `td_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}` + (config.production ? '; Secure' : '');
  }
  async function isAdmin(request) {
    const tok = getCookie(request, 'td_admin');
    return !!tok && verifyToken(tok);
  }

  async function api(request, p, method) {
    const t = clock();
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

    if (p === '/api/config') {
      if (method !== 'GET') throw new HttpError(405, 'Metode tidak didukung.');
      let payInfo = '';
      try { payInfo = await store.getSetting('pay_info'); } catch (e) { console.error('Gagal membaca info pembayaran:', e.message); }
      return json(200, { adminWa: config.adminWa, payInfo });
    }

    if (p === '/api/requests') {
      if (method !== 'POST') throw new HttpError(405, 'Metode tidak didukung.');
      const ip = clientIp(request);
      if (!(await limiter.allow('order:ip:' + ip, 8, 15 * 60e3, t)) || !(await limiter.allow('order:all', 300, 3600e3, t))) {
        throw new HttpError(429, 'Terlalu banyak pesanan dari perangkat ini. Coba lagi beberapa menit lagi.');
      }
      const body = await readJson(request, 8 * 1024);
      if (body.website) return json(200, { ok: true, kode: 'TD-0000-XXX', createdAt: t }); /* jebakan untuk bot */
      const { value, errors } = V.validateOrder(body, { allowPast: false, nowMs: t });
      if (errors) return json(400, { error: 'validasi', fields: errors });
      const created = await store.create(value, { nowMs: t, md: V.jakartaParts(t).md, source: 'web' });
      return json(201, { ok: true, kode: created.kode, createdAt: created.createdAt });
    }

    if (!p.startsWith('/api/admin/')) throw new HttpError(404, 'Tidak ditemukan.');

    /* Semua perubahan admin wajib membawa header khusus (perlindungan CSRF tambahan). */
    if (method !== 'GET' && method !== 'HEAD' && request.headers.get('x-requested-with') !== 'tolong-dong') {
      throw new HttpError(403, 'Permintaan ditolak.');
    }

    if (p === '/api/admin/login') {
      if (method !== 'POST') throw new HttpError(405, 'Metode tidak didukung.');
      const ip = clientIp(request);
      if ((await limiter.count('lf:' + ip, 10 * 60e3, t)) >= 5 || (await limiter.count('lf:all', 10 * 60e3, t)) >= 30) {
        throw new HttpError(429, 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.');
      }
      const body = await readJson(request, 2 * 1024);
      if (!(await safeEqual(String(body.password || ''), config.adminPassword))) {
        await limiter.add('lf:' + ip, 10 * 60e3, t);
        await limiter.add('lf:all', 10 * 60e3, t);
        throw new HttpError(401, 'Password salah.');
      }
      await limiter.clear('lf:' + ip);
      return json(200, { ok: true }, cookieHeader(await makeToken(), SESSION_DAYS * 86400));
    }

    if (p === '/api/admin/logout') {
      if (method !== 'POST') throw new HttpError(405, 'Metode tidak didukung.');
      return json(200, { ok: true }, cookieHeader('', 0));
    }

    if (!(await isAdmin(request))) throw new HttpError(401, 'Perlu login.');

    if (p === '/api/admin/me') {
      if (method !== 'GET') throw new HttpError(405, 'Metode tidak didukung.');
      return json(200, { ok: true });
    }

    if (p === '/api/admin/requests') {
      if (method === 'GET') return json(200, { items: await store.list() });
      if (method === 'POST') {
        const body = await readJson(request, 8 * 1024);
        const { value, errors } = V.validateOrder(body, { allowPast: true, nowMs: t });
        if (errors) return json(400, { error: 'validasi', fields: errors });
        const kode = V.cleanKode(body.kode);
        try {
          const created = await store.create(value, { nowMs: t, md: V.jakartaParts(t).md, source: 'manual', kode });
          return json(201, { ok: true, item: created });
        } catch (e) {
          if (e.code === 'DUPLICATE_KODE') return json(409, { error: `Nota ${kode} sudah ada di papan.` });
          throw e;
        }
      }
      throw new HttpError(405, 'Metode tidak didukung.');
    }

    const m = p.match(/^\/api\/admin\/requests\/([A-Za-z0-9-]{8,64})$/);
    if (m) {
      const id = m[1];
      if (method === 'DELETE') {
        const ok = await store.remove(id);
        if (!ok) throw new HttpError(404, 'Permintaan tidak ditemukan.');
        return json(200, { ok: true });
      }
      if (method === 'PATCH') {
        const body = await readJson(request, 2 * 1024);
        const patch = {}; const fields = {};
        if (has(body, 'status')) { if (V.STATUS.includes(body.status)) patch.status = body.status; else fields.status = 'Status tidak dikenal.'; }
        if (has(body, 'biaya')) {
          const n = Number(body.biaya);
          if (Number.isInteger(n) && n >= 0 && n <= 999999999) patch.biaya = n; else fields.biaya = 'Biaya harus angka bulat, dari 0 sampai 999.999.999.';
        }
        if (has(body, 'metode')) {
          const mt = String(body.metode == null ? '' : body.metode);
          if (mt === '' || V.METODE.includes(mt)) patch.metode = mt; else fields.metode = 'Metode tidak dikenal.';
        }
        if (has(body, 'bayar')) { if (V.BAYAR.includes(body.bayar)) patch.bayar = body.bayar; else fields.bayar = 'Status bayar tidak dikenal.'; }
        if (Object.keys(fields).length) return json(400, { error: 'validasi', fields });
        if (!Object.keys(patch).length) return json(400, { error: 'Tidak ada yang diubah.' });
        const current = await store.get(id);
        if (!current) throw new HttpError(404, 'Permintaan tidak ditemukan.');
        const biaya = patch.biaya != null ? patch.biaya : current.biaya;
        if (patch.bayar === 'lunas') {
          if (!(biaya > 0)) throw new HttpError(400, 'Isi biaya dulu sebelum menandai lunas.');
          if (current.bayar !== 'lunas') patch.dibayar_at = t;
        } else if (patch.bayar === 'belum') {
          patch.dibayar_at = null;
        } else if (current.bayar === 'lunas' && !(biaya > 0)) {
          throw new HttpError(400, 'Batalkan status lunas dulu sebelum mengosongkan biaya.');
        }
        const updated = await store.update(id, patch);
        return json(200, { ok: true, item: updated });
      }
      throw new HttpError(405, 'Metode tidak didukung.');
    }

    if (p === '/api/admin/settings') {
      if (method === 'GET') return json(200, { payInfo: await store.getSetting('pay_info') });
      if (method === 'PUT') {
        const body = await readJson(request, 4 * 1024);
        await store.setSetting('pay_info', V.cleanText(body.payInfo, 300));
        return json(200, { ok: true });
      }
      throw new HttpError(405, 'Metode tidak didukung.');
    }

    if (p === '/api/admin/export.csv') {
      if (method !== 'GET') throw new HttpError(405, 'Metode tidak didukung.');
      const csv = buildCsv(await store.list(2000));
      const name = `pesanan-tolong-dong-${V.jakartaParts(t).ymd}.csv`;
      return text(200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${name}"` });
    }

    throw new HttpError(404, 'Tidak ditemukan.');
  }

  async function handle(request) {
    try {
      const url = new URL(request.url);
      const p = url.pathname.replace(/\/+$/, '') || '/';
      if (p === '/healthz') return text(200, 'ok', 'text/plain; charset=utf-8');
      if (p.startsWith('/api/')) return await api(request, p, request.method);
      return null;
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error('Kesalahan server:', e && e.stack ? e.stack : e);
      return json(500, { error: 'Terjadi kesalahan di server. Coba lagi sebentar.' });
    }
  }

  return { handle, decorate, text };
}

module.exports = { createHandler, buildCsv, CSP };
