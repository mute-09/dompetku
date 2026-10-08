"""Regresi mode baca-saja offline.

Bug yang dicegah: aplikasi dulu berhenti total saat dibuka tanpa internet.
`init()` menunggu `api.session()`; offline fungsi itu melempar error sehingga
`ready` tak pernah `true`, listener sinkron tak pernah dipasang, dan badge
macet di "Memuat…" — data sebenarnya sudah ada di `localStorage`.

Uji ini bersifat statis (seperti test lain di repo). Verifikasi sailednya
dilakukan terpisah lewat Chrome DevTools Protocol: buka aplikasi saat
`Network.emulateNetworkConditions offline`, lalu periksa data tetap tampil,
badge + banner muncul, dan penulisan terkunci.
"""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts: str) -> str:
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def blok_fungsi(kode: str, nama: str, panjang: int = 4000) -> str:
    """Badan satu fungsi, dipotong di fungsi top-level berikutnya."""
    m = re.search(rf"(?:export\s+)?(?:async\s+)?function {nama}\s*\(", kode)
    if not m:
        return ""
    badan = kode[m.start():m.start() + panjang]
    akhir = re.search(r"\n(?:export\s+)?(?:async\s+)?function \w+", badan[1:])
    return badan[:akhir.start() + 1] if akhir else badan


class TestInitTahanOffline(unittest.TestCase):
    def setUp(self):
        self.store = read("js", "store.js")

    def test_boot_tidak_bergantung_pada_api_session(self):
        init = blok_fungsi(self.store, "init")
        self.assertIn("err.isOffline", init,
                      "cabang offline wajib ada supaya init() tidak melempar")
        self.assertIn("status: 'offline'", init)
        self.assertIn("offline: true", init,
                      "init() harus melaporkan mode offline ke pemanggil")

    def test_data_lokal_diadopsi_sebelum_jaringan_dipakai(self):
        init = blok_fungsi(self.store, "init")
        self.assertLess(init.index("loadCache()"), init.index("api.session()"),
                        "cache lokal harus diadopsi sebelum memanggil server")

    def test_listener_sinkron_selalu_dipasang(self):
        init = blok_fungsi(self.store, "init")
        self.assertIn("pasangSiklusHidup()", init,
                      "listener online/offline harus dipasang walau boot gagal")
        self.assertLess(init.index("pasangSiklusHidup()"), init.index("api.session()"))

    def test_waktu_sinkron_tersimpan_lokal(self):
        """Tanpa ini, badge offline tidak bisa menampilkan 'terakhir sinkron'."""
        self.assertIn("dompetku.sync", self.store)
        self.assertIn("META_KEY", self.store)

    def test_nama_pengguna_disimpan_untuk_avatar_offline(self):
        self.assertIn("dompetku.user", self.store)


class TestKunciTulisSaatOffline(unittest.TestCase):
    """Perubahan data butuh server; offline aplikasi jadi baca-saja."""

    TERKUNCI = ("addTransaction", "updateTransaction", "removeTransaction",
                "clearAll", "replaceAll", "restoreTransaction")

    def setUp(self):
        self.store = read("js", "store.js")

    def test_setiap_tulis_dikunci(self):
        for nama in self.TERKUNCI:
            with self.subTest(fungsi=nama):
                badan = blok_fungsi(self.store, nama, 600)
                self.assertIn("isReadOnly()", badan,
                              f"{nama}() harus menolak saat offline")

    def test_pesan_offline_ada_dan_diekspor(self):
        m = re.search(r"export const PESAN_OFFLINE = '([^']+)'", self.store)
        self.assertIsNotNone(m, "PESAN_OFFLINE harus diekspor untuk dipakai UI")
        self.assertIn("Offline", m.group(1))

    def test_pengaturan_tetap_boleh_offline(self):
        """Tema/ambang hanya efek lokal; menguncinya akan merusak app offline."""
        badan = blok_fungsi(self.store, "setSettings", 600)
        self.assertNotIn("isReadOnly()", badan)

    def test_ui_menampilkan_pesan_kunci(self):
        for nama in ("catat.js", "tx-view.js", "ui.js"):
            with self.subTest(berkas=nama):
                self.assertIn("PESAN_OFFLINE", read("js", nama),
                              f"{nama} harus memberi tahu pengguna kenapa aksi ditolak")


class TestIndikatorDataBasi(unittest.TestCase):
    def setUp(self):
        self.ui = read("js", "ui.js")

    def test_badge_menampilkan_kapan_terakhir_sinkron(self):
        self.assertIn("function sejakLabel", self.ui)
        self.assertIn("status.lastSync", self.ui,
                      "badge harus memakai waktu sinkron terakhir saat offline")

    def test_banner_offline_dibuat_dan_diisi(self):
        self.assertIn("offlineBanner", self.ui)
        self.assertIn("terakhir sinkron", self.ui)
        m = re.search(r"insertBefore\(banner, appbar\.nextSibling\)", self.ui)
        self.assertIsNotNone(m, "banner diletakkan setelah appbar, bukan fixed di atas navigasi")

    def test_ada_gaya_banner_yang_disembunyikan(self):
        css = read("css", "base.css")
        self.assertIn(".offline-banner", css)
        self.assertRegex(css, r"\.offline-banner\[hidden\]\s*\{\s*display:\s*none")


class TestServiceWorkerOffline(unittest.TestCase):
    def setUp(self):
        self.sw = read("sw.js")

    def test_navigasi_hanya_tersimpan_untuk_respons_sah(self):
        navigate = self.sw[self.sw.index("request.mode === 'navigate'"):]
        simpan = navigate[:navigate.index('.catch(async () =>')]
        self.assertIn("response.ok", simpan,
                      "halaman error 5xx/1033 tidak boleh menimpa shell tersimpan")

    def test_is_shell_mencocokkan_pathname(self):
        badan = re.search(r"function isShell\(url\) \{(.*?)\n\}", self.sw, re.S)
        self.assertIsNotNone(badan, "isShell tidak ditemukan")
        self.assertIn("url.pathname", badan.group(1),
                      "cocokkan pathname penuh supaya query ?v= tetap mengenai cache")

    def test_api_tetap_tidak_di_cache(self):
        """Data keuangan tidak boleh ada di Cache Storage; andalkan localStorage."""
        self.assertIn("if (isApi(url)) return;", self.sw)


if __name__ == "__main__":
    unittest.main(verbosity=2)