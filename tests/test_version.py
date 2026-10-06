"""Jaga agar versi app di server dan di shell PWA selalu sama.

Kalau berbeda, pengguna PWA tidak pernah melihat rilis baru karena
service worker menyajikan shell lama dari cache. Test ini yang mencegah
lupa menaikkan ketiganya, sekaligus memaksa skema versi MAJOR.MINOR.
"""

import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SKEMA = r"^\d+\.\d+$"


def read(name: str) -> str:
    with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
        return fh.read()


def versi_server() -> str | None:
    m = re.search(r'APP_VERSION = os\.environ\.get\("DOMPETKU_VERSION", "([^"]+)"\)', read("server.py"))
    return m.group(1) if m else None


def versi_klien() -> str | None:
    m = re.search(r"export const APP_VERSION = '([^']+)'", read("js/utils.js"))
    return m.group(1) if m else None


def versi_sw() -> str | None:
    m = re.search(r"const CACHE_NAME = 'dompetku-([^']+)'", read("sw.js"))
    return m.group(1) if m else None


class TestVersiApp(unittest.TestCase):
    def test_server_dan_klien_sama(self):
        self.assertIsNotNone(versi_server(), "APP_VERSION tidak ditemukan di server.py")
        self.assertIsNotNone(versi_klien(), "APP_VERSION tidak ditemukan di js/utils.js")
        self.assertEqual(versi_server(), versi_klien(),
                         "Naikkan APP_VERSION di server.py dan js/utils.js")

    def test_cache_service_worker_sama(self):
        self.assertIsNotNone(versi_sw(), "CACHE_NAME tidak ditemukan di sw.js")
        self.assertEqual(versi_sw(), versi_klien(),
                         "Naikkan CACHE_NAME di sw.js agar PWA dapat shell baru")

    def test_skema_versi_major_minor(self):
        """Skema MAJOR.MINOR (mis. 1.9), bukan satu angka yang cepat membengkak."""
        for label, value in (("server.py", versi_server()),
                             ("js/utils.js", versi_klien()),
                             ("sw.js", versi_sw())):
            with self.subTest(file=label):
                self.assertRegex(value or "", SKEMA,
                                 f"Versi di {label} harus berformat MAJOR.MINOR, contoh: 1.9")

    def test_health_lapor_versi(self):
        import server

        self.assertRegex(server.APP_VERSION, SKEMA)


if __name__ == "__main__":
    unittest.main(verbosity=2)