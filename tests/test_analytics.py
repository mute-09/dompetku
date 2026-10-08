"""Regresi insight pada halaman laporan.

Bug yang dicegah: kartu "Transaksi terbesar" menampilkan "NaN undefined NaN"
karena kode insight memakai `top.date`, padahal objek transaksi memakai field
`tanggal` (lihat slice/dailyAverage/topExpenses di analytics.js). formatDate()
atas nilai undefined menghasilkan "NaN undefined NaN".
"""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts: str) -> str:
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class TestInsightTransaksiTerbesar(unittest.TestCase):
    def setUp(self):
        self.kode = read("js", "analytics.js")

    def blok_insight(self) -> str:
        i = self.kode.find("Transaksi terbesar:")
        self.assertGreaterEqual(i, 0, "insight 'Transaksi terbesar' tidak ditemukan")
        return self.kode[i:i + 400]

    def test_pakai_field_tanggal_bukan_date(self):
        blok = self.blok_insight()
        self.assertIn("top.tanggal", blok,
                      "objek transaksi memakai field `tanggal`, bukan `date`")
        self.assertNotIn("top.date", blok,
                         "`top.date` undefined -> formatDate menghasilkan 'NaN undefined NaN'")

    def test_tidak_ada_tanggal_transaksi_dari_field_date(self):
        """Lapisan pengaman: tanggal transaksi selalu dari `tanggal`."""
        pola = r"(?:formatDate|formatDateShort)\((?:top|worst|best|leader|tx|item)\.date\b"
        self.assertIsNone(re.search(pola, self.kode),
                          "tanggal transaksi harus dibaca dari field `tanggal`")


if __name__ == "__main__":
    unittest.main(verbosity=2)
