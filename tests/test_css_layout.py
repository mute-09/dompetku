"""Regresi layout CSS: safe area iPhone dan truncation daftar pengeluaran.

Keduanya bug yang terlihat hanya di HP (notch iPhone, teks panjang), jadi
ditangkap lewat pemeriksaan statis terhadap aturan CSS.
"""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts: str) -> str:
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def aturan(css: str, selector: str) -> list[str]:
    """Semua badan aturan untuk selector persis (tanpa mengenai modifier)."""
    return re.findall(re.escape(selector) + r"\s*\{([^}]*)\}", css)


class TestSafeAreaAtas(unittest.TestCase):
    def test_root_definisikan_safe_top_dari_env(self):
        base = read("css", "base.css")
        m = re.search(r":root\s*\{([^}]*)\}", base)
        self.assertIsNotNone(m, ":root tidak ditemukan di base.css")
        self.assertIn("--safe-top: env(safe-area-inset-top)", m.group(1),
                      "safe area atas harus berasal dari env(), bukan nilai tetap")

    def test_appbar_menurunkan_konten_melewati_status_bar(self):
        base = read("css", "base.css")
        kandidat = [b for b in aturan(base, ".appbar") if "padding" in b]
        self.assertTrue(kandidat, ".appbar tidak punya aturan padding")
        for body in kandidat:
            self.assertIn("var(--safe-top)", body,
                          ".appbar harus memakai --safe-top agar konten tidak "
                          "tersembunyi di balik status bar iPhone")

    def test_halaman_login_juga_aman(self):
        auth = read("css", "auth.css")
        body = "\n".join(aturan(auth, ".auth"))
        self.assertIn("var(--safe-top", body, ".auth harus menghormati safe area atas")


class TestTruncationPengeluaran(unittest.TestCase):
    """text-overflow hanya bekerja pada elemen non-inline."""

    SELECTOR = (".rank__name", ".rank__meta", ".rank__bar",
                ".legend__name", ".legend__bar")

    def test_semua_elemen_teks_memakai_display_block(self):
        css = read("css", "laporan.css")
        for selector in self.SELECTOR:
            with self.subTest(selector=selector):
                bodies = aturan(css, selector)
                self.assertTrue(bodies, f"{selector} tidak ditemukan di laporan.css")
                self.assertTrue(
                    any("display: block" in b for b in bodies),
                    f"{selector} harus display:block supaya ellipsis/truncation bekerja "
                    "dan tidak tumpah ke batas kartu",
                )

    def test_bar_punya_tinggi_jelas(self):
        css = read("css", "laporan.css")
        self.assertIn("height: 5px", "\n".join(aturan(css, ".rank__bar")))


if __name__ == "__main__":
    unittest.main(verbosity=2)