#!/usr/bin/env bash
# Bangun ulang seluruh aset ikon PWA dari satu sumber geometri.
#
# Ikon memakai gaya yang sama dengan ikon di dalam aplikasi (stroke bulat,
# tanpa isian, grid 24x24) dengan geometri logo appbar di index.html.
#
# Jalankan ulang setiap kali logo appbar berubah:
#   bash icons/build-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."
out="icons"
command -v rsvg-convert >/dev/null || { echo "rsvg-convert belum terpasang" >&2; exit 1; }

# --- geometri logo (grid 24, stroke 2.2, linecap/linejoin bulat) ---
cat > "$out/icon.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="192" height="192" role="img" aria-label="DompetKu">
  <rect x="0.25" y="0.25" width="23.5" height="23.5" rx="5.25" fill="#0f121b"/>
  <rect x="0.25" y="0.25" width="23.5" height="23.5" rx="5.25" fill="none" stroke="#ffffff" stroke-opacity="0.09"/>
  <g transform="translate(-0.25 0)" fill="none" stroke="#7c8cff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V16"/>
    <path d="M20.5 9.5h-4a2.5 2.5 0 0 0 0 5h4z"/>
  </g>
</svg>
SVG

# Varian maskable: latar penuh tanpa pembulatan, logo lebih kecil agar
# aman saat Android memotong ikon jadi lingkaran/lingkaran bersudut.
cat > "$out/icon-maskable.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512" role="img" aria-label="DompetKu">
  <rect width="24" height="24" fill="#0f121b"/>
  <g transform="translate(12 12) scale(0.88) translate(-12.25 -12)" fill="none" stroke="#7c8cff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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