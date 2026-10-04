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
- **Pindai struk (OCR)**: tombol kamera/foto (atau tempel dari clipboard) membaca struk belanja di
  server, lalu membuka sheet konfirmasi sebelum menyimpan apa pun.

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
│   ├── catat.css         # Hero saldo, form input, daftar aktivitas
│   ├── receipt.css       # Sheet konfirmasi hasil OCR struk
│   └── laporan.css       # Periode, KPI, grafik, insight, tabel
├── js/
│   ├── utils.js          # Format rupiah/tanggal, ikon, helper DOM
│   ├── api.js            # Klien fetch: sesi, error, redirect saat logout
│   ├── store.js          # State server-backed, cache offline, outbox, backup, ekspor
│   ├── analytics.js      # Agregasi, rentang periode, deteksi anomali, insight
│   ├── charts.js         # Wrapper Chart.js yang mengikuti tema
│   ├── quick-form.js     # Form input yang dipakai di halaman Catat & sheet Ubah
│   ├── receipt.js        # Pindai struk: ambil foto, kirim OCR, sheet konfirmasi
│   ├── ui.js             # Tema, toast, bottom sheet, Pengaturan, panel akun, prompt install
│   ├── auth.js           # Logika halaman masuk
│   ├── catat.js          # Logika halaman Catat
│   └── laporan.js        # Logika halaman Laporan
├── server.py             # Backend stdlib: auth, sesi, API, static, OCR, CLI
├── receipt.py            # Parser struk (nominal, tanggal, item, peringatan) + CLI
├── tests/test_receipt.py # Unit test parser struk
├── deploy/               # Unit systemd + contoh reverse proxy Nginx
├── data/                 # SQLite (dibuat otomatis, tidak ikut rsync)
├── vendor/chart.umd.min.js
├── sw.js
├── manifest.json
└── icons/
    ├── build-icons.sh    # Bangun ulang semua ikon PWA/favicon dari logo appbar
    ├── icon.svg          # Favicon + ikon "any" (sudut bulat)
    ├── icon-maskable.svg # Varian maskable (latar penuh, logo lebih kecil)
    └── *.png             # 32/180/192/512 + varian maskable
```

### Ikon PWA

Semua ikon memakai geometri logo appbar dengan gaya stroke yang sama seperti ikon di
dalam aplikasi (`stroke-width` 2,2, ujung bulat, tanpa isian). Setelah logo di
`index.html` berubah, bangun ulang semua ukuran:

```bash
bash icons/build-icons.sh   # butuh rsvg-convert
```

Varian `maskable` memakai latar penuh tanpa pembulatan dan logo berada di zona aman 80%
supaya tidak terpotong saat Android memotong ikon.

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