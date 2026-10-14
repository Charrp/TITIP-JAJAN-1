'use strict';

/*
 * Pembatas laju dengan API async yang sama untuk dua tempat:
 * - memoryLimiter: untuk server Node yang jalan terus (Render, VPS, laptop)
 * - dbLimiter: untuk Cloudflare Workers, di mana memori tidak dibagi antar instance, jadi hitungan disimpan di database
 */

function memoryLimiter() {
  const m = new Map();
  function prune(key, windowMs, t) {
    const arr = (m.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length) m.set(key, arr); else m.delete(key);
    return arr;
  }
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, arr] of m) {
      const f = arr.filter((x) => t - x < 3600 * 1000);
      if (f.length) m.set(k, f); else m.delete(k);
    }
  }, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
  return {
    async count(key, windowMs, t) { return prune(key, windowMs, t).length; },
    async add(key, windowMs, t) { const arr = prune(key, windowMs, t); arr.push(t); m.set(key, arr); },
    async allow(key, limit, windowMs, t) {
      const arr = prune(key, windowMs, t);
      if (arr.length >= limit) return false;
      arr.push(t); m.set(key, arr);
      return true;
    },
    async clear(key) { m.delete(key); },
  };
}

function dbLimiter(store) {
  /* Bersihkan catatan lama sesekali supaya tabel tidak membesar. */
  async function maybeSweep(t) {
    if (Math.random() < 0.05) await store.rlSweep(t - 3600 * 1000);
  }
  return {
    async count(key, windowMs, t) { return store.rlCount(key, windowMs, t); },
    async add(key, windowMs, t) { await store.rlAdd(key, t); await maybeSweep(t); },
    async allow(key, limit, windowMs, t) {
      const ok = await store.rlTake(key, limit, windowMs, t);
      if (ok) await maybeSweep(t);
      return ok;
    },
    async clear(key) { await store.rlClear(key); },
  };
}

module.exports = { memoryLimiter, dbLimiter };
