# DompetKu 🏠💸

Aplikasi **Sirkulasi Keuangan Rumah Tangga** berbasis Web (PWA) dengan backend Python standar
(tanpa dependency) sehingga data tersimpan di satu server dan bisa diakses dua anggota keluarga.
Dibagi menjadi tiga halaman: **Masuk** untuk autentikasi, **Catat** untuk input, **Laporan** untuk membaca.

## Halaman 1 — Catat (`index.html`)

Beranda sengaja dibuat **ringkas**: saldo dan dua tombol. Semua input lain ada di dalam modal.

- **Saldo Tersisa** sebagai elemen utama: total pemasukan, total pengeluaran, serta ringkasan hari ini, bulan ini, dan rata-rata harian.
- Dua tombol aksi responsif — **Catat Pengeluaran** dan **Catat Pemasukan** — turun ke bawah pada layar sempit,berdampingan pada layar lebar.
- **Formulir berada di dalam modal** (bukan di halaman), jadi beranda tidak pernah panjang:
  - nominal terformat otomatis (`12500` → `12.500`) dengan pratinjau "Saldo setelah dicatat";
  - kategori/sumber berupa chip **teks saja** (tanpa ikon gambar);
  - pintasan tanggal (Hari ini / Kemarin / kalender), keterangan opsional, dan detail frekuensi;
  - tombol **Pindai struk** hanya muncul di modal pengeluaran.
- Setelah tersimpan, modal tertutup dan saldo langsung diperbarui. Tombol `n` membuka modal pengeluaran.
- Daftar transaksi tidak ada di beranda — semuanya ada di halaman Laporan.

## Halaman 2 — Laporan (`laporan.html`)

- Pilihan periode: Hari Ini, 7 Hari, Bulan Ini, 3 Bulan, Tahun Ini, Semua, dan **Rentang Kustom**, dengan tombol mundur/maju periode.
- **4 KPI** lengkap dengan perbandingan terhadap periode sebelumnya: pemasukan, pengeluaran, selisih + tingkat tabungan, dan rata-rata harian.
- **Grafik tren arus kas** (harian/mingguan/bulanan sesuai panjang periode) dengan garis saldo kumulatif opsional.
- **Grafik komposisi pengeluaran** per kategori + legenda berisi porsi, total, dan bar.
- **Pengeluaran terbesar**, **Insight otomatis**, **tabel rincian per kategori**, dan **sumber pemasukan**.
- **Daftar Transaksi**: seluruh riwayat (tidak terbatas periode) dengan pencarian, saringan
  (Semua/Pengeluaran/Pemasukan), kelompok per hari + net harian, penanda transaksi tidak biasa,
  serta tombol "Tampilkan lebih banyak". Ketuk baris untuk **mengubah** atau **menghapus dengan undo**.
- Ekspor **CSV** (periode terpilih) dan **backup/pemulihan JSON**.

### Insight yang dihitung otomatis

- Transaksi yang melebihi ambang **1,5× rata-rata pengeluaran harian** (ambang bisa diatur di Pengaturan).
- Hari dengan pengeluaran tertinggi, kategori terbesar, transaksi terbesar.
- Perubahan pengeluaran dibanding periode sebelumnya, termasuk kategori yang paling naik.
- Tingkat tabungan, rata-rata per hari, dan rentetan hari berbiaya berturut-turut.

## Halaman 0 — Masuk (`login.html`)

- Dua akun saja: `buya` dan `ummah`, password awal `rahasiasekali` (segera ganti lewat **Akun → Ganti password**).
- Maksimal **2 sesi aktif** untuk seluruh perangkat, bukan per akun.
- **Satu akun hanya boleh punya satu sesi aktif.** Login ulang (misalnya setelah cache PWA
  dibersihkan atau cookie hilang) otomatis mencabut sesi lama akun yang sama, jadi kuota tidak
  habis dipakai oleh satu orang. Efeknya: login dari perangkat kedua akan mengeluarkan
  perangkat pertama.
- Sesi memakai cookie `HttpOnly` + `SameSite=Lax`, idle 30 hari, dan cookie `Secure` otomatis bila diakses via HTTPS.
- Login gagal 10 kali dalam 10 menit akan dikunci sementara.
- Panel **Akun** (tombol avatar di appbar) menampilkan perangkat yang sedang login, ganti password,
  keluarkan sesi lain, dan keluar.
- Tekan **Keluar** selalu berakhir di halaman masuk dengan penjelasan: *“Anda sudah keluar”* kalau
  sesi berhasil diakhiri (atau memang sudah habis), dan pesan gagal yang jelas kalau server tak
  terjangkau. Tidak pernah lagi menampilkan error teknis.

## Teknologi

- HTML5 / CSS3 / JavaScript (ES Modules, Vanilla JS — tanpa build step)
- Backend `server.py`: Python stdlib (`http.server` + `sqlite3`), tanpa pip install
- Chart.js 4 (di-*vendor* lokal di `vendor/`, jadi tetap berfungsi offline)
- SQLite (WAL) sebagai sumber data bersama; `localStorage` hanya cache baca offline
- Service Worker untuk mode offline; request `/api/` tidak pernah di-cache, dan aplikasi
  berjalan baca-saja ketika jaringan tidak tersedia (lihat "Mode baca-saja offline")
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

## Pindai Struk (OCR)

Tombol **Pindai struk** di halaman Catat mengirim foto struk ke server, dibaca dengan `tesseract`,
lalu diuraikan oleh `receipt.py` menjadi draf: nama toko, tanggal, total, dan daftar barang.

```bash
# sekali saja di server (butuh sudo)
sudo apt install tesseract-ocr tesseract-ocr-ind
python3 server.py ocr            # cek kesiapan: binary, bahasa, install command bila kurang
python3 server.py ocr struk.jpg  # uji OCR dari terminal, tampilkan teks + draf + peringatan
```

### Konfirmasi wajib — tidak ada yang langsung tersimpan

OCR sering salah membaca angka dan huruf, jadi hasilnya **tidak pernah** langsung dicatat. Sheet
konfirmasi menampilkan:

- **Peringatan**: keyakinan OCR rendah, total tidak ditemukan, tanggal ambigu, atau total tidak
  sama dengan jumlah item.
- **Field bertanda "perlu dicek"**: toko, tanggal, dan total diberi penanda kuning bila tidak
  terbaca atau hanya ditebak.
- **Daftar barang**: tiap baris bisa diubah nominalnya, dicentang, di-uncheck agar tidak disimpan,
  atau dihapus. Baris dengan keyakinan OCR rendah diberi badge **Perlu dicek**.
- **Teks OCR mentah** yang bisa disunting, lalu pilih **Terapkan ulang** agar draf ikut dihitung
  dari teks yang sudah dikoreksi. Kategori yang ditebak juga bisa diganti.
- Tombol simpan menuliskan hanya baris yang dicentang, sebagai transaksi terpisah.

### Cara parser memilih angka

- Angka gaya Indonesia (`1.250.000`), gaya US (`1,250.00`), dan desimal (`45.000,50`) dinormalkan.
- Baris `2 x 4.500` atau `2 4.500` dibaca sebagai qty × harga satuan.
- Hanya baris **di atas** baris `TOTAL` yang dianggap barang, sehingga `TUNAI`, `KEMBALIAN`, dan
  `BAYAR VIA QRIS` tidak ikut terimpan.
- Kata kunci non-item dicocokkan sebagai kata utuh dengan toleransi satu huruf salah baca
  (mis. `TUNAT` untuk `TUNAI`).
- Kalau jumlah barang tidak sama dengan total struk, muncul peringatan selisih.

### Foto miring & nominal berformat spasi

- Foto yang diambil dengan HP miring **diluruskan otomatis**: orientasi EXIF diterapkan lebih dulu,
  lalu sudut putar dideteksi tesseract (Orientation & Script Detection, butuh data `osd`).
  Kalau drafnya tetap tidak meyakinkan, server mencoba satu atau dua sudut cadangan dan memakai
  hasil terbaik (skor: jumlah barang, total, kecocokan total vs jumlah barang, keyakinan OCR).
- Fallback dibatasi satu proses per sudut dan berhenti begitu dapat draf yang baik, agar foto
  yang sangat besar tidak membuat permintaan lama.
- Nomor dengan pemisah ribuan **spasi** (`TOTAL 92 800`) dibaca utuh sebagai 92.800 — pola ini
  sering dipakai printer struk dan sebelumnya terpotong jadi 800.
- Sheet konfirmasi menampilkan info `foto diluruskan 90°` kalau auto-orientasi berjalan.

### Pembaruan otomatis (PWA)

- PWA yang terpasang di home screen tidak punya tombol refresh. Aplikasi cek versi sendiri:
  `/api/health` melaporkan `version`, dan kalau server lebih baru dari shell yang sedang
  berjalan, muncul notifikasi **“Pembaruan DompetKu tersedia”** dengan tombol **Muat ulang**.
- Tombol itu memaksa `serviceWorker.update()` dan menunggu SW baru aktif (cache baru terisi)
  sebelum `location.reload()`, jadi setelah reload benar-benar dapat kode terbaru.
- Pemeriksaan berjalan 4 detik setelah buka, tiap kali tab kembali terlihat, dan tiap 10 menit.
- `/api/health` tidak pernah di-cache service worker, jadi versinya selalu benar.
- **Versi memakai skema MAJOR.MINOR (mis. `1.9`):** MAJOR hanya naik untuk perubahan
  besar/migrasi data, MINOR naik setiap rilis. Angka ini harus sama di tiga tempat —
  `APP_VERSION` di `server.py`, `APP_VERSION` di `js/utils.js`, dan `CACHE_NAME` di
  `sw.js` (prefiks `dompetku-`). `tests/test_version.py` gagal kalau ada yang lupa
  atau formatnya menyimpang dari `MAJOR.MINOR`.

### Mode baca-saja offline

Saldo, transaksi, dan laporan sudah tersimpan di `localStorage`, jadi
aplikasi tetap bisa dibuka dan dibaca tanpa internet.

- Boot tidak bergantung pada server. `init()` di `js/store.js` mengadopsi
  cache lokal lebih dahulu, memasang listener sinkron, lalu mencoba
  `api.session()`. Gagal karena offline hanya mengubah status: tidak
  melempar error dan tidak macet di "Memuat…".
- Saat offline aplikasi menjadi **baca-saja**. `addTransaction`,
  `updateTransaction`, `removeTransaction`, `restoreTransaction`,
  `replaceAll`, dan `clearAll` menolak aksi dengan pesan `PESAN_OFFLINE`.
  Ini disengaja: perubahan yang hanya masuk antrean bisa terlihat
  "berhasil" padahal belum sampai ke server. Tema dan ambang pengeluaran
  tetap boleh diganti karena efeknya lokal saja.
- Kebaruan data ditunjukkan di badge (`Offline · 2 jam lalu`) dan banner di
  bawah appbar ("menampilkan data tersimpan · terakhir sinkron …").
- Begitu koneksi kembali, listener `online` menarik data segar, badge
  kembali `Tersinkron`, dan banner hilang.
- Nama pengguna disimpan di `localStorage` (`dompetku.user`) supaya avatar
  dan tombol akun tetap benar saat offline.
- Request `/api/` tetap tidak pernah di-cache service worker. Data keuangan
  tidak diduplikasi ke Cache Storage; `localStorage` sudah cukup untuk baca.
- `sw.js` hanya menulis shell ke cache dari respons `2xx`, jadi satu kali
  tunnel mati tidak membuat aplikasi tidak bisa dibuka offline sampai rilis
  berikutnya.
- Konsekuensi yang diterima: masuk (login) tetap butuh internet. Selama
  cookie sesi masih ada, halaman login langsung mengarahkan ke beranda
  ketika offline; kalau tidak, muncul catatan bahwa koneksi diperlukan.
- Diuji dengan Chrome DevTools Protocol: aplikasi dibuka dengan
  `Network.emulateNetworkConditions offline`, lalu diperiksa data tetap
  sama dengan saat online, badge/banner muncul, dan penulisan terkunci.

### Cache & proxy di depan

- Shell (`.html`, `.js`, `.css`, `.json`) dikirim `Cache-Control: no-cache` — proxy di depan
  (mis. Cloudflare) harus revalidasi, bukan menyajikan file lama selama berjam-jam.
- `sw.js` dikirim `no-store` supaya proxy tidak pernah menahan versi service worker.
- Hanya gambar (`icons/`) yang memakai cache panjang.
- Cache jangka panjang aplikasi tetap dipegang service worker di browser, jadi file statis
  tidak membanjiri origin.
- Gejala kalau aturan ini dilonggarkan: PWA menampilkan fitur lama tanpa HRT meski sudah
  "muat ulang", karena browser menerima JS usang dari proxy.

### Privasi & keamanan

- Foto hanya hidup di direktori sementara server dan **langsung dihapus** setelah OCR; tidak
  pernah disimpan ke `data/` dan tidak pernah masuk ke git.
- Server memvalidasi magic bytes berkas, membatasi ukuran (default 8 MB), dan menjalankan
  `tesseract` tanpa shell dengan batas waktu.
- Endpoint OCR butuh sesi login yang valid.

### Environment

| Variabel | Default | Guna |
| --- | --- | --- |
| `DOMPETKU_TESSERACT` | cari di `PATH` | Lokasi binary tesseract |
| `DOMPETKU_MAGICK` | cari `magick`/`convert` | Lokasi ImageMagick untuk meluruskan foto miring |
| `DOMPETKU_OCR_LANG` | `ind`, `eng` | Urutan bahasa pilihan; yang tidak terpasang akan dilewati |
| `DOMPETKU_OCR_TIMEOUT` | `45` | Batas detik per proses OCR |
| `DOMPETKU_OCR_MAX_BYTES` | `8388608` | Batas ukuran gambar (8 MB) |

---

## Struktur File

```
dompetku/
├── login.html            # Halaman Masuk
├── index.html            # Halaman Catat
├── laporan.html          # Halaman Laporan
├── css/
│   ├── base.css          # Token desain, komponen dasar (tema, tombol, sheet, toast, akun)
│   ├── auth.css          # Tampilan halaman masuk
│   ├── catat.css         # Hero saldo + tombol aksi
│   ├── receipt.css       # Sheet konfirmasi hasil OCR struk
│   └── laporan.css       # Periode, KPI, grafik, insight, tabel, daftar transaksi
├── js/
│   ├── utils.js          # Format rupiah/tanggal, ikon, helper DOM
│   ├── api.js            # Klien fetch: sesi, error, redirect saat logout
│   ├── store.js          # State server-backed, cache offline, outbox, backup, ekspor
│   ├── analytics.js      # Agregasi, rentang periode, deteksi anomali, insight
│   ├── charts.js         # Wrapper Chart.js yang mengikuti tema
│   ├── quick-form.js     # Form input di modal Catat & sheet Ubah
│   ├── receipt.js        # Pindai struk: ambil foto, kirim OCR, sheet konfirmasi
│   ├── tx-view.js        # Baris transaksi, daftar per hari, sheet ubah, hapus
│   ├── ui.js             # Tema, toast, bottom sheet, Pengaturan, panel akun, prompt install
│   ├── auth.js           # Logika halaman masuk
│   ├── catat.js          # Beranda: saldo + tombol aksi + modal catat
│   └── laporan.js        # Analitik + daftar transaksi lengkap
├── server.py             # Backend stdlib: auth, sesi, API, static, OCR, CLI
├── receipt.py            # Parser struk (nominal, tanggal, item, peringatan) + CLI
├── tests/test_receipt.py # Unit test parser struk
├── tests/test_http.py    # Regresi lapisan HTTP (drain body, error JSON, method asing)
├── tests/test_ocr_image.py # Regresi orientasi foto & pembacaan struk dari gambar
├── tests/test_version.py  # Jaga versi app sinkron antara server, klien, dan SW
├── tests/test_css_layout.py # Regresi layout: safe-area iPhone & truncation laporan
├── tests/test_theme.py    # Regresi tema: toggle langsung, hydrate awal, anti-kedip
├── tests/test_icons.py    # Ikon/favicon wajib sama dengan mark appbar + dimensi PNG
├── deploy/               # Unit systemd + contoh reverse proxy Nginx
├── data/                 # SQLite (dibuat otomatis, tidak ikut rsync)
├── vendor/chart.umd.min.js
├── sw.js
├── manifest.json
└── icons/
    ├── build-icons.sh    # Bangun ulang ikon PWA/favicon dari mark appbar
    ├── icon.svg          # Favicon + ikon "any" (kotak mark appbar)
    ├── icon-maskable.svg # Varian maskable (latar penuh, logo lebih kecil)
    └── *.png             # 32/180/192/512 + varian maskable
```

### Ikon PWA

Ikon aplikasi dan favicon adalah salinan mark appbar (`.appbar__mark` di `css/base.css`):
kotak gradasi `linear-gradient(145deg, var(--primary), var(--income))` — dibekukan ke warna
tema gelap, `#7c8cff → #2fd6a5` — berisi glyph dompet putih (`stroke-width` 2,1, ujung bulat).
Radius kotak 11/34 dari sisi dan glyph 19/34 dari sisi, sama seperti di appbar. Setelah mark
berubah, bangun ulang semua ukuran:

```bash
bash icons/build-icons.sh   # butuh rsvg-convert
```

Varian `maskable` memakai latar gradasi penuh tanpa pembulatan dan glyph diperkecil 0,88×
supaya tetap di zona aman 80% saat Android memotong ikon. `tests/test_icons.py` mengunci
kesamaan warna/stroke/radius dengan mark appbar, keberadaan semua berkas ikon, dan nomor
versi pada `?v=` di `<link rel="icon">` (favicon paling lengket di cache browser).

## Data & Cadangan

Data utama tersimpan di server (`data/dompetku.db`, SQLite WAL) sehingga buya dan ummah melihat
dompet yang sama. Tampilan lokal memakai `localStorage` (kunci `dompetku.v2`) sebagai cache baca,
sehingga aplikasi tetap bisa dibuka tanpa internet. Saat offline penulisan data dikunci; transaksi
yang dibuat sebelum koneksi hilang (atau dari sesi sebelumnya) tetap antre di `dompetku.outbox`
lalu dikirim otomatis saat koneksi kembali. Data versi lama (`dompetku_data`) dipindahkan otomatis
saat pertama masuk.

Cadangan rutin: **Laporan → Ekspor JSON**. Pemulihan tersedia di **Pengaturan → Pulihkan backup**.

## Catatan Teknis

- `todayStr()` memakai waktu lokal (bukan UTC) agar tanggal tidak bergeser di zona waktu WIB.
- Password disimpan dengan `hashlib.scrypt` + salt acak, tidak pernah plaintext.
- Field `dibuat` dan `oleh` selalu diisi server; nilai dari klien diabaikan.
- Seluruh teks dari pengguna aman dari XSS karena dirender lewat `textContent`, bukan `innerHTML`.
- Tata letak `color-mix()` selalu disertai fallback deklarasi warna biasa untuk browser yang belum mendukungnya.
- **Body permintaan selalu dibaca habis sebelum membalas.** Kalau tidak, sisa body menempel ke baris
  permintaan berikutnya pada koneksi keep-alive dan klien menerima halaman error HTML Python
  (`400 Bad request syntax` / `501 Unsupported method`) alih-alih JSON.PENanda body diulang tiap
  permintaan karena satu koneksi melayani banyak permintaan.
- Semua kesalahan dibalas sebagai JSON (termasuk 404/405/501), dan `OPTIONS` dijawab `204` +
  `Allow`. Halaman login/beranda tidak pernah menampilkan halaman error Python.
- Setiap respons `>= 400` dicatat satu baris ke journal (`[dompetku] METODE /path -> status`),
  tanpa perlu `DOMPETKU_VERBOSE`, agar error UI bisa langsung ditelusuri.
- `tests/test_http.py` mengunci semua jaminan di atas; jalankan `python3 -m unittest discover -s tests`.