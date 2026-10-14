/*
 * Pintu masuk Cloudflare Workers untuk Tolong Dong.
 * Logika API ada di lib/app.js (sama dengan server Node). File statis dari folder public
 * disajikan lewat binding ASSETS (lihat wrangler.jsonc). Database Neon dipanggil lewat HTTP.
 */

import { createHandler } from './lib/app.js';
import { dbLimiter } from './lib/limiter.js';
import { loadConfig } from './lib/config.js';
import { initWithRetry } from './lib/store.js';
import { createNeonStore } from './lib/neon-store.js';
import { STATIC } from './lib/static.js';

/* makeStore dan now bisa diganti dari luar, dipakai untuk tes. */
export function createWorker(opts) {
  const o = opts || {};
  let built = null;
  let ready = null;

  function build(env) {
    if (built) return built;
    const { config, problems } = loadConfig(env, { production: true, ipHeader: 'cf-connecting-ip' });
    if (problems.length) {
      console.error('Tolong Dong belum dikonfigurasi:\n - ' + problems.join('\n - '));
      return { problems };
    }
    const store = o.makeStore ? o.makeStore(config) : createNeonStore(config.databaseUrl);
    built = { store, app: createHandler({ store, config, limiter: dbLimiter(store), now: o.now }) };
    return built;
  }
  function ensureTables(store) {
    if (!ready) ready = initWithRetry(store, 3, 500).catch((e) => { ready = null; throw e; });
    return ready;
  }
  function plain(status, body) {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  return {
    async fetch(request, env) {
      const b = build(env);
      if (b.problems) return plain(500, 'Server belum dikonfigurasi. Buka log Worker di dashboard Cloudflare untuk melihat pengaturan yang kurang.');
      const url = new URL(request.url);
      const p = url.pathname.replace(/\/+$/, '') || '/';

      if (p === '/healthz' || p.startsWith('/api/')) {
        if (p !== '/healthz') {
          try { await ensureTables(b.store); } catch (e) {
            console.error('Database belum bisa dihubungi:', e && e.message);
            return b.app.decorate(new Response(JSON.stringify({ error: 'Database belum bisa dihubungi. Coba lagi sebentar.' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }), false);
          }
        }
        return b.app.handle(request);
      }

      if (Object.prototype.hasOwnProperty.call(STATIC, p)) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return b.app.decorate(new Response(JSON.stringify({ error: 'Metode tidak didukung.' }), { status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8' } }), false);
        }
        const [file, type] = STATIC[p];
        const asset = await env.ASSETS.fetch(new Request(new URL('/' + file, url), { method: 'GET' }));
        const h = new Headers(asset.headers);
        h.set('Content-Type', type);
        h.set('Cache-Control', 'no-cache');
        return b.app.decorate(new Response(asset.body, { status: asset.status, headers: h }), /^text\/html/.test(type));
      }
      return b.app.decorate(plain(404, 'Halaman tidak ditemukan.'), false);
    },
  };
}

export default createWorker();
