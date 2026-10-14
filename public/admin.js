/* Halaman admin: login, papan permintaan, dan pembayaran. */
(function () {
  'use strict';
  var T = window.TD, $ = T.$, h = T.h;

  var DAERAH = T.DAERAH;
  var STATUS = { baru: 'Baru', proses: 'Diproses', selesai: 'Selesai' };
  var NEXT = { baru: ['proses', 'Mulai proses'], proses: ['selesai', 'Tandai selesai'], selesai: ['baru', 'Buka lagi'] };
  var METODE = [['', 'Pilih metode'], ['tunai', 'Tunai'], ['transfer', 'Transfer'], ['qris', 'QRIS'], ['ewallet', 'E-wallet']];
  var POLL_MS = 12000;
  var BASE_TITLE = 'Tolong Dong Admin';

  var state = {
    authed: false, tab: 'papan', items: null, sig: '', seen: null, fresh: {}, unread: 0,
    fs: 'semua', fd: 'semua', fb: 'semua', payinfo: '', confirm: null,
    busy: new Set(), draft: {}, pasteSaving: false, pollTimer: null, polling: false, lastSaved: ''
  };

  /* ---------- Panggilan ke server ---------- */
  function onUnauthorized() {
    if (!state.authed) return;
    state.authed = false;
    stopPolling();
    showLogin();
    T.toast('Sesi habis. Masuk lagi ya.');
  }
  function call(method, url, body) {
    return T.api(method, url, body, 30000).then(function (r) {
      if (r.status === 401 && url !== '/api/admin/login') onUnauthorized();
      return r;
    });
  }
  function failMsg(r, e) {
    if (e) return 'Tidak ada koneksi ke server. Coba lagi sebentar.';
    if (r && r.data && r.data.error && typeof r.data.error === 'string' && r.data.error !== 'validasi') return r.data.error;
    if (r && r.data && r.data.fields) return Object.keys(r.data.fields).map(function (k) { return r.data.fields[k]; })[0];
    return 'Gagal menyimpan. Coba lagi.';
  }

  /* ---------- Tampilan ---------- */
  function showLogin() {
    $('#view-login').hidden = false;
    $('#view-papan').hidden = true;
    $('#view-bayar').hidden = true;
    $('#tools').hidden = true;
    document.title = BASE_TITLE;
    setTimeout(function () { var p = $('#f-pass'); if (p) p.focus(); }, 0);
  }
  function showApp() {
    $('#view-login').hidden = true;
    $('#tools').hidden = false;
    setTab(state.tab);
  }
  function setTab(t) {
    state.tab = t;
    T.lsSet('admin-tab', t);
    $('#view-papan').hidden = t !== 'papan';
    $('#view-bayar').hidden = t !== 'bayar';
    $('#tab-papan').setAttribute('aria-pressed', String(t === 'papan'));
    $('#tab-bayar').setAttribute('aria-pressed', String(t === 'bayar'));
  }
  $('#tab-papan').addEventListener('click', function () { setTab('papan'); clearUnread(); });
  $('#tab-bayar').addEventListener('click', function () { setTab('bayar'); });

  /* ---------- Login ---------- */
  $('#login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pw = $('#f-pass').value;
    var err = $('#e-pass'), btn = $('#btn-login');
    err.hidden = true;
    if (!pw) { err.textContent = 'Isi password dulu.'; err.hidden = false; return; }
    btn.disabled = true;
    call('POST', '/api/admin/login', { password: pw }).then(function (r) {
      if (r.status === 200) {
        $('#f-pass').value = '';
        enter();
        return;
      }
      err.textContent = r.status === 401 ? 'Password salah.' : failMsg(r);
      err.hidden = false;
    }, function (e) {
      err.textContent = failMsg(null, e);
      err.hidden = false;
    }).then(function () { btn.disabled = false; });
  });
  $('#btn-logout').addEventListener('click', function () {
    call('POST', '/api/admin/logout', {}).then(function () {}, function () {}).then(function () {
      state.authed = false; state.items = null; state.sig = ''; state.seen = null;
      stopPolling(); showLogin();
    });
  });

  function enter() {
    state.authed = true;
    state.items = null; state.seen = null; state.sig = ''; state.unread = 0;
    var saved = T.lsGet('admin-tab');
    state.tab = saved === 'bayar' ? 'bayar' : 'papan';
    showApp();
    renderBoard(); renderPay();
    loadSettings();
    poll();
    startPolling();
  }

  /* ---------- Muat data dan polling ---------- */
  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(poll, POLL_MS);
  }
  function stopPolling() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.authed) { poll(); clearUnreadIfVisible(); } });

  function poll() {
    if (!state.authed || state.polling) return;
    state.polling = true;
    call('GET', '/api/admin/requests').then(function (r) {
      if (r.status !== 200 || !r.data || !Array.isArray(r.data.items)) {
        if (state.items === null && state.authed) { state.items = []; renderBoard(); renderPay(); toast('Papan belum bisa dimuat. Coba muat ulang halaman.'); }
        return;
      }
      applyItems(r.data.items);
    }, function () {
      if (state.items === null) { state.items = []; renderBoard(); renderPay(); }
    }).then(function () { state.polling = false; });
  }
  function toast(m) { T.toast(m); }

  function applyItems(items) {
    var sig = JSON.stringify(items);
    var first = state.seen === null;
    var ids = new Set(items.map(function (i) { return i.id; }));
    if (!first) {
      var added = items.filter(function (i) { return !state.seen.has(i.id); });
      if (added.length) {
        added.forEach(function (i) { state.fresh[i.id] = true; });
        state.unread += added.length;
        toast(added.length === 1 ? 'Pesanan baru dari ' + added[0].nama + '.' : added.length + ' pesanan baru masuk.');
        updateTitle();
        if (!document.hidden && state.tab === 'papan') setTimeout(clearUnread, 8000);
      }
    }
    state.seen = ids;
    if (sig === state.sig && state.items !== null) return;
    state.sig = sig;
    state.items = items;
    renderAll();
  }
  function updateTitle() {
    document.title = state.unread > 0 ? '(' + state.unread + ') ' + BASE_TITLE : BASE_TITLE;
  }
  function clearUnread() { state.unread = 0; state.fresh = {}; updateTitle(); renderBoard(); }
  function clearUnreadIfVisible() { if (state.tab === 'papan' && state.unread) clearUnread(); }

  function loadSettings() {
    call('GET', '/api/admin/settings').then(function (r) {
      if (r.status === 200 && r.data) {
        state.payinfo = String(r.data.payInfo || '');
        var ta = $('#f-info');
        if (document.activeElement !== ta) ta.value = state.payinfo;
        renderPay();
      }
    }, function () {});
  }

  /* Render ulang dengan menjaga isian yang sedang diketik dan posisi fokus. */
  function renderAll() {
    var a = document.activeElement;
    var keep = null;
    if (a && a.id && (a.id.indexOf('bi-') === 0 || a.id.indexOf('bm-') === 0)) {
      keep = { id: a.id, s: a.selectionStart, e: a.selectionEnd };
    }
    renderBoard(); renderPay(); renderPaste();
    if (keep) {
      var el = document.getElementById(keep.id);
      if (el) { el.focus(); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) { /* select tidak punya seleksi */ } }
    }
  }

  /* ---------- Papan ---------- */
  function nStatus(i) { return STATUS[i.status] ? i.status : 'baru'; }
  function schedKey(it) { var s = T.parseSched(it.tanggal, it.jam); return s ? s.getTime() : (it.createdAt || 0); }
  function metaRow(label, content) { return h('div', null, h('dt', null, label), h('dd', null, content)); }

  function waReply(it) {
    var first = String(it.nama || '').split(/\s+/)[0];
    var L = ['Halo kak ' + first + ', permintaan tolongnya sudah kami terima.', ''];
    if (it.kode) L.push('Nota: ' + it.kode);
    L.push('Nama: ' + it.nama);
    L.push('No. HP: ' + T.fmtHp(it.hp));
    if (it.email) L.push('Email: ' + it.email);
    L.push('Bantuan: ' + (it.jenis ? it.jenis + '. ' : '') + it.pesan);
    L.push('Daerah: ' + T.daerahText(it));
    if (it.alamat) L.push('Alamat: ' + it.alamat);
    if (it.tanggal) L.push('Waktu: ' + T.fullTanggal(it.tanggal) + (it.jam ? ', ' + T.fmtJam(it.jam) + ' WIB' : ''));
    L.push('', 'Boleh dikonfirmasi apakah datanya sudah benar?');
    return 'https://wa.me/' + it.hp + '?text=' + encodeURIComponent(L.join('\n'));
  }

  function patchItem(it, patch, okMsg) {
    if (state.busy.has(it.id)) return Promise.resolve(false);
    state.busy.add(it.id);
    renderAll();
    return call('PATCH', '/api/admin/requests/' + encodeURIComponent(it.id), patch).then(function (r) {
      if (r.status === 200 && r.data && r.data.item) {
        state.items = (state.items || []).map(function (x) { return x.id === it.id ? r.data.item : x; });
        state.sig = JSON.stringify(state.items);
        if (okMsg) toast(okMsg);
        return true;
      }
      toast(failMsg(r));
      return false;
    }, function (e) { toast(failMsg(null, e)); return false; }).then(function (ok) {
      state.busy.delete(it.id);
      renderAll();
      return ok;
    });
  }
  function hapus(it) {
    if (state.busy.has(it.id)) return;
    state.busy.add(it.id); state.confirm = null; renderAll();
    call('DELETE', '/api/admin/requests/' + encodeURIComponent(it.id)).then(function (r) {
      if (r.status === 200) {
        state.items = (state.items || []).filter(function (x) { return x.id !== it.id; });
        state.sig = JSON.stringify(state.items);
        if (state.seen) state.seen.delete(it.id);
        toast('Permintaan dihapus.');
      } else toast(failMsg(r));
    }, function (e) { toast(failMsg(null, e)); }).then(function () { state.busy.delete(it.id); renderAll(); });
  }

  function card(it) {
    var st = nStatus(it);
    var sched = T.parseSched(it.tanggal, it.jam);
    var late = st !== 'selesai' && sched && sched < new Date();
    var busy = state.busy.has(it.id);
    var phone = [h('span', null, T.fmtHp(it.hp) || '-')];
    if (it.hp) phone.push(h('button', { type: 'button', class: 'copy', onclick: function () { T.copyText(T.fmtHp(it.hp), 'Nomor tersalin.'); } }, 'Salin'));
    var acts = h('div', { class: 'req-act' });
    if (it.hp) acts.append(h('a', { class: 'btn small', href: waReply(it), target: '_blank', rel: 'noopener' }, 'WhatsApp'));
    acts.append(h('button', { type: 'button', class: 'btn small ghost', disabled: busy, onclick: function () { patchItem(it, { status: NEXT[st][0] }); } }, NEXT[st][1]));
    if (state.confirm === it.id) {
      acts.append(h('button', { type: 'button', class: 'btn small danger', disabled: busy, onclick: function () { hapus(it); } }, 'Yakin hapus'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: function () { state.confirm = null; renderBoard(); } }, 'Batal'));
    } else {
      acts.append(h('button', { type: 'button', class: 'btn small ghost', disabled: busy, onclick: function () { state.confirm = it.id; renderBoard(); } }, 'Hapus'));
    }
    return h('article', { class: 'req' + (st === 'selesai' ? ' done' : '') + (state.fresh[it.id] ? ' fresh' : ''), 'data-id': it.id },
      h('div', { class: 'req-top' },
        h('div', { class: 'when' }, h('span', { class: 'when-day' }, it.tanggal ? T.labelTanggal(it.tanggal) : '-'), h('span', { class: 'when-time' }, it.jam ? T.fmtJam(it.jam) + ' WIB' : '')),
        h('span', { class: 'pill ' + st }, STATUS[st])),
      late ? h('p', { class: 'late' }, 'Lewat jadwal') : null,
      h('h3', { class: 'req-name' }, it.nama || 'Tanpa nama', it.source === 'manual' ? h('span', { class: 'tag' }, 'Manual') : null),
      it.jenis ? h('span', { class: 'tag' }, it.jenis) : null,
      h('p', { class: 'req-msg' }, it.pesan || ''),
      h('dl', { class: 'meta' },
        it.kode ? metaRow('Nota', it.kode) : null,
        metaRow('Daerah', T.daerahText(it) || '-'),
        it.alamat ? metaRow('Alamat', it.alamat) : null,
        metaRow('HP', phone),
        it.email ? metaRow('Email', it.email) : null,
        Number(it.biaya) > 0 ? metaRow('Bayar', T.rp(it.biaya) + ', ' + (it.bayar === 'lunas' ? 'lunas' : 'belum dibayar')) : null),
      acts);
  }

  function renderFilters() {
    var box = $('#filters');
    box.replaceChildren();
    var items = state.items || [];
    function cnt(s) { return items.filter(function (i) { return nStatus(i) === s; }).length; }
    var sRow = h('div', { class: 'chips' });
    [['semua', 'Semua', items.length], ['baru', 'Baru', cnt('baru')], ['proses', 'Diproses', cnt('proses')], ['selesai', 'Selesai', cnt('selesai')]].forEach(function (x) {
      sRow.append(h('button', { type: 'button', class: 'pill-btn', 'aria-pressed': String(state.fs === x[0]), onclick: function () { state.fs = x[0]; renderBoard(); } }, x[1] + ' ' + x[2]));
    });
    var aRow = h('div', { class: 'chips' });
    [['semua', 'Semua daerah'], ['jaksel', 'Jakarta Selatan'], ['depok', 'Depok']].forEach(function (x) {
      aRow.append(h('button', { type: 'button', class: 'pill-btn', 'aria-pressed': String(state.fd === x[0]), onclick: function () { state.fd = x[0]; renderBoard(); } }, x[1]));
    });
    box.append(sRow, aRow);
  }
  function renderBoard() {
    var list = $('#board-list');
    list.replaceChildren();
    var items = state.items;
    renderFilters();
    var nBaru = (items || []).filter(function (i) { return nStatus(i) === 'baru'; }).length;
    var badge = $('#tab-count');
    badge.textContent = nBaru;
    badge.hidden = nBaru === 0;
    if (items === null) { list.append(h('p', { class: 'muted' }, 'Memuat permintaan…')); return; }
    if (!items.length) {
      list.append(h('div', { class: 'empty' }, h('b', null, 'Belum ada permintaan'), 'Pesanan dari halaman pelanggan akan muncul di sini otomatis.'));
      return;
    }
    var shown = items.filter(function (i) {
      return (state.fs === 'semua' || nStatus(i) === state.fs) && (state.fd === 'semua' || i.daerah === state.fd);
    });
    if (!shown.length) {
      list.append(h('div', { class: 'empty' }, h('b', null, 'Tidak ada yang cocok'), 'Coba ganti filter di atas.'));
      return;
    }
    var active = shown.filter(function (i) { return i.status !== 'selesai'; }).sort(function (a, b) { return schedKey(a) - schedKey(b); });
    var done = shown.filter(function (i) { return i.status === 'selesai'; }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    active.concat(done).forEach(function (it) { list.append(card(it)); });
  }

  /* ---------- Tempel pesan pelanggan ---------- */
  var KEYMAP = { nama: 'nama', nohp: 'hp', email: 'email', bantuan: 'bantuan', daerah: 'daerah', alamat: 'alamat', waktu: 'waktu', nota: 'nota' };
  function parseMessage(text) {
    var raw = {}, cur = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*(Nama|No\.?\s*HP|Email|Bantuan|Daerah|Alamat|Waktu|Nota)\s*:\s*(.*)$/i);
      if (m) { cur = KEYMAP[m[1].toLowerCase().replace(/[.\s]/g, '')]; raw[cur] = m[2].trim(); }
      else if (cur === 'bantuan' && line.trim()) { raw.bantuan += '\n' + line.trim(); }
    });
    var o = { nama: (raw.nama || '').trim(), email: (raw.email || '').trim(), alamat: (raw.alamat || '').trim(), jenis: '', pesan: '', daerah: '', kec: '', tanggal: '', jam: '', hp: T.normHp(raw.hp || ''), kode: (raw.nota || '').trim().toUpperCase() };
    var b = raw.bantuan || '';
    for (var i = 0; i < T.JENIS.length; i++) {
      if (b.indexOf(T.JENIS[i] + '. ') === 0) { o.jenis = T.JENIS[i]; b = b.slice(T.JENIS[i].length + 2); break; }
    }
    o.pesan = b.trim();
    var d = raw.daerah || '', dl = d.toLowerCase();
    if (dl.indexOf('jakarta selatan') === 0 || dl.indexOf('jaksel') === 0) o.daerah = 'jaksel';
    else if (dl.indexOf('depok') === 0) o.daerah = 'depok';
    if (o.daerah) {
      var rest = d.split(',').slice(1).join(',').trim().toLowerCase();
      DAERAH[o.daerah].kec.forEach(function (k) { if (k.toLowerCase() === rest) o.kec = k; });
    }
    var w = raw.waktu || '';
    var dm = w.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
    if (dm) {
      var mi = T.BULAN.map(function (x) { return x.toLowerCase(); }).indexOf(dm[2].slice(0, 3).toLowerCase());
      var dd = Number(dm[1]);
      if (mi >= 0 && dd >= 1 && dd <= 31) o.tanggal = dm[3] + '-' + T.pad(mi + 1) + '-' + T.pad(dd);
    }
    var tm = w.match(/(\d{1,2})[.:](\d{2})/);
    if (tm && Number(tm[1]) < 24 && Number(tm[2]) < 60) o.jam = T.pad(Number(tm[1])) + ':' + tm[2];
    return o;
  }
  function renderPaste() {
    var out = $('#paste-out');
    out.replaceChildren();
    var txt = $('#f-tempel').value.trim();
    if (!txt) return;
    var p = parseMessage(txt), probs = [];
    if (p.nama.length < 2) probs.push('Nama belum terbaca.');
    if (!p.hp) probs.push('Nomor HP belum terbaca atau formatnya belum benar.');
    if (!p.pesan) probs.push('Isi permintaan belum terbaca.');
    if (!p.daerah) probs.push('Daerah belum terbaca (Jakarta Selatan atau Depok).');
    if (!p.tanggal) probs.push('Tanggal belum terbaca.');
    if (!p.jam) probs.push('Jam belum terbaca.');
    if (p.kode && state.items && state.items.some(function (i) { return i.kode === p.kode; })) probs.push('Nota ' + p.kode + ' sudah ada di papan.');
    var rows = [metaRow('Nama', p.nama || '-'), metaRow('HP', T.fmtHp(p.hp) || '-')];
    if (p.email) rows.push(metaRow('Email', p.email));
    rows.push(metaRow('Bantuan', (p.jenis ? p.jenis + '. ' : '') + (p.pesan || '-')));
    rows.push(metaRow('Daerah', T.daerahText(p) || '-'));
    if (p.alamat) rows.push(metaRow('Alamat', p.alamat));
    rows.push(metaRow('Waktu', p.tanggal ? T.fullTanggal(p.tanggal) + (p.jam ? ', ' + T.fmtJam(p.jam) + ' WIB' : '') : '-'));
    if (p.kode) rows.push(metaRow('Nota', p.kode));
    out.append(h('div', { class: 'parsed' },
      h('span', { class: 'lbl' }, 'Hasil bacaan'),
      h('dl', { class: 'meta' }, rows),
      probs.length ? h('ul', { class: 'problems' }, probs.map(function (t) { return h('li', null, t); })) : h('p', { class: 'ok-line' }, 'Semua data terbaca. Cek lalu simpan.'),
      h('div', { class: 'req-act' },
        h('button', { type: 'button', class: 'btn small', disabled: (probs.length > 0 || state.pasteSaving), onclick: function () { savePaste(p); } }, 'Simpan ke papan'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: clearPaste }, 'Bersihkan'))));
  }
  function clearPaste() { $('#f-tempel').value = ''; renderPaste(); }
  function savePaste(p) {
    if (state.pasteSaving) return;
    state.pasteSaving = true; renderPaste();
    var body = { nama: p.nama, hp: p.hp, email: p.email, jenis: p.jenis, pesan: p.pesan, daerah: p.daerah, kec: p.kec, alamat: p.alamat, tanggal: p.tanggal, jam: p.jam, kode: p.kode };
    call('POST', '/api/admin/requests', body).then(function (r) {
      if (r.status === 201) { toast('Tersimpan di papan.'); $('#f-tempel').value = ''; poll(); }
      else toast(failMsg(r));
    }, function (e) { toast(failMsg(null, e)); }).then(function () { state.pasteSaving = false; renderPaste(); });
  }
  $('#f-tempel').addEventListener('input', renderPaste);

  /* ---------- Pembayaran ---------- */
  function parseRp(s) { var d = String(s || '').replace(/\D/g, ''); return d ? Math.min(parseInt(d, 10), 999999999) : 0; }
  function waTagihan(it) {
    var first = String(it.nama || '').split(/\s+/)[0];
    var L = ['Halo kak ' + first + ', ini tagihan untuk permintaan tolongnya' + (it.kode ? ' (nota ' + it.kode + ')' : '') + '.', ''];
    L.push('Bantuan: ' + (it.jenis ? it.jenis + '. ' : '') + it.pesan);
    if (it.tanggal) L.push('Waktu: ' + T.fullTanggal(it.tanggal) + (it.jam ? ', ' + T.fmtJam(it.jam) + ' WIB' : ''));
    L.push('Total: ' + T.rp(it.biaya));
    if (state.payinfo) { L.push('', 'Cara bayar:', state.payinfo); }
    L.push('', 'Kalau sudah dibayar, kabari ya kak. Terima kasih!');
    return 'https://wa.me/' + it.hp + '?text=' + encodeURIComponent(L.join('\n'));
  }
  function draftOf(it) {
    var d = state.draft[it.id];
    return d || { biaya: Number(it.biaya) > 0 ? String(it.biaya) : '', metode: it.metode || '' };
  }
  function savePay(it, extra, okMsg) {
    if (state.busy.has(it.id)) return;
    var d = draftOf(it);
    var biaya = parseRp(d.biaya);
    if (extra.bayar === 'lunas' && !(biaya > 0)) {
      toast('Isi biaya dulu sebelum menandai lunas.');
      var inp = document.getElementById('bi-' + it.id);
      if (inp) inp.focus();
      return;
    }
    var patch = Object.assign({ biaya: biaya, metode: d.metode }, extra);
    patchItem(it, patch, okMsg).then(function (ok) { if (ok) delete state.draft[it.id]; renderPay(); });
  }
  function saveInfo() {
    var btn = $('#btn-info'), val = $('#f-info').value.trim();
    btn.disabled = true;
    call('PUT', '/api/admin/settings', { payInfo: val }).then(function (r) {
      if (r.status === 200) { state.payinfo = val.slice(0, 300); toast('Info pembayaran tersimpan.'); renderPay(); }
      else toast(failMsg(r));
    }, function (e) { toast(failMsg(null, e)); }).then(function () { btn.disabled = false; });
  }
  $('#btn-info').addEventListener('click', saveInfo);

  function stat(label, num, sub, cls) {
    return h('div', { class: 'stat' }, h('span', { class: 'stat-lbl' }, label), h('span', { class: 'stat-num ' + cls }, num), h('span', { class: 'stat-lbl' }, sub));
  }
  function payCard(it) {
    var lunas = it.bayar === 'lunas';
    var busy = state.busy.has(it.id);
    var d = draftOf(it);
    var inp = h('input', { class: 'in', id: 'bi-' + it.id, type: 'text', inputmode: 'numeric', maxlength: '11', 'aria-label': 'Biaya dalam rupiah', placeholder: '25000', value: d.biaya });
    inp.addEventListener('input', function () { var x = draftOf(it); state.draft[it.id] = { biaya: inp.value, metode: x.metode }; });
    var sel = h('select', { class: 'in', id: 'bm-' + it.id, 'aria-label': 'Metode bayar' });
    METODE.forEach(function (m) { sel.append(h('option', { value: m[0] }, m[1])); });
    sel.value = d.metode;
    sel.addEventListener('change', function () { var x = draftOf(it); state.draft[it.id] = { biaya: x.biaya, metode: sel.value }; });
    var acts = h('div', { class: 'req-act' });
    acts.append(h('button', { type: 'button', class: 'btn small ghost', disabled: busy, onclick: function () { savePay(it, {}, 'Biaya tersimpan.'); } }, 'Simpan biaya'));
    if (lunas) {
      acts.append(h('button', { type: 'button', class: 'btn small ghost', disabled: busy, onclick: function () { savePay(it, { bayar: 'belum' }, 'Status dikembalikan ke belum dibayar.'); } }, 'Batalkan lunas'));
    } else {
      acts.append(h('button', { type: 'button', class: 'btn small', disabled: busy, onclick: function () { savePay(it, { bayar: 'lunas' }, 'Ditandai lunas.'); } }, 'Tandai lunas'));
      if (it.hp && Number(it.biaya) > 0) acts.append(h('a', { class: 'btn small ghost', href: waTagihan(it), target: '_blank', rel: 'noopener' }, 'Kirim tagihan'));
    }
    return h('article', { class: 'req' + (lunas ? ' done' : '') },
      h('div', { class: 'req-top' },
        h('div', { class: 'when' }, h('h3', { class: 'req-name' }, it.nama || 'Tanpa nama'), h('span', { class: 'kode' }, (it.kode || '-') + (it.tanggal ? ' · ' + T.labelTanggal(it.tanggal) : ''))),
        h('span', { class: 'pill ' + (lunas ? 'lunas' : 'belum') }, lunas ? 'Lunas' : 'Belum bayar')),
      h('p', { class: 'clamp' }, (it.jenis ? it.jenis + '. ' : '') + (it.pesan || '')),
      h('div', { class: 'row2' },
        h('div', { class: 'field' }, h('label', { for: 'bi-' + it.id }, 'Biaya (Rp)'), inp),
        h('div', { class: 'field' }, h('label', { for: 'bm-' + it.id }, 'Metode'), sel)),
      Number(it.biaya) > 0 ? h('p', { class: 'note' }, 'Tersimpan: ' + T.rp(it.biaya)) : h('p', { class: 'note' }, 'Isi biaya lalu tekan Simpan biaya. Tombol tagihan muncul setelah biaya tersimpan.'),
      acts);
  }
  function renderPay() {
    var items = state.items;
    var list = $('#pay-list'), stats = $('#stats'), fbox = $('#bfilters');
    list.replaceChildren(); stats.replaceChildren(); fbox.replaceChildren();
    if (items === null) { list.append(h('p', { class: 'muted' }, 'Memuat…')); return; }
    var sumBelum = 0, nBelum = 0, sumLunas = 0, nLunas = 0, nTanpa = 0;
    items.forEach(function (i) {
      var b = Number(i.biaya) || 0;
      if (!(b > 0)) { nTanpa++; return; }
      if (i.bayar === 'lunas') { sumLunas += b; nLunas++; } else { sumBelum += b; nBelum++; }
    });
    stats.append(stat('Belum dibayar', T.rp(sumBelum), nBelum + ' permintaan', 'warn'), stat('Sudah diterima', T.rp(sumLunas), nLunas + ' permintaan', 'ok'), stat('Belum ada biaya', String(nTanpa), 'permintaan', ''));
    var row = h('div', { class: 'chips' });
    [['semua', 'Semua'], ['belum', 'Belum dibayar'], ['lunas', 'Lunas']].forEach(function (x) {
      row.append(h('button', { type: 'button', class: 'pill-btn', 'aria-pressed': String(state.fb === x[0]), onclick: function () { state.fb = x[0]; renderPay(); } }, x[1]));
    });
    fbox.append(row);
    if (!items.length) {
      list.append(h('div', { class: 'empty' }, h('b', null, 'Belum ada permintaan'), 'Pesanan yang masuk muncul di sini untuk dicatat biayanya.'));
      return;
    }
    var shown = items.filter(function (i) {
      var lunas = i.bayar === 'lunas';
      return state.fb === 'semua' || (state.fb === 'lunas' ? lunas : !lunas);
    });
    if (!shown.length) { list.append(h('div', { class: 'empty' }, h('b', null, 'Tidak ada yang cocok'), 'Coba ganti filter di atas.')); return; }
    var open = shown.filter(function (i) { return i.bayar !== 'lunas'; }).sort(function (a, b) { return schedKey(a) - schedKey(b); });
    var paid = shown.filter(function (i) { return i.bayar === 'lunas'; }).sort(function (a, b) { return (b.dibayarAt || b.createdAt || 0) - (a.dibayarAt || a.createdAt || 0); });
    open.concat(paid).forEach(function (it) { list.append(payCard(it)); });
  }

  /* ---------- Mulai: cek apakah sudah login ---------- */
  call('GET', '/api/admin/me').then(function (r) {
    if (r.status === 200) enter(); else showLogin();
  }, function () {
    showLogin();
    var err = $('#e-pass');
    err.textContent = 'Server belum merespons. Kalau baru bangun, tunggu sekitar satu menit lalu muat ulang.';
    err.hidden = false;
  });
})();
