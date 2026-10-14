# Tolong Dong

Form pesanan untuk pelanggan, papan permintaan untuk kamu, dan catatan pembayaran. Pesanan pelanggan langsung masuk ke papan admin.

- Halaman pelanggan: `https://alamat-kamu/`
- Halaman admin (pakai password): `https://alamat-kamu/admin`

```
Pelanggan  ->  Server (Cloudflare Workers)  ->  Database (Neon)  <-  Papan admin kamu
```

Kode yang sama bisa jalan di dua tempat:

- **Cloudflare Workers** (panduan utama di bawah): gratis, tidak tidur, tidak perlu menaruh info kartu menurut halaman harga Cloudflare yang gw baca, tapi cek sendiri saat daftar.
- **Server Node biasa** (Render, VPS, laptop): lihat bagian "Alternatif" di bawah.

## Hosting gratis di Cloudflare, langkah demi langkah

Semua lewat browser, tidak perlu install apa pun. Sekitar 20 menit.

### Langkah 1. Taruh kode di GitHub

1. Buat akun di [github.com](https://github.com) kalau belum punya.
2. Klik **New repository**, nama bebas (misalnya `tolong-dong`). Pilih **Public** (tidak ada rahasia di dalam kode, password disimpan terpisah). Klik **Create repository**.
3. Di halaman repo kosong, klik **uploading an existing file**.
4. Ekstrak file zip proyek ini, lalu **seret semua isinya** ke halaman GitHub: folder `lib`, `public`, `test`, dan file `server.js`, `worker.mjs`, `wrangler.jsonc`, `package.json`, `README.md`, `.gitignore`, `.env.example`. Folder harus ikut terbawa, jangan hanya isinya.
5. Klik **Commit changes**.

Cek: di halaman repo, `worker.mjs` dan `wrangler.jsonc` harus langsung terlihat di bagian atas (bukan di dalam folder lain).

### Langkah 2. Buat database gratis di Neon

1. Daftar di [neon.com](https://neon.com) (bisa pakai akun Google atau GitHub, tanpa kartu kredit).
2. Klik **Create project**, nama bebas. Kalau ada pilihan region, pilih **Singapore**.
3. Klik **Connect**, salin **connection string** yang awalnya `postgresql://...`. Simpan dulu untuk langkah 4. Untuk Cloudflare, nyalakan toggle **Connection pooling** kalau ada.

Kalau di ujung string ada `&channel_binding=require`, biarkan saja. Server otomatis membuangnya.

### Langkah 3. Hubungkan repo ke Cloudflare

1. Daftar di [dash.cloudflare.com](https://dash.cloudflare.com) dan verifikasi emailmu.
2. Buka **Workers & Pages**, klik **Create application**, lalu di **Import a repository** klik **Get started**.
3. Hubungkan akun GitHub, pilih repo `tolong-dong`.
4. Isi:
   - **Project/Worker name**: `tolong-dong`. Harus sama persis dengan `name` di `wrangler.jsonc`. Kalau nama itu sudah dipakai orang lain, ganti keduanya (di dashboard dan di file `wrangler.jsonc` di GitHub).
   - **Build command**: `npm install`
   - **Deploy command**: `npx wrangler deploy`
5. Klik **Save and Deploy**. Build pertama bisa berhasil tapi situsnya akan menampilkan "Server belum dikonfigurasi" sampai langkah 4 selesai. Itu normal.

### Langkah 4. Isi pengaturan rahasia

1. Buka Worker `tolong-dong` lalu **Settings** > **Variables and Secrets** (bukan bagian Build).
2. Tambahkan empat ini. Pilih tipe **Secret** untuk tiga yang pertama:

   | Nama | Isi |
   |---|---|
   | `DATABASE_URL` | connection string dari Neon (langkah 2) |
   | `ADMIN_PASSWORD` | password admin kamu, minimal 8 karakter, makin panjang makin aman |
   | `SESSION_SECRET` | rangkaian acak minimal 16 karakter, ketik asal 32 huruf dan angka campur |
   | `ADMIN_WA` | nomor WhatsApp usaha, misalnya `081234567890` (tipe Text, boleh dikosongkan) |

3. Simpan dan deploy ulang kalau diminta.

### Langkah 5. Coba

1. Buka alamat Worker kamu, bentuknya `https://tolong-dong.NAMA-AKUN.workers.dev/` (ada di halaman Worker). Kirim satu pesanan percobaan.
2. Buka `/admin`, masuk dengan `ADMIN_PASSWORD`. Pesanan tadi harus ada di Papan.
3. Di tab **Pembayaran**, isi **Info pembayaran** (rekening atau cara bayar). Itu tampil ke pelanggan setelah mereka kirim pesanan.
4. Hapus pesanan percobaan, lalu bagikan alamat halaman pelanggan (tanpa `/admin`).

Setiap kamu mengubah file di GitHub, Cloudflare otomatis memasang versi baru.

### Kalau gagal di build atau deploy

Kode ini sudah dites lengkap di komputer pengembang (logika server, database Postgres 16, login, pembatas, dan browser), tapi **belum bisa dicoba langsung di Cloudflare**, jadi bagian wrangler, runtime Workers, dan driver Neon asli bisa saja ada galat kecil saat pertama kali. Buka log build atau log Worker di dashboard, salin pesan galatnya, dan kirim ke yang membuat proyek ini supaya diperbaiki.

## Batas paket gratis

- **Cloudflare Workers gratis: 100.000 permintaan per hari dan 10 ms CPU per permintaan.** Cukup untuk ribuan kunjungan per hari. Halaman admin yang dibuka terus memuat ulang tiap 12 detik, sekitar 7.200 permintaan per hari per tab. Tutup tabnya kalau tidak dipakai.
- **Papan menampilkan 500 permintaan terbaru.** Supaya tetap ringan, unduh CSV lalu hapus pesanan lama yang sudah selesai dan lunas.
- **Neon gratis 1 GB.** Database tidur setelah 5 menit tidak dipakai, dan permintaan pertama sesudahnya lebih lambat satu atau dua detik.
- **Cadangan data**: tekan **Unduh CSV** di halaman admin secara rutin. File CSV bisa dibuka di Excel.
- Batas gratis bisa berubah. Cek [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) dan [Neon pricing](https://neon.com/pricing).

## Keamanan singkat

- Pelanggan hanya bisa **mengirim** pesanan. Membaca, mengubah, dan menghapus butuh login admin.
- Login dikunci sementara setelah 5 kali salah password. Pesanan dibatasi per perangkat dan ada jebakan anti-bot. Hitungannya disimpan di database.
- Semua isian diperiksa ulang di server, jadi aman walaupun ada yang mengakali form.
- Gunakan password admin yang panjang dan unik. Jangan simpan password di GitHub.

## Alternatif: server Node biasa (Render, VPS, laptop)

Butuh Node.js 20 atau lebih baru dan database Postgres (Neon). Perintahnya:

```
npm install
DATABASE_URL="postgresql://..." ADMIN_PASSWORD="password-panjang" SESSION_SECRET="rangkaian-acak-16+" npm start
```

Buka `http://localhost:3000`. Di Render: New + > Web Service, Build `npm install`, Start `npm start`, isi variabel `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `ADMIN_WA`, dan `NODE_ENV=production`. Render gratis tidur setelah 15 menit tanpa pengunjung dan saat daftar minta info kartu.

Tes otomatis: `npm test` (memakai SQLite bawaan Node, tidak butuh database).

## Isi proyek

- `worker.mjs` dan `wrangler.jsonc`: pintu masuk dan pengaturan Cloudflare Workers
- `server.js`: pintu masuk server Node biasa
- `lib/app.js`: seluruh logika API, login admin, dan pembatas (dipakai kedua pintu masuk)
- `lib/validate.js`: aturan isian
- `lib/store.js`, `lib/neon-store.js`, `lib/pg-store.js`: akses database
- `lib/limiter.js`, `lib/config.js`, `lib/static.js`: pembatas laju, pengaturan, daftar halaman
- `public/`: halaman pelanggan (`index.html`, `app.js`), halaman admin (`admin.html`, `admin.js`), gaya (`style.css`)
- `test/`: tes otomatis
