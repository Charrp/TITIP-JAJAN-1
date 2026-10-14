/* Halaman pelanggan: form tiga langkah yang mengirim pesanan ke server. */
(function () {
  'use strict';
  var T = window.TD, $ = T.$, h = T.h;

  var DAERAH = T.DAERAH;
  var JAM_PRESET = [['Pagi', '09:00'], ['Siang', '13:00'], ['Sore', '16:00'], ['Malam', '19:00']];
  var STEP_LABEL = ['Data kamu', 'Bantuan', 'Waktu dan tempat'];
  var STEP_FIELDS = { 1: ['f-nama', 'f-hp', 'f-email'], 2: ['f-pesan'], 3: ['daerah', 'f-tanggal', 'f-jam'] };
  var ALL_FIELDS = STEP_FIELDS[1].concat(STEP_FIELDS[2], STEP_FIELDS[3]);
  /* Nama kolom dari server -> id isian di halaman */
  var SERVER_KEY = { nama: 'f-nama', hp: 'f-hp', email: 'f-email', pesan: 'f-pesan', daerah: 'daerah', tanggal: 'f-tanggal', jam: 'f-jam' };

  var state = { step: 1, created: null, sending: false, cfg: { adminWa: '', payInfo: '' } };
  var form = $('#wiz');

  /* ---------- Pengaturan dari server (nomor WA, info bayar) ---------- */
  function loadConfig() {
    return T.api('GET', '/api/config', undefined, 15000).then(function (r) {
      if (r.status === 200 && r.data) {
        state.cfg.adminWa = String(r.data.adminWa || '');
        state.cfg.payInfo = String(r.data.payInfo || '');
      }
    }, function () { /* tidak fatal */ });
  }

  /* ---------- Form ---------- */
  T.JENIS.forEach(function (j) {
    $('#jenis-chips').append(h('label', { class: 'chip' }, h('input', { type: 'radio', name: 'jenis', value: j }), h('span', null, j)));
  });
  var tglBtns = [['Hari ini', 0], ['Besok', 1], ['Lusa', 2]].map(function (x) {
    var b = h('button', { type: 'button', class: 'pill-btn', 'aria-pressed': 'false' }, x[0]);
    b.addEventListener('click', function () { setField('f-tanggal', T.ymd(T.addDays(new Date(), x[1]))); });
    b.dataset.off = x[1];
    $('#tgl-chips').append(b);
    return b;
  });
  var jamBtns = JAM_PRESET.map(function (x) {
    var b = h('button', { type: 'button', class: 'pill-btn', 'aria-pressed': 'false' }, x[0] + ' ' + T.fmtJam(x[1]));
    b.addEventListener('click', function () { setField('f-jam', x[1]); });
    b.dataset.val = x[1];
    $('#jam-chips').append(b);
    return b;
  });
  $('#f-tanggal').min = T.ymd(new Date());

  function setField(id, val) {
    var el = document.getElementById(id);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function syncPressed() {
    var t = $('#f-tanggal').value, j = $('#f-jam').value;
    tglBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(t === T.ymd(T.addDays(new Date(), Number(b.dataset.off))))); });
    jamBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(j === b.dataset.val)); });
  }
  function fillKec(daerah) {
    var sel = $('#f-kec');
    sel.replaceChildren();
    var d = DAERAH[daerah];
    if (!d) { sel.append(h('option', { value: '' }, 'Pilih daerah dulu')); sel.disabled = true; return; }
    sel.disabled = false;
    sel.append(h('option', { value: '' }, 'Pilih kecamatan'));
    d.kec.forEach(function (k) { sel.append(h('option', { value: k }, k)); });
  }
  function readForm() {
    function g(id) { return document.getElementById(id).value.trim(); }
    function rad(n) { var r = form.querySelector('input[name="' + n + '"]:checked'); return r ? r.value : ''; }
    return {
      nama: g('f-nama'), hp: g('f-hp'), email: g('f-email'), jenis: rad('jenis'), pesan: g('f-pesan'),
      daerah: rad('daerah'), kec: g('f-kec'), alamat: g('f-alamat'),
      tanggal: document.getElementById('f-tanggal').value, jam: document.getElementById('f-jam').value
    };
  }
  /* Pemeriksaan cepat di browser. Server tetap memeriksa ulang semuanya. */
  function validate(v, step) {
    var e = {};
    if (step === 1) {
      if (v.nama.length < 2) e['f-nama'] = 'Tulis nama kamu, minimal 2 huruf.';
      if (!T.normHp(v.hp)) e['f-hp'] = 'Nomor HP belum benar. Tulis seperti 0812 3456 7890.';
      if (v.email && !T.EMAIL.test(v.email)) e['f-email'] = 'Format email belum benar. Contoh: nama@email.com.';
    }
    if (step === 2) {
      if (v.pesan.length < 8) e['f-pesan'] = 'Ceritakan sedikit lebih jelas apa yang perlu dibantu.';
    }
    if (step === 3) {
      if (!v.daerah) e.daerah = 'Pilih Jakarta Selatan atau Depok.';
      if (!v.tanggal) e['f-tanggal'] = 'Pilih tanggal.';
      else if (T.dayDiff(v.tanggal) < 0) e['f-tanggal'] = 'Tanggal itu sudah lewat. Pilih hari ini atau sesudahnya.';
      if (!v.jam) e['f-jam'] = 'Pilih jam.';
      else if (v.tanggal && T.dayDiff(v.tanggal) === 0) {
        var s = T.parseSched(v.tanggal, v.jam);
        if (s && s <= new Date()) e['f-jam'] = 'Jam itu sudah lewat. Pilih jam setelah sekarang.';
      }
    }
    return e;
  }
  function errEl(key) { return document.getElementById('e-' + key.replace(/^f-/, '')); }
  function setError(key, msg) {
    var el = errEl(key), input = document.getElementById(key);
    if (msg) { el.textContent = msg; el.hidden = false; if (input) input.setAttribute('aria-invalid', 'true'); }
    else { el.hidden = true; if (input) input.removeAttribute('aria-invalid'); }
  }
  function formError(msg) {
    var el = $('#e-form');
    if (msg) { el.textContent = msg; el.hidden = false; } else { el.hidden = true; }
  }
  function showErrors(errs, step) {
    var keys = STEP_FIELDS[step];
    keys.forEach(function (k) { setError(k, errs[k]); });
    var first = keys.filter(function (k) { return errs[k]; })[0];
    if (!first) return;
    var target = first === 'daerah' ? form.querySelector('input[name="daerah"]') : document.getElementById(first);
    if (target) target.focus();
  }

  /* ---------- Langkah ---------- */
  function renderSteps() {
    var ol = $('#steps');
    ol.replaceChildren();
    STEP_LABEL.forEach(function (label, i) {
      var n = i + 1;
      var li = h('li', { class: n < state.step ? 'done' : (n === state.step ? 'cur' : '') }, label);
      if (n === state.step) li.setAttribute('aria-current', 'step');
      ol.append(li);
    });
  }
  function reduceMotion() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function go(n, focusTitle) {
    state.step = n;
    [1, 2, 3].forEach(function (i) { $('#s' + i).hidden = i !== n; });
    $('#btn-back').hidden = n === 1;
    $('#btn-next').textContent = n === 3 ? 'Kirim permintaan' : 'Lanjut';
    $('#intro').hidden = n !== 1;
    renderSteps();
    if (focusTitle) {
      $('#s' + n + ' .step-title').focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
  }
  function showForm(show) {
    form.hidden = !show;
    $('#steps').hidden = !show;
    $('#result').hidden = show;
    $('#intro').hidden = show ? state.step !== 1 : true;
  }

  form.addEventListener('input', function (ev) {
    var t = ev.target, id = t && t.id;
    if (id && ALL_FIELDS.indexOf(id) >= 0) setError(id, '');
    if (t && t.name === 'daerah') { setError('daerah', ''); fillKec(t.value); }
    formError('');
    syncPressed();
  });
  form.addEventListener('change', function (ev) {
    if (ev.target && ev.target.name === 'daerah') fillKec(ev.target.value);
  });
  $('#btn-back').addEventListener('click', function () { if (state.step > 1 && !state.sending) go(state.step - 1, true); });

  function setSending(on) {
    state.sending = on;
    var b = $('#btn-next');
    b.disabled = on;
    b.textContent = on ? 'Mengirim…' : 'Kirim permintaan';
    $('#btn-back').disabled = on;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (state.sending) return;
    var v = readForm(), errs = validate(v, state.step);
    showErrors(errs, state.step);
    if (Object.keys(errs).length) return;
    if (state.step < 3) { go(state.step + 1, true); return; }
    var e1 = validate(v, 1), e2 = validate(v, 2);
    if (Object.keys(e1).length) { go(1, true); showErrors(e1, 1); return; }
    if (Object.keys(e2).length) { go(2, true); showErrors(e2, 2); return; }
    send(v);
  });

  function send(v) {
    formError('');
    setSending(true);
    var payload = {
      nama: v.nama, hp: v.hp, email: v.email, jenis: v.jenis, pesan: v.pesan,
      daerah: v.daerah, kec: v.kec, alamat: v.alamat, tanggal: v.tanggal, jam: v.jam,
      website: document.getElementById('f-website').value
    };
    T.api('POST', '/api/requests', payload).then(function (r) {
      if (r.status === 201 || r.status === 200) {
        state.created = {
          nama: v.nama, hp: T.normHp(v.hp), email: v.email, jenis: v.jenis, pesan: v.pesan,
          daerah: v.daerah, kec: v.kec, alamat: v.alamat, tanggal: v.tanggal, jam: v.jam,
          kode: String(r.data.kode || ''), createdAt: Number(r.data.createdAt) || Date.now()
        };
        if ($('#f-ingat').checked) T.lsSet('profil', JSON.stringify({ nama: v.nama, hp: v.hp, email: v.email })); else T.lsDel('profil');
        showForm(false);
        renderResult();
        window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
        $('#sent-title').focus({ preventScroll: true });
        return;
      }
      if (r.status === 400 && r.data && r.data.fields) { showServerErrors(r.data.fields); return; }
      formError(r.data && r.data.error ? r.data.error : 'Permintaan belum bisa dikirim. Coba lagi sebentar.');
    }, function (e) {
      formError(e.message === 'timeout'
        ? 'Server lagi bangun dan butuh waktu. Tunggu sebentar lalu tekan Kirim permintaan lagi.'
        : 'Tidak ada koneksi ke server. Cek internet kamu lalu coba lagi.');
    }).then(function () { setSending(false); });
  }

  function showServerErrors(fields) {
    var step = 3, firstKey = null;
    Object.keys(fields).forEach(function (k) {
      var id = SERVER_KEY[k];
      if (!id) return;
      setError(id, fields[k]);
      [1, 2, 3].forEach(function (s) { if (STEP_FIELDS[s].indexOf(id) >= 0 && s < step) step = s; });
      if (!firstKey) firstKey = id;
    });
    go(step, true);
    if (firstKey) {
      var target = firstKey === 'daerah' ? form.querySelector('input[name="daerah"]') : document.getElementById(firstKey);
      if (target) target.focus();
    }
  }

  /* ---------- Layar hasil ---------- */
  function buildMessage(c) {
    var L = ['Halo, aku mau minta tolong.', ''];
    L.push('Nama: ' + c.nama);
    L.push('No. HP: ' + T.fmtHp(c.hp));
    if (c.email) L.push('Email: ' + c.email);
    L.push('Bantuan: ' + (c.jenis ? c.jenis + '. ' : '') + c.pesan);
    L.push('Daerah: ' + T.daerahText(c));
    if (c.alamat) L.push('Alamat: ' + c.alamat);
    L.push('Waktu: ' + T.fullTanggal(c.tanggal) + ', ' + T.fmtJam(c.jam) + ' WIB');
    L.push('Nota: ' + c.kode);
    return L.join('\n');
  }
  function nrow(label, value) { return h('div', { class: 'nrow' }, h('dt', null, label), h('dd', null, value)); }
  function manualCopy(text) {
    var box = $('#manual'), ta = $('#manual-text');
    box.hidden = false; ta.value = text; ta.focus(); ta.select();
    try { if (document.execCommand && document.execCommand('copy')) { T.toast('Pesan tersalin.'); return; } } catch (e) { /* lanjut */ }
    T.toast('Salin otomatis tidak didukung di sini. Salin dari kotak di bawah.');
  }

  function renderResult() {
    var c = state.created;
    var wa = state.cfg.adminWa;
    $('#sent-sub').textContent = wa
      ? 'Permintaanmu sudah masuk ke papan kami. Biar lebih cepat, kirim juga nota ini lewat WhatsApp.'
      : 'Permintaanmu sudah masuk ke papan kami. Kami akan menghubungi kamu lewat WhatsApp.';

    var msgBox = h('div', { class: 'nota-msg' }, h('span', { class: 'lbl' }, 'Minta tolong'));
    if (c.jenis) msgBox.append(h('span', { class: 'tag' }, c.jenis));
    msgBox.append(h('div', { class: 'lined' }, c.pesan));
    var rows = [nrow('Nama', c.nama), nrow('No. HP', T.fmtHp(c.hp))];
    if (c.email) rows.push(nrow('Email', c.email));
    rows.push(nrow('Daerah', T.daerahText(c)));
    if (c.alamat) rows.push(nrow('Alamat', c.alamat));
    rows.push(nrow('Jadwal', T.fullTanggal(c.tanggal) + ', ' + T.fmtJam(c.jam) + ' WIB'));
    $('#nota').replaceChildren(
      h('article', { class: 'nota' },
        h('div', { class: 'nota-head' }, h('h2', null, 'Nota tolong'), h('span', { class: 'nota-no' }, c.kode)),
        h('dl', { class: 'nota-rows' }, rows),
        msgBox,
        h('div', { class: 'nota-foot' }, h('span', null, 'Dibuat ' + T.stampTime(c.createdAt)), h('span', { class: 'stamp' }, 'Terkirim'))));

    var msg = buildMessage(c);
    var act = $('#actions');
    act.replaceChildren();
    var row = h('div', { class: 'row' });
    if (wa) {
      row.append(h('a', { class: 'btn', href: 'https://wa.me/' + wa + '?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener' }, 'Kirim juga lewat WhatsApp'));
      row.append(h('button', { type: 'button', class: 'btn ghost', onclick: function () { T.copyText(msg, 'Pesan tersalin. Tempel di WhatsApp.', manualCopy); } }, 'Salin pesan'));
    } else {
      row.append(h('button', { type: 'button', class: 'btn ghost', onclick: function () { T.copyText(msg, 'Pesan tersalin.', manualCopy); } }, 'Salin pesan'));
    }
    var row2 = h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: newRequest }, 'Buat permintaan baru'));
    act.append(row, row2);

    var after = $('#after');
    after.replaceChildren(h('h3', null, 'Setelah ini'));
    var li3 = [h('span', null, 'Kamu bayar sesuai rincian itu, bisa lewat transfer, QRIS, atau tunai.')];
    if (state.cfg.payInfo) li3.push(h('div', { class: 'payinfo' }, state.cfg.payInfo));
    after.append(h('ol', null,
      h('li', null, h('span', null, 'Kami cek permintaanmu dan menghubungi kamu lewat WhatsApp untuk konfirmasi lokasi dan jadwal.')),
      h('li', null, h('span', null, 'Kami kirim rincian biaya setelah semuanya jelas.')),
      h('li', null, h('div', null, li3))));
  }

  function newRequest() {
    state.created = null;
    $('#manual').hidden = true;
    form.reset();
    fillKec('');
    ALL_FIELDS.forEach(function (k) { setError(k, ''); });
    formError('');
    prefill();
    syncPressed();
    showForm(true);
    go(1, true);
  }
  function prefill() {
    var raw = T.lsGet('profil');
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        if (p.nama) $('#f-nama').value = String(p.nama).slice(0, 60);
        if (p.hp) $('#f-hp').value = String(p.hp).slice(0, 20);
        if (p.email) $('#f-email').value = String(p.email).slice(0, 80);
        $('#f-ingat').checked = true;
      }
    } catch (e) { /* abaikan */ }
  }

  prefill();
  syncPressed();
  go(1, false);
  loadConfig();
})();
