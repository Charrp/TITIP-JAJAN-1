'use strict';

/*
 * Server Node untuk Tolong Dong (Render, VPS, laptop).
 * Seluruh logika ada di lib/app.js. File ini hanya menjembatani Node ke Request/Response standar
 * dan menyajikan file statis dari folder public. Untuk Cloudflare, lihat worker.mjs.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHandler, buildCsv } = require('./lib/app');
const { memoryLimiter } = require('./lib/limiter');
const { loadConfig } = require('./lib/config');
const { initWithRetry } = require('./lib/store');
const { STATIC } = require('./lib/static');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 64 * 1024;

function createApp({ store, config, now, limiter }) {
  const app = createHandler({ store, config, now, limiter: limiter || memoryLimiter() });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0; let big = false;
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) big = true; else chunks.push(c); });
      req.on('end', () => (big ? reject(Object.assign(new Error('besar'), { status: 413 })) : resolve(Buffer.concat(chunks))));
      req.on('error', reject);
    });
  }

  async function send(res, response) {
    const headers = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    if (cookies.length) headers['set-cookie'] = cookies;
    const buf = Buffer.from(await response.arrayBuffer());
    headers['content-length'] = buf.length;
    res.writeHead(response.status, headers);
    res.end(buf);
  }

  return async function handler(req, res) {
    try {
      const method = req.method || 'GET';
      const hasBody = method !== 'GET' && method !== 'HEAD';
      let body;
      if (hasBody) {
        try { body = await readBody(req); } catch (e) {
          return send(res, app.decorate(Response.json({ error: 'Data terlalu besar.' }, { status: 413 }), false));
        }
      } else { req.resume(); }
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) { try { headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]); } catch (e) { /* abaikan header aneh */ } }
      const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method, headers, body: hasBody && body.length ? body : undefined });

      const api = await app.handle(request);
      if (api) return send(res, api);

      const p = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      if (Object.prototype.hasOwnProperty.call(STATIC, p)) {
        if (method !== 'GET' && method !== 'HEAD') return send(res, app.decorate(Response.json({ error: 'Metode tidak didukung.' }, { status: 405 }), false));
        const [file, type] = STATIC[p];
        const data = await fs.promises.readFile(path.join(PUBLIC_DIR, file));
        return send(res, app.decorate(new Response(data, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } }), /^text\/html/.test(type)));
      }
      return send(res, app.decorate(new Response('Halaman tidak ditemukan.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }), false));
    } catch (e) {
      console.error('Kesalahan server:', e && e.stack ? e.stack : e);
      if (res.headersSent) return res.end();
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Terjadi kesalahan di server. Coba lagi sebentar.' }));
    }
  };
}

async function main() {
  const { config, problems } = loadConfig(process.env);
  if (problems.length) {
    console.error('Server belum bisa menyala. Periksa pengaturan berikut:');
    problems.forEach((x) => console.error(' - ' + x));
    process.exit(1);
  }
  const { createPgStore } = require('./lib/pg-store');
  const store = createPgStore(config.databaseUrl);
  await initWithRetry(store);
  const server = http.createServer(createApp({ store, config }));
  server.requestTimeout = 30000;
  server.listen(config.port, '0.0.0.0', () => console.log(`Tolong Dong menyala di port ${config.port}`));
  const stop = () => { server.close(() => { store.close().finally(() => process.exit(0)); }); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

process.on('unhandledRejection', (e) => console.error('Kesalahan tak tertangani:', e));

if (require.main === module) {
  main().catch((e) => { console.error('Gagal menyalakan server:', e.message); process.exit(1); });
}

module.exports = { createApp, loadConfig, buildCsv };
