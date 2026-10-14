'use strict';

/* Daftar pilihan dan aturan isian. Server selalu memeriksa ulang apa pun yang dikirim browser. */

const DAERAH = {
  jaksel: {
    nama: 'Jakarta Selatan',
    kec: ['Cilandak', 'Jagakarsa', 'Kebayoran Baru', 'Kebayoran Lama', 'Mampang Prapatan', 'Pancoran', 'Pasar Minggu', 'Pesanggrahan', 'Setiabudi', 'Tebet'],
  },
  depok: {
    nama: 'Depok',
    kec: ['Beji', 'Bojongsari', 'Cilodong', 'Cimanggis', 'Cinere', 'Cipayung', 'Limo', 'Pancoran Mas', 'Sawangan', 'Sukmajaya', 'Tapos'],
  },
};
const JENIS = ['Antar barang', 'Titip beli', 'Antre atau urus', 'Bantu angkat', 'Lainnya'];
const STATUS = ['baru', 'proses', 'selesai'];
const METODE = ['tunai', 'transfer', 'qris', 'ewallet'];
const BAYAR = ['belum', 'lunas'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const JKT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/* Tanggal dan jam di Jakarta (WIB), apa pun zona waktu server. */
function jakartaParts(ms) {
  const o = {};
  for (const p of JKT.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { ymd: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour}:${o.minute}`, md: `${o.month}${o.day}` };
}

function normHp(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^628\d{8,11}$/.test(d) ? d : null;
}

function cleanLine(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function isRealDate(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const [y, m, d] = t.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function cleanKode(v) {
  const k = String(v == null ? '' : v).trim().toUpperCase();
  return /^TD-\d{4}-[A-Z0-9]{3,6}$/.test(k) ? k : '';
}

/*
 * Memeriksa satu pesanan. allowPast=true dipakai saat pemilik mencatat pesanan manual.
 * Mengembalikan { value, errors }. errors null kalau semua benar.
 */
function validateOrder(input, opts) {
  const o = opts || {};
  const nowJ = jakartaParts(o.nowMs == null ? Date.now() : o.nowMs);
  const src = input && typeof input === 'object' ? input : {};
  const errors = {};
  const v = {};

  v.nama = cleanLine(src.nama, 60);
  if (v.nama.length < 2) errors.nama = 'Tulis nama kamu, minimal 2 huruf.';

  v.hp = normHp(src.hp);
  if (!v.hp) errors.hp = 'Nomor HP belum benar. Tulis seperti 0812 3456 7890.';

  v.email = cleanLine(src.email, 80);
  if (v.email && !EMAIL.test(v.email)) errors.email = 'Format email belum benar. Contoh: nama@email.com.';

  const jenis = cleanLine(src.jenis, 30);
  v.jenis = JENIS.includes(jenis) ? jenis : '';

  v.pesan = cleanText(src.pesan, 600);
  if (v.pesan.length < 8) errors.pesan = 'Ceritakan sedikit lebih jelas apa yang perlu dibantu.';

  const daerah = String(src.daerah == null ? '' : src.daerah);
  if (!Object.prototype.hasOwnProperty.call(DAERAH, daerah)) {
    errors.daerah = 'Pilih Jakarta Selatan atau Depok.';
    v.daerah = '';
  } else {
    v.daerah = daerah;
  }
  const kec = cleanLine(src.kec, 40);
  v.kec = v.daerah && DAERAH[v.daerah].kec.includes(kec) ? kec : '';
  v.alamat = cleanLine(src.alamat, 120);

  const tanggal = String(src.tanggal == null ? '' : src.tanggal);
  v.tanggal = tanggal;
  if (!isRealDate(tanggal)) errors.tanggal = 'Pilih tanggal.';
  else if (!o.allowPast && tanggal < nowJ.ymd) errors.tanggal = 'Tanggal itu sudah lewat. Pilih hari ini atau sesudahnya.';

  const jam = String(src.jam == null ? '' : src.jam);
  v.jam = jam;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(jam)) errors.jam = 'Pilih jam.';
  else if (!o.allowPast && !errors.tanggal && tanggal === nowJ.ymd && jam <= nowJ.hm) errors.jam = 'Jam itu sudah lewat. Pilih jam setelah sekarang.';

  return { value: v, errors: Object.keys(errors).length ? errors : null };
}

module.exports = {
  DAERAH, JENIS, STATUS, METODE, BAYAR,
  jakartaParts, normHp, cleanLine, cleanText, cleanKode, validateOrder,
};
