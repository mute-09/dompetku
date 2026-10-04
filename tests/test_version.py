"""Jaga agar versi app di server dan di shell PWA selalu sama.

Kalau berbeda, pengguna PWA tidak pernah melihat rilis baru karena
service worker menyajikan shell lama dari cache. Test ini yang mencegah
k lupa menaikkan kedua angka.
"""

import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def read(name: str) -> str:
    with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
        return fh.read()


class TestVersiApp(unittest.TestCase):
    def test_server_dan_klien_sama(self):
        server = re.search(r'APP_VERSION = os\.environ\.get\("DOMPETKU_VERSION", "([^"]+)"\)', read("server.py"))
        klien = re.search(r"export const APP_VERSION = '([^']+)'", read("js/utils.js"))
        self.assertIsNotNone(server, "APP_VERSION tidak ditemukan di server.py")
        self.assertIsNotNone(klien, "APP_VERSION tidak ditemukan di js/utils.js")
        self.assertEqual(server.group(1), klien.group(1), "Naikkan APP_VERSION di server.py dan js/utils.js")

    def test_cache_service_worker_sama(self):
        sw = re.search(r"const CACHE_NAME = 'dompetku-([^']+)'", read("sw.js"))
        klien = re.search(r"export const APP_VERSION = '([^']+)'", read("js/utils.js"))
        self.assertIsNotNone(sw)
        self.assertEqual(sw.group(1), klien.group(1), "Naikkan CACHE_NAME di sw.js agar PWA dapat shell baru")

    def test_health_lapor_versi(self):
        import server

        self.assertTrue(server.APP_VERSION)


if __name__ == "__main__":
    unittest.main(verbosity=2)