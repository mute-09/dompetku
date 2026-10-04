"""Unit test parser struk: python3 -m unittest discover -s tests -v"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from receipt import parse_amount, parse_receipt  # noqa: E402


class TestParseAmount(unittest.TestCase):
    def test_gaya_indonesia(self):
        self.assertEqual(parse_amount("Rp 1.250.000"), 1250000)
        self.assertEqual(parse_amount("45.000"), 45000)
        self.assertEqual(parse_amount("9000"), 9000)
        self.assertEqual(parse_amount("12,500"), 12500)

    def test_koma_desimal(self):
        self.assertEqual(parse_amount("45.000,50"), 45000)
        self.assertEqual(parse_amount("1,250.00"), 1250)

    def test_negatif(self):
        self.assertEqual(parse_amount("-5.000"), -5000)


class TestParseReceipt(unittest.TestCase):
    struk_indomaret = """INDOMARET
Jl. Merdeka No. 45
NPWP: 01.234.567.8-901.000
Kasir: 03
10/04/2026 14:32

Indomie Goreng      2 x 4.500        9.000
Teh Botol Sosro    1 x 7.000        7.000
Roti Tawar Sari Roti                16.500
Total                              32.500
TUNAI                             50.000
KEMBALIAN                         17.500
Terima kasih
"""

    struk_minimarket = """SUPERMARKET SEHAT
Jl.sudirman No 8 Jakarta
No. Nota : 2026/04/10/0012
Tanggal : 04 Okt 2026

Susu UHT 1L       2   18.900   37.800
Telur Ayam       1kg  32.000   32.000
GRAND TOTAL                   69.800
BAYAR VIA QRIS                69.800
"""

    def test_parse_amount(self):
        for raw, expected in [
            ("Rp 1.250.000", 1250000), ("45.000", 45000), ("12,500", 12500),
            ("45.000,50", 45000), ("1,250.00", 1250), ("9000", 9000),
        ]:
            with self.subTest(raw=raw):
                self.assertEqual(parse_amount(raw), expected)

    def test_bukan_angka(self):
        for raw in ["TERIMA KASIH", "", None, "NO NOTA"]:
            with self.subTest(raw=raw):
                self.assertIsNone(parse_amount(raw))

    def test_tanggal_indonesia(self):
        hasil = parse_receipt(self.struk_indomaret)
        self.assertEqual(hasil["date"]["value"], "2026-04-10")

    def test_tanggal_teks_bulan(self):
        hasil = parse_receipt("SUPERMARKET\n04 Okt 2026\nTotal 10.000")
        self.assertEqual(hasil["date"]["value"], "2026-10-04")

    def test_parse_amount_terpisah(self):
        for raw, expected in [("Rp 1.250.000", 1250000), ("45.000", 45000)]:
            with self.subTest(raw=raw):
                self.assertEqual(parse_amount(raw), expected)

    def test_total_dari_label(self):
        hasil = parse_receipt(self.struk_indomaret)
        self.assertEqual(hasil["total"]["value"], 32500)
        self.assertEqual(hasil["total"]["source"], "label")

    def test_total_bukan_kembalian(self):
        hasil = parse_receipt(self.struk_indomaret)
        self.assertNotEqual(hasil["total"]["value"], 17500)

    def test_item_dan_qty(self):
        hasil = parse_receipt(self.struk_indomaret)
        labels = [i["label"] for i in hasil["items"]]
        self.assertIn("Indomie Goreng", labels)
        amounts = {i["label"]: i["amount"] for i in hasil["items"]}
        self.assertEqual(amounts["Indomie Goreng"], 9000)
        self.assertEqual(amounts["Roti Tawar Sari Roti"], 16500)

    def test_baris_non_item_dilewati(self):
        hasil = parse_receipt(self.struk_indomaret)
        labels = " ".join(i["label"] for i in hasil["items"]).lower()
        for noise in ("total", "tunai", "kembalian", "terima kasih", "kasir"):
            self.assertNotIn(noise, labels)

    def test_kolom_harga_satuan_dibuang(self):
        hasil = parse_receipt(self.struk_minimarket)
        label = {i["label"]: i["amount"] for i in hasil["items"]}
        self.assertEqual(label["Susu UHT 1L"], 37800)
        self.assertEqual(label["Telur Ayam 1kg"], 32000)
        self.assertEqual(hasil["item_sum"], 69800)

    def test_total_grand_total(self):
        hasil = parse_receipt(self.struk_minimarket)
        self.assertEqual(hasil["total"]["value"], 69800)
        self.assertEqual(hasil["total"]["source"], "label")

    def test_qrisman_bukan_item(self):
        hasil = parse_receipt(self.struk_minimarket)
        gabung = " ".join(i["label"] for i in hasil["items"]).lower()
        self.assertNotIn("qris", gabung)

    def test_keyword_pendek_tidak_salah_cocok(self):
        # "wa" tidak boleh mencocokkan kata "tawar"
        hasil = parse_receipt("TOKO\n10/04/2026\nRoti Tawar Sari Roti 16.500\nTOTAL 16.500")
        self.assertEqual([i["label"] for i in hasil["items"]], ["Roti Tawar Sari Roti"])

    def test_item_setelah_total_diabaikan(self):
        hasil = parse_receipt(self.struk_indomaret)
        amounts = [i["amount"] for i in hasil["items"]]
        self.assertNotIn(50000, amounts)   # TUNAI
        self.assertNotIn(17500, amounts)   # KEMBALIAN

    def test_toleransi_salah_baca_ocr(self):
        # "TUNAT" hasil salah baca dari "TUNAI" tidak boleh jadi item
        teks = "TOKO\n10/04/2026\nBarang A 10.000\nTOTAL 10.000\nTUNAT 20.000\nKEMBALIAN 10.000"
        hasil = parse_receipt(teks)
        self.assertEqual([i["label"] for i in hasil["items"]], ["Barang A"])

    def test_teks_kosong_tidak_apa_apa(self):
        hasil = parse_receipt("\n\n   \n")
        self.assertEqual(hasil["items"], [])
        self.assertFalse(hasil["warnings"] == [])

    def test_nama_toko(self):
        hasil = parse_receipt(self.struk_indomaret)
        self.assertEqual(hasil["merchant"]["value"], "INDOMARET")

    def test_item_sum_konsisten(self):
        hasil = parse_receipt(self.struk_indomaret)
        self.assertEqual(hasil["item_sum"], 32500)
        self.assertFalse([w for w in hasil["warnings"] if w["field"] == "total"])

    def test_peringatan_total_tidak_cocok(self):
        hasil = parse_receipt("TOKO\n10/04/2026\nBarang A 10.000\nTOTAL 12.000")
        pesan = [w["message"] for w in hasil["warnings"] if w["field"] == "total"]
        self.assertTrue(any("tidak sama" in m for m in pesan))

    def test_tanpa_tanggal_masih_aman(self):
        hasil = parse_receipt("TOKO\nBarang A 10.000\nTOTAL 10.000")
        self.assertIsNone(hasil["date"]["value"])
        self.assertTrue(any(w["field"] == "date" for w in hasil["warnings"]))

    def test_struk_kosong(self):
        hasil = parse_receipt("")
        self.assertEqual(hasil["items"], [])
        self.assertIsNone(hasil["total"]["value"])
        self.assertTrue(any(w["field"] == "items" for w in hasil["warnings"]))

    def test_confidence_rendah_ditandai(self):
        teks = "TOKO\n10/04/2026\nBarang A 10.000\nTOTAL 10.000"
        conf = {0: 95.0, 1: 91.0, 2: 48.0, 3: 93.0}
        hasil = parse_receipt(teks, conf)
        self.assertTrue(hasil["low_confidence"])
        self.assertTrue(any(i["low_confidence"] for i in hasil["items"]))

    def test_confidence_tinggi_tenang(self):
        teks = "TOKO\n10/04/2026\nBarang A 10.000\nTOTAL 10.000"
        conf = {i: 92.0 for i in range(4)}
        hasil = parse_receipt(teks, conf)
        self.assertFalse(hasil["low_confidence"])


if __name__ == "__main__":
    unittest.main(verbosity=2)