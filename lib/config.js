'use strict';

const V = require('./validate');

/* Membaca pengaturan dari variabel lingkungan (Node) atau env Worker (Cloudflare). */
function loadConfig(env, extra) {
  const problems = [];
  const config = Object.assign({
    production: env.NODE_ENV === 'production',
    port: Number(env.PORT) || 3000,
    databaseUrl: String(env.DATABASE_URL || ''),
    adminPassword: String(env.ADMIN_PASSWORD || ''),
    sessionSecret: String(env.SESSION_SECRET || ''),
    adminWa: V.normHp(env.ADMIN_WA) || '',
    ipHeader: 'x-forwarded-for',
  }, extra || {});
  if (!config.databaseUrl) problems.push('DATABASE_URL belum diisi (alamat database dari Neon).');
  if (config.adminPassword.length < 8) problems.push('ADMIN_PASSWORD belum diisi atau kurang dari 8 karakter.');
  if (config.sessionSecret.length < 16) problems.push('SESSION_SECRET belum diisi atau kurang dari 16 karakter.');
  if (env.ADMIN_WA && !config.adminWa) problems.push('ADMIN_WA formatnya belum benar. Tulis seperti 081234567890.');
  return { config, problems };
}

module.exports = { loadConfig };
