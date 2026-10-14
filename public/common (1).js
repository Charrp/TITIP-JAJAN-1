/* Fungsi bersama untuk halaman pelanggan dan halaman admin. */
(function () {
  'use strict';

  var DAERAH = {
    jaksel: { nama: 'Jakarta Selatan', kec: ['Cilandak', 'Jagakarsa', 'Kebayoran Baru', 'Kebayoran Lama', 'Mampang Prapatan', 'Pancoran', 'Pasar Minggu', 'Pesanggrahan', 'Setiabudi', 'Tebet'] },
    depok: { nama: 'Depok', kec: ['Beji', 'Bojongsari', 'Cilodong', 'Cimanggis', 'Cinere', 'Cipayung', 'Limo', 'Pancoran Mas', 'Sawangan', 'Sukmajaya', 'Tapos'] }
  };
  var JENIS = ['Antar barang', 'Titip beli', 'Antre atau urus', 'Bantu angkat', 'Lainnya'];
  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function $(s, r) { return (r || document).querySelector(s); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (kid) {
        if (kid == null || kid === false) return;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      });
    }
    return el;
  }

  /* Tanggal dan jam */
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function splitYmd(t) { var p = String(t).split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; }
  function parseSched(t, j) {
    if (!t) return null;
    var p = splitYmd(t), q = (j || '00:00').split(':').map(Number);
    var dt = new Date(p.y, p.m - 1, p.d, q[0] || 0, q[1] || 0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  function dayDiff(t) {
    var p = splitYmd(t), now = new Date();
    var a = new Date(p.y, p.m - 1, p.d), b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((a - b) / 86400000);
  }
  function fmtJam(j) { return j ? j.replace(':', '.') : ''; }
  function labelTanggal(t) {
    var diff = dayDiff(t);
    if (diff === 0) return 'Hari ini';
    if (diff === 1) return 'Besok';
    var p = splitYmd(t), dt = new Date(p.y, p.m - 1, p.d);
    return HARI[dt.getDay()].slice(0, 3) + ', ' + p.d + ' ' + BULAN[p.m - 1];
  }
  function fullTanggal(t) {
    var p = splitYmd(t), dt = new Date(p.y, p.m - 1, p.d);
    return HARI[dt.getDay()] + ', ' + p.d + ' ' + BULAN[p.m - 1] + ' ' + p.y;
  }
  function stampTime(ms) {
    var d = new Date(ms);
    return d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad(d.getHours()) + '.' + pad(d.getMinutes());
  }

  /* Nomor HP, daerah, rupiah */
  function normHp(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.indexOf('0') === 0) d = '62' + d.slice(1);
    else if (d.indexOf('8') === 0) d = '62' + d;
    return /^628\d{8,11}$/.test(d) ? d : null;
  }
  function fmtHp(n) {
    if (!n) return '';
    return ('0' + String(n).slice(2)).replace(/^(\d{4})(\d{4})(\d+)$/, '$1 $2 $3');
  }
  function daerahText(o) {
    var d = DAERAH[o.daerah];
    if (!d) return '';
    return d.nama + (o.kec ? ', ' + o.kec : '');
  }
  /* Tautan Google Maps: alamat atau patokan + kecamatan + daerah, supaya hasil pencarian tepat. */
  function mapsQuery(o) {
    return [o.alamat, o.kec, DAERAH[o.daerah] ? DAERAH[o.daerah].nama : ''].filter(Boolean).join(', ');
  }
  function mapsUrl(o) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapsQuery(o));
  }
  /* Peta yang tampil di dalam halaman (tanpa membuka aplikasi Maps). */
  function mapsEmbedUrl(o) {
    return 'https://maps.google.com/maps?q=' + encodeURIComponent(mapsQuery(o)) + '&hl=id&z=16&output=embed';
  }
  function rp(n) { return 'Rp ' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /* Toast */
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3400);
  }

  /* Salin */
  function copyText(text, okMsg, fallback) {
    var p;
    try { p = navigator.clipboard.writeText(text); } catch (e) { p = Promise.reject(e); }
    return p.then(function () { toast(okMsg || 'Tersalin.'); }, function () {
      if (fallback) fallback(text); else toast('Salin otomatis tidak didukung di sini. Tekan lama untuk menyalin teksnya.');
    });
  }

  /* Panggilan ke server. Mengembalikan { status, data }. Melempar Error kalau jaringan putus. */
  function api(method, url, body, timeoutMs) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 70000) : null;
    var opts = { method: method, credentials: 'same-origin', headers: { 'X-Requested-With': 'tolong-dong' }, signal: ctl ? ctl.signal : undefined };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, data: data }; });
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    }, function (e) {
      if (timer) clearTimeout(timer);
      var err = new Error(e && e.name === 'AbortError' ? 'timeout' : 'network');
      err.network = true;
      throw err;
    });
  }

  window.TD = {
    DAERAH: DAERAH, JENIS: JENIS, HARI: HARI, BULAN: BULAN, EMAIL: EMAIL,
    $: $, pad: pad, lsGet: lsGet, lsSet: lsSet, lsDel: lsDel, h: h,
    ymd: ymd, addDays: addDays, splitYmd: splitYmd, parseSched: parseSched, dayDiff: dayDiff,
    fmtJam: fmtJam, labelTanggal: labelTanggal, fullTanggal: fullTanggal, stampTime: stampTime,
    normHp: normHp, fmtHp: fmtHp, daerahText: daerahText, mapsUrl: mapsUrl, mapsEmbedUrl: mapsEmbedUrl, rp: rp,
    toast: toast, copyText: copyText, api: api
  };
})();
