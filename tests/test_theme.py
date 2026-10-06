"""Regresi tema gelap/terang.

Tiga bug yang pernah terjadi dan dicegah di sini:
1. Toggle hanya mengganti ikon tanpa applyTheme() -> harus refresh manual.
2. settings baru dibaca di init(), padahal initTheme() dipanggil lebih awal
   -> tema lama/salah saat pindah halaman.
3. Halaman login tidak pernah memakai tema tersimpan.
"""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HALAMAN = ("index.html", "laporan.html", "login.html")


def read(*parts: str) -> str:
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def blok(teks: str, awal: str, panjang_maks: int = 900) -> str:
    i = teks.find(awal)
    if i < 0:
        return ""
    return teks[i:i + panjang_maks]


class TestToggleTemaLangsung(unittest.TestCase):
    def test_klik_toggle_memanggil_apply_theme(self):
        ui = read("js", "ui.js")
        isi = blok(ui, "export function setupThemeToggle")
        self.assertTrue(isi, "setupThemeToggle tidak ditemukan di ui.js")
        self.assertIn("applyTheme(next)", isi,
                      "Toggle tema harus applyTheme() langsung, bukan menunggu refresh")

    def test_panel_pengaturan_juga_konsisten(self):
        ui = read("js", "ui.js")
        self.assertIn("applyTheme(themeSelect.value)", ui)


class TestSettingsHydrateAwal(unittest.TestCase):
    def test_settings_dibaca_sebelum_init(self):
        store = read("js", "store.js")
        posisi_hydrate = store.find("loadCache()?.settings")
        self.assertGreater(posisi_hydrate, 0, "store.js tidak hydrate settings di module scope")
        posisi_init = store.find("export async function init()")
        self.assertGreater(posisi_init, 0)
        self.assertLess(posisi_hydrate, posisi_init,
                        "settings harus dibaca saat modul dimuat, bukan di dalam init()")


class TestHalamanLoginIkutTema(unittest.TestCase):
    def test_auth_js_memanggil_init_theme(self):
        auth = read("js", "auth.js")
        self.assertIn("import { initTheme }", auth, "auth.js harus import initTheme")
        self.assertRegex(auth, r"\ninitTheme\(\);",
                         "initTheme() harus dipanggil di module scope auth.js")


class TestAntiFlash(unittest.TestCase):
    def test_setiap_halaman_punya_skrip_anti_kedip(self):
        for name in HALAMAN:
            with self.subTest(halaman=name):
                html = read(name)
                self.assertIn("anti-kedip", html, f"{name} tanpa skrip anti-flash tema")
                self.assertIn("dompetku.v2", html, f"{name} harus membaca kunci cache store")
                self.assertIn("dataset.theme", html)

    def test_warna_theme_color_sama_dengan_ui(self):
        ui = read("js", "ui.js")
        for warna in ("#f6f7fb", "#0b0d14"):
            self.assertIn(warna, ui, f"applyTheme tidak memakai {warna}")
            for name in HALAMAN:
                with self.subTest(halaman=name, warna=warna):
                    self.assertIn(warna, read(name),
                                  f"{name} harus sinkron dengan warna {warna} di ui.js")


if __name__ == "__main__":
    unittest.main(verbosity=2)