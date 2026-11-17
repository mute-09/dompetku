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


class TestJarakAntarBlokSeragam(unittest.TestCase):
    """Jarak antar blok utama halaman harus satu nilai (--stack-gap).

    Bug yang dicegah: #kpis di laporan bukan .card, jadi dulu tidak kena
    `.card + .card` dan gap-nya 0 padahal blok lain 14px.
    """

    def test_variabel_stack_gap_didefinisikan(self):
        root = re.search(r":root\s*\{([^}]*)\}", read("css", "base.css")).group(1)
        self.assertRegex(root, r"--stack-gap:\s*[\d.]+\s*(px|rem)",
                         "--stack-gap harus didefinisikan di :root")

    def test_blok_utama_halaman_memakai_stack_gap(self):
        bodies = aturan(read("css", "base.css"), ".page > * + *")
        self.assertTrue(bodies, "aturan `.page > * + *` hilang dari base.css")
        self.assertIn("var(--stack-gap)", bodies[0],
                      "blok utama halaman harus berjarak --stack-gap")

    def test_card_bersebelahan_memakai_stack_gap(self):
        bodies = aturan(read("css", "base.css"), ".card + .card")
        self.assertTrue(bodies, "aturan `.card + .card` hilang")
        for body in bodies:
            self.assertIn("var(--stack-gap)", body)
            self.assertNotRegex(body, r"\d+px",
                                "gap card jangan di-hardcode; pakai --stack-gap")

    def test_blok_bukan_card_ikut_seragam(self):
        for berkas, selector in (("catat.css", ".actions"), ("laporan.css", ".kpis")):
            with self.subTest(berkas=berkas, selector=selector):
                bodies = aturan(read("css", berkas), selector)
                self.assertTrue(bodies, f"{selector} tidak ditemukan di {berkas}")
                self.assertIn("var(--stack-gap)", "\n".join(bodies),
                              f"{selector} di {berkas} harus ikut memakai --stack-gap")


class TestAppbarDuaBaris(unittest.TestCase):
    """Judul + tombol di baris pertama, rentang & saldo di baris kedua.

    Bug yang dicegah: subjudul panjang (mis. "November 2026 · saldo Rp12.500.000")
    berebut ruang dengan tombol kanan, membungkus dua baris, dan melempar avatar
    ke baris baru. Solusinya subjudul pindah ke baris sendiri selebar appbar.
    """

    HALAMAN = ("index.html", "laporan.html", "kalender.html")

    def setUp(self):
        self.css = read("css", "base.css")

    def test_appbar_disusun_grid_dua_baris(self):
        body = "\n".join(aturan(self.css, ".appbar"))
        self.assertIn("display: grid", body, ".appbar harus grid, bukan flex sebaris")
        self.assertIn("brand actions", body, "baris pertama: judul + tombol")
        self.assertIn("sub sub", body, "baris kedua: subjudul membentang penuh")

    def test_subjudul_punya_area_sendiri_dan_tidak_membungkus(self):
        body = "\n".join(aturan(self.css, ".appbar__sub"))
        for deklarasi in ("grid-area: sub", "white-space: nowrap",
                          "overflow: hidden", "text-overflow: ellipsis"):
            self.assertIn(deklarasi, body,
                          f".appbar__sub butuh '{deklarasi}' agar tetap satu baris "
                          "dan terpotong rapi, bukan menabrak tombol")

    def test_tombol_tidak_pernah_membungkus_atau_mengempis(self):
        body = "\n".join(aturan(self.css, ".appbar__actions"))
        self.assertIn("grid-area: actions", body)
        self.assertIn("flex-wrap: nowrap", body,
                      "tombol kanan tidak boleh dilipat ke baris kedua")
        anak = "\n".join(aturan(self.css, ".appbar__actions > *"))
        self.assertIn("flex: 0 0 auto", anak, "ikon jangan mengecil saat ruang menipis")

    def test_judul_tetap_bisa_di_ellipsis(self):
        body = "\n".join(aturan(self.css, ".appbar__title"))
        self.assertIn("min-width: 0", body,
                      "tanpa min-width 0, ellipsis judul tidak pernah aktif")

    def test_judul_setinggi_kotak_mark(self):
        mark = "\n".join(aturan(self.css, ".appbar__mark"))
        judul = "\n".join(aturan(self.css, ".appbar__title"))
        self.assertIn("height: 34px", mark)
        self.assertIn("line-height: 34px", judul,
                      "judul harus setinggi kotak mark (34px) agar rata sebagai satu blok")

    def test_subjudul_mulai_dari_tepi_kiri_mark(self):
        body = "\n".join(aturan(self.css, ".appbar__sub"))
        self.assertNotIn("padding-left", body,
                         "subjudul tidak boleh menjorok; mulai dari tepi kiri kotak mark")
        self.assertIn("margin-top", body,
                      "subjudul butuh jarak atas tipis dari baris tombol")

    def test_subjudul_di_html_berada_setelah_baris_tombol(self):
        for nama in self.HALAMAN:
            html = read(nama)
            with self.subTest(halaman=nama):
                self.assertLess(
                    html.index('class="appbar__actions"'),
                    html.index('id="appbarSub"'),
                    f"{nama}: subjudul harus jadi saudara .appbar__actions "
                    "(baris sendiri), bukan di dalam .appbar__brand",
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)