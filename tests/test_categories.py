"""Kategori pengeluaran di klien dan server harus sinkron.

Daftar kategori hidup di dua tempat: `js/store.js` (dropdown, ikon, warna)
dan `server.py` (validasi payload). Kalau salah satu ketinggalan, transaksi
dengan kategori baru akan ditolak server atau tidak muncul di UI.
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


def kategori_klien() -> list[dict]:
    blok = re.search(r"export const CATEGORIES = \[(.*?)\];", read("js/store.js"), re.S)
    assert blok, "CATEGORIES tidak ditemukan di js/store.js"
    return [
        {"id": i, "label": l, "icon": ic, "color": c}
        for i, l, ic, c in re.findall(
            r"\{ id: '([^']+)', label: '([^']+)', icon: '([^']+)', color: '(#[0-9a-fA-F]{6})' \}",
            blok.group(1),
        )
    ]


def kategori_server() -> set[str]:
    blok = re.search(r"^CATEGORIES = \{(.*?)\}", read("server.py"), re.S | re.M)
    assert blok, "CATEGORIES tidak ditemukan di server.py"
    return set(re.findall(r'"([^"]+)"', blok.group(1)))


class TestKategoriSinkron(unittest.TestCase):
    def test_id_klien_dan_server_sama(self):
        klien = kategori_klien()
        self.assertEqual(
            {k["id"] for k in klien},
            kategori_server(),
            "Daftar kategori di js/store.js dan server.py harus sama persis",
        )

    def test_setiap_kategori_punya_ikon_dan_warna(self):
        for k in kategori_klien():
            with self.subTest(kategori=k["id"]):
                self.assertTrue(k["icon"])
                self.assertRegex(k["color"], r"^#[0-9a-fA-F]{6}$")

    def test_ada_kategori_kebutuhan_anak(self):
        ids = {k["id"] for k in kategori_klien()}
        self.assertIn("Kebutuhan Anak", ids)
        self.assertIn("Kebutuhan Anak", kategori_server())


if __name__ == "__main__":
    unittest.main(verbosity=2)