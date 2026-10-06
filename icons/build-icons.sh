#!/usr/bin/env bash
# Bangun ulang seluruh aset ikon PWA dari satu sumber geometri.
#
# Ikon mengikuti mark appbar (.appbar__mark di css/base.css): kotak gradasi
# linear-gradient(145deg, var(--primary), var(--income)) berisi glyph dompet
# putih (stroke bulat, grid 24, lebar 2.1) seukuran 19/34 dari sisi kotak.
# Warna dibekukan ke tema gelap (default aplikasi): #7c8cff -> #2fd6a5.
#
# Jalankan ulang setiap kali mark appbar berubah:
#   bash icons/build-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."
out="icons"
command -v rsvg-convert >/dev/null || { echo "rsvg-convert belum terpasang" >&2; exit 1; }

# --- mark appbar: radius 11/34, glyph 19/34 dari sisi, stroke 2.1 ---
# 145deg pada kotak 24x24 -> ujung gradasi (10.06%,-7.04%) .. (89.94%,107.04%).
cat > "$out/icon.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512" role="img" aria-label="DompetKu">
  <defs>
    <linearGradient id="mark" x1="10.06%" y1="-7.04%" x2="89.94%" y2="107.04%">
      <stop offset="0" stop-color="#7c8cff"/>
      <stop offset="1" stop-color="#2fd6a5"/>
    </linearGradient>
  </defs>
  <rect width="24" height="24" rx="7.76" fill="url(#mark)"/>
  <g transform="translate(12 12) scale(0.559) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V16"/>
    <path d="M20.5 9.5h-4a2.5 2.5 0 0 0 0 5h4z"/>
  </g>
</svg>
SVG

# Varian maskable: latar gradasi penuh tanpa pembulatan karena Android memotong
# sendiri jadi lingkaran/lingkaran bersudut; glyph diperkecil 0,88x agar tetap
# di dalam safe zone 80% saat ikon dipotong.
cat > "$out/icon-maskable.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512" role="img" aria-label="DompetKu">
  <defs>
    <linearGradient id="mark" x1="10.06%" y1="-7.04%" x2="89.94%" y2="107.04%">
      <stop offset="0" stop-color="#7c8cff"/>
      <stop offset="1" stop-color="#2fd6a5"/>
    </linearGradient>
  </defs>
  <rect width="24" height="24" fill="url(#mark)"/>
  <g transform="translate(12 12) scale(0.492) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V16"/>
    <path d="M20.5 9.5h-4a2.5 2.5 0 0 0 0 5h4z"/>
  </g>
</svg>
SVG

rsvg-convert -w 32   -h 32   "$out/icon.svg"            -o "$out/favicon-32.png"
rsvg-convert -w 192  -h 192  "$out/icon.svg"            -o "$out/icon-192.png"
rsvg-convert -w 512  -h 512  "$out/icon.svg"            -o "$out/icon-512.png"
rsvg-convert -w 180  -h 180  "$out/icon-maskable.svg"   -o "$out/apple-touch-icon.png"
rsvg-convert -w 192  -h 192  "$out/icon-maskable.svg"   -o "$out/icon-maskable-192.png"
rsvg-convert -w 512  -h 512  "$out/icon-maskable.svg"   -o "$out/icon-maskable-512.png"

echo "== ikon rebuilt =="
for file in "$out"/favicon-32.png "$out"/icon-192.png "$out"/icon-512.png \
            "$out"/apple-touch-icon.png "$out"/icon-maskable-192.png "$out"/icon-maskable-512.png; do
  printf '%s  %s\n' "$(identify -format '%wx%h' "$file")" "$file"
done