"""Jaga ikon PWA/favicon tetap persis mengikuti mark appbar (.appbar__mark).

Sumber tunggalnya ada di `css/base.css`: kotak gradasi
`linear-gradient(145deg, var(--primary), var(--income))` berisi glyph dompet
putih. `icons/build-icons.sh` menyalin geometri itu ke SVG ikon, dan tes ini
gagal begitu mark diubah tanpa ikut membangun ulang ikon.
"""

import json
import math
import os
import re
import struct
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HALAMAN = ("index.html", "laporan.html", "login.html")
# Mark appbar: kotak 34px, radius 11px, glyph memakai 19px dari grid 24.
SISI_MARK, RADIUS_MARK, GLYPH_MARK = 34.0, 11.0, 19.0


def read(*parts: str) -> str:
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def blok_css(css: str, selector: str) -> str:
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return m.group(1) if m else ""


def warna_var(root_css: str, nama: str) -> str | None:
    m = re.search(re.escape(nama) + r"\s*:\s*(#[0-9a-fA-F]{6})", root_css)
    return m.group(1).lower() if m else None


def stops_gradien(svg: str) -> list[str]:
    return [w.lower() for w in re.findall(r'stop-color="(#[0-9a-fA-F]{6})"', svg)]


def path_glyph(teks: str) -> list[str]:
    return re.findall(r'<path d="([^"]+)"', teks)


def dimensi_png(berkas: str) -> tuple[int, int]:
    with open(os.path.join(ROOT, berkas), "rb") as fh:
        data = fh.read(26)
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"{berkas} bukan PNG")
    return struct.unpack(">II", data[16:24])


class TestIkonIkutMarkAppbar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = read("css", "base.css")
        cls.mark = blok_css(cls.css, ".appbar__mark")
        cls.root = blok_css(cls.css, ":root")
        cls.ikon = read("icons", "icon.svg")
        cls.maskable = read("icons", "icon-maskable.svg")

    def test_mark_memakai_gradien_145deg_primary_ke_income(self):
        self.assertIn("linear-gradient(145deg, var(--primary), var(--income))", self.mark)

    def test_warna_ikon_sama_dengan_variabel_mark(self):
        primary = warna_var(self.root, "--primary")
        income = warna_var(self.root, "--income")
        self.assertIsNotNone(primary, "--primary tidak ditemukan di :root")
        self.assertEqual(stops_gradien(self.ikon), [primary, income],
                         "stop gradien icon.svg harus sama dengan --primary -> --income")
        self.assertEqual(stops_gradien(self.maskable), [primary, income])

    def test_gradien_berarah_sama_145derajat(self):
        m = re.search(r'<linearGradient[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="([^"]+)"[^>]*y2="([^"]+)"', self.ikon)
        self.assertIsNotNone(m, "linearGradient tanpa koordinat di icon.svg")
        x1, y1, x2, y2 = (float(v.rstrip("%")) for v in m.groups())
        # CSS 145deg (0deg = ke atas, searah jarum jam) pada kotak persegi:
        # arah unit d = (sin145, -cos145), panjang garis = |dx| + |dy|.
        rad = math.radians(145)
        dx, dy = math.sin(rad), -math.cos(rad)
        setengah = 50 * (abs(dx) + abs(dy))
        self.assertAlmostEqual(x1, 50 - setengah * dx, delta=0.5)
        self.assertAlmostEqual(y1, 50 - setengah * dy, delta=0.5)
        self.assertAlmostEqual(x2, 50 + setengah * dx, delta=0.5)
        self.assertAlmostEqual(y2, 50 + setengah * dy, delta=0.5)

    def test_glyph_putih_stroke_sama_dengan_mark(self):
        self.assertIn("stroke=\"#fff\"", self.ikon)
        self.assertIn("stroke-width=\"2.1\"", self.ikon)
        self.assertIn("color: #fff", self.mark)

    def test_radius_kotak_mengikuti_mark(self):
        rx = float(re.search(r'rx="([\d.]+)"', self.ikon).group(1))
        self.assertAlmostEqual(rx, 24 * RADIUS_MARK / SISI_MARK, delta=0.02)

    def test_ukuran_glyph_19_dari_34(self):
        m = re.search(r"scale\(([\d.]+)\)", self.ikon)
        self.assertIsNotNone(m, "scale glyph tidak ditemukan")
        self.assertAlmostEqual(float(m.group(1)), GLYPH_MARK / SISI_MARK, delta=0.001)

    def test_glyph_ikon_identik_dengan_appbar(self):
        mark_html = re.search(r'class="appbar__mark".*?</span>', read("index.html"), re.S).group(0)
        self.assertEqual(path_glyph(mark_html), path_glyph(self.ikon),
                         "path glyph ikon harus sama persis dengan mark appbar")
        self.assertEqual(path_glyph(self.maskable), path_glyph(self.ikon))

    def test_maskable_gradasi_penuh_dan_glyph_lebih_kecil(self):
        rect = re.search(r"<rect[^>]*>", self.maskable).group(0)
        self.assertNotIn("rx=", rect, "latar maskable harus penuh agar Android bebas memotong")
        gagang = float(re.search(r"scale\(([\d.]+)\)", self.maskable).group(1))
        induk = float(re.search(r"scale\(([\d.]+)\)", self.ikon).group(1))
        self.assertLess(gagang, induk, "glyph maskable harus lebih kecil (safe zone 80%)")


class TestBerkasIkon(unittest.TestCase):
    def test_png_dibuat_dengan_ukuran_benar(self):
        harap = {
            "icons/favicon-32.png": (32, 32),
            "icons/icon-192.png": (192, 192),
            "icons/icon-512.png": (512, 512),
            "icons/apple-touch-icon.png": (180, 180),
            "icons/icon-maskable-192.png": (192, 192),
            "icons/icon-maskable-512.png": (512, 512),
        }
        for berkas, ukuran in harap.items():
            with self.subTest(berkas=berkas):
                self.assertTrue(os.path.exists(os.path.join(ROOT, berkas)), f"{berkas} hilang")
                self.assertEqual(dimensi_png(berkas), ukuran)

    def test_manifest_menunjuk_berkas_yang_ada(self):
        manifest = json.loads(read("manifest.json"))
        tujuan = {i.get("purpose") for i in manifest["icons"]}
        self.assertIn("any", tujuan)
        self.assertIn("maskable", tujuan)
        for ikon in manifest["icons"]:
            berkas = ikon["src"].lstrip("./")
            with self.subTest(src=berkas):
                self.assertTrue(os.path.exists(os.path.join(ROOT, berkas)), f"{berkas} tidak ada")

    def test_service_worker_memuat_semua_ikon(self):
        sw = read("sw.js")
        manifest = json.loads(read("manifest.json"))
        for ikon in manifest["icons"]:
            self.assertIn("./" + ikon["src"].lstrip("./"), sw,
                          f"{ikon['src']} tidak ada di APP_SHELL")

    def test_halaman_memakai_ikon_dengan_cache_bust_versi_app(self):
        versi = re.search(r"export const APP_VERSION = '([^']+)'", read("js", "utils.js")).group(1)
        for nama in HALAMAN:
            html = read(nama)
            with self.subTest(halaman=nama):
                self.assertIn(f'href="icons/icon.svg?v={versi}"', html,
                              f"{nama}: favicon harus memakai ?v={versi}")
                self.assertIn(f'href="icons/apple-touch-icon.png?v={versi}"', html)


if __name__ == "__main__":
    unittest.main(verbosity=2)