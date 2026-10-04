# DompetKu 🏠💸

Aplikasi **Sirkulasi Keuangan Rumah Tangga** berbasis Web (PWA) dengan backend Python standar
(tanpa dependency) sehingga data tersimpan di satu server dan bisa diakses dua anggota keluarga.
Dibagi menjadi tiga halaman: **Masuk** untuk autentikasi, **Catat** untuk input, **Laporan** untuk membaca.

## Halaman 1 — Catat (`index.html`)

- **Saldo Tersisa** sebagai elemen utama: total pemasukan, total pengeluaran, serta ringkasan hari ini, bulan ini, dan rata-rata harian.
- **Input satu layar** dengan toggle Pengeluaran/Pemasukan, nominal terformat otomatis (`12500` → `12.500`), pilihan kategori/sumber berupa chip, pintasan tanggal (Hari ini / Kemarin / kalender), dan keterangan opsional.
- Pratinjau **"Saldo setelah dicatat"** langsung di bawah nominal agar dampak transaksi terlihat sebelum disimpan.
- **Aktivitas** dikelompokkan per hari lengkap dengan net per hari, saringan (Semua/Pengeluaran/Pemasukan), pencarian, dan penanda transaksi tidak biasa.
- Transaksi bisa **diubah** (ketuk baris) dan **dihapus dengan undo**.

## Halaman 2 — Laporan (`laporan.html`)

- Pilihan periode: Hari Ini, 7 Hari, Bulan Ini, 3 Bulan, Tahun Ini, Semua, dan **Rentang Kustom**, dengan tombol mundur/maju periode.
- **4 KPI** lengkap dengan perbandingan terhadap periode sebelumnya: pemasukan, pengeluaran, selisih + tingkat tabungan, dan rata-rata harian.
- **Grafik tren arus kas** (harian/mingguan/bulanan sesuai panjang periode) dengan garis saldo kumulatif opsional.
- **Grafik komposisi pengeluaran** per kategori + legenda berisi porsi, total, dan bar.
- **Pengeluaran terbesar**, **Insight otomatis**, **tabel rincian per kategori**, dan **sumber pemasukan**.
- Ekspor **CSV** (periode terpilih) dan **backup/pemulihan JSON**.

### Insight yang dihitung otomatis

- Transaksi yang melebihi ambang **1,5× rata-rata pengeluaran harian** (ambang bisa diatur di Pengaturan).
- Hari dengan pengeluaran tertinggi, kategori terbesar, transaksi terbesar.
- Perubahan pengeluaran dibanding periode sebelumnya, termasuk kategori yang paling naik.
- Tingkat tabungan, rata-rata per hari, dan rentetan hari berbiaya berturut-turut.

## Halaman 0 — Masuk (`login.html`)

- Dua akun saja: `buya` dan `ummah`, password awal `rahasiasekali` (segera ganti lewat **Akun → Ganti password**).
- Maksimal **2 sesi aktif** untuk seluruh perangkat, bukan per akun.
- Sesi memakai cookie `HttpOnly` + `SameSite=Lax`, idle 30 hari, dan cookie `Secure` otomatis bila diakses via HTTPS.
- Login gagal 10 kali dalam 10 menit akan dikunci sementara.
- Panel **Akun** (tombol avatar di appbar) menampilkan perangkat yang sedang login, ganti password,
  keluarkan sesi lain, dan keluar.

## Teknologi

- HTML5 / CSS3 / JavaScript (ES Modules, Vanilla JS — tanpa build step)
- Backend `server.py`: Python stdlib (`http.server` + `sqlite3`), tanpa pip install
- Chart.js 4 (di-*vendor* lokal di `vendor/`, jadi tetap berfungsi offline)
- SQLite (WAL) sebagai sumber data bersama; `localStorage` hanya cache + antrean offline
- Service Worker untuk mode offline; request `/api/` tidak pernah di-cache
- Design system berbasis CSS custom properties dengan tema gelap & terang

## Menjalankan

```bash
python3 server.py serve --port 8090
# buka http://localhost:8090
```

Akun awal dibuat otomatis saat pertama kali dijalankan. Kelola lewat CLI:

```bash
python3 server.py user list
python3 server.py user passwd buya       # prompted password
python3 server.py sessions               # daftar sesi aktif
python3 server.py sessions revoke <token>
```

## Deploy

```bash
rsync -az --delete --exclude 'data/' --exclude '__pycache__/' \
  ./ muthi@192.168.100.25:/home/muthi/dompetku/

scp deploy/dompetku.service muthi@192.168.100.25:~/.config/systemd/user/
ssh muthi@192.168.100.25 'systemctl --user daemon-reload && systemctl --user enable --now dompetku'
```

Semua aset memakai path relatif, jadi aplikasi tetap jalan di sub-path reverse proxy.

### Alur kerja (repo = source of truth)

```bash
# di mesin kerja
git add -A && git commit -m "..." && git push

# di server lenovo
~/dompetku/deploy/update.sh     # git pull --ff-only + systemctl --user restart dompetku
```

Server memakai deploy key read-only (`~/.ssh/dompetku_deploy`), jadi tidak perlu PAT di server.
Folder `data/` tidak pernah disentuh oleh `git pull`.

### Domain dengan Cloudflare Tunnel (disarankan)

Lenovo berada di belakang router rumah, jadi **Cloudflare Tunnel** lebih aman daripada port
forward: tidak ada port terbuka, tidak peduli IP publik Indihome berganti, dan HTTPS otomatis.

```bash
# 1. Buat tunnel di dashboard Zero Trust -> Networks -> Tunnels -> Create
#    pilih cloudflared, isi nama "dompetku", lalu salin token yang muncul

# 2. Di lenovo, jalankan perintah yang diberikan dashboard (login dengan token):
cloudflared tunnel login            # hanya jika tidak memakai token dari dashboard
cloudflared service install <TOKEN> # atau daftarkan sebagai systemd user

# 3. Daftarkan hostname publik di dashboard:
#    Public Hostname -> dompetku.labku.xyz -> Service http://127.0.0.1:8090

# 4. Kalau ingin dijalankan sebagai systemd user dengan file konfigurasi:
cp deploy/cloudflared-dompetku.yml ~/.cloudflared/dompetku.yml   # isi UUID tunnel
cp deploy/cloudflared-dompetku.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now cloudflared-dompetku
```

Akses: **https://dompetku.labku.xyz** (dan tetap **http://192.168.100.25:8090** di LAN).

Catatan teknis:

- Cloudflare mengirim `X-Forwarded-Proto: https`, sehingga `server.py` otomatis memasang flag
  `Secure` pada cookie sesi. Akses HTTP LAN tetap memakai cookie tanpa `Secure`.
- `Origin` dicek oleh server agar request dari situs lain tidak bisa memakai sesi cookie Anda.
- Pastikan record DNS dibuat sebagai **CNAME** ke `<UUID>.cfargotunnel.com` dengan status
  **Proxied** (awan oranye). Cloudflare membuatnya otomatis saat Public Hostname ditambahkan.
- Kalau IP publik atau ISP bermasalah, tunnel tetap bekerja karena tidak bergantung pada IP.

## Struktur File

```
dompetku/
├── login.html            # Halaman Masuk
├── index.html            # Halaman Catat
├── laporan.html          # Halaman Laporan
├── css/
│   ├── base.css          # Token desain, komponen dasar (tema, tombol, sheet, toast, akun)
│   ├── auth.css          # Tampilan halaman masuk
│   ├── catat.css         # Hero saldo, form input, daftar aktivitas
│   └── laporan.css       # Periode, KPI, grafik, insight, tabel
├── js/
│   ├── utils.js          # Format rupiah/tanggal, ikon, helper DOM
│   ├── api.js            # Klien fetch: sesi, error, redirect saat logout
│   ├── store.js          # State server-backed, cache offline, outbox, backup, ekspor
│   ├── analytics.js      # Agregasi, rentang periode, deteksi anomali, insight
│   ├── charts.js         # Wrapper Chart.js yang mengikuti tema
│   ├── quick-form.js     # Form input yang dipakai di halaman Catat & sheet Ubah
│   ├── ui.js             # Tema, toast, bottom sheet, Pengaturan, panel akun, prompt install
│   ├── auth.js           # Logika halaman masuk
│   ├── catat.js          # Logika halaman Catat
│   └── laporan.js        # Logika halaman Laporan
├── server.py             # Backend stdlib: auth, sesi, API, static, CLI
├── deploy/               # Unit systemd + contoh reverse proxy Nginx
├── data/                 # SQLite (dibuat otomatis, tidak ikut rsync)
├── vendor/chart.umd.min.js
├── sw.js
├── manifest.json
└── icons/
```

## Data & Cadangan

Data utama tersimpan di server (`data/dompetku.db`, SQLite WAL) sehingga buya dan ummah melihat
dompet yang sama. Tampilan lokal memakai `localStorage` (kunci `dompetku.v2`) sebagai cache, dan
transaksi yang dicatat saat offline ditunda di antrean (`dompetku.outbox`) lalu dikirim otomatis
saat koneksi kembali. Data versi lama (`dompetku_data`) dipindahkan otomatis saat pertama masuk.

Cadangan rutin: **Laporan → Ekspor JSON**. Pemulihan tersedia di **Pengaturan → Pulihkan backup**.

## Catatan Teknis

- `todayStr()` memakai waktu lokal (bukan UTC) agar tanggal tidak bergeser di zona waktu WIB.
- Password disimpan dengan `hashlib.scrypt` + salt acak, tidak pernah plaintext.
- Field `dibuat` dan `oleh` selalu diisi server; nilai dari klien diabaikan.
- Seluruh teks dari pengguna aman dari XSS karena dirender lewat `textContent`, bukan `innerHTML`.
- Tata letak `color-mix()` selalu disertai fallback deklarasi warna biasa untuk browser yang belum mendukungnya.