"""Regresi orientasi foto struk: python3 -m unittest discover -s tests -v

Kasus yang dijaga:
- Foto miring 90/180/270 derajat harus tetap terbaca (dulu hasilnya sampah).
- Pemisahan ribuan spasi pada nominal harus utuh ("TOTAL 92 800" -> 92800).

Butuh tesseract + ImageMagick; dilewati otomatis kalau tidak tersedia.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402

RECEIPT_TEXT = """INDOMARET
Jl. Merdeka No. 45
Kasir 03
10/04/2026 14:32

Indomie Goreng 2 x 4.500 9.000
Teh Botol 1 x 7.000 7.000
Roti Tawar 16.500
TOTAL 32.500
TUNAI 50.000
KEMBALIAN 17.500
"""

HAVE_TESSERACT = bool(shutil.which("tesseract"))
HAVE_MAGICK = bool(shutil.which("magick") or shutil.which("convert"))
MAGICK = shutil.which("magick") or shutil.which("convert")


def build_receipt_image(directory: Path, name: str, rotate: int = 0) -> Path:
    """Buat foto struk sintetis, lalu putar sebesar `rotate` derajat."""
    text_file = directory / f"{name}.txt"
    text_file.write_text(RECEIPT_TEXT, encoding="utf-8")
    base = directory / f"{name}.png"
    subprocess.run(
        [MAGICK, "-size", "1000x700", "xc:white", "-font", "DejaVu-Sans", "-pointsize", "30",
         "-fill", "black", "-annotate", "+40+60", f"@{text_file}", str(base)],
        capture_output=True, check=True, timeout=60,
    )
    if not rotate:
        return base
    turned = directory / f"{name}-r{rotate}.png"
    subprocess.run([MAGICK, str(base), "-background", "white", "-rotate", str(rotate), str(turned)],
                   capture_output=True, check=True, timeout=60)
    return turned


class TestSkorDraf(unittest.TestCase):
    """Penilaian kualitas draf tidak butuh tesseract."""

    def test_draf_kosong_skor_nol(self):
        self.assertEqual(server._draft_quality(None), 0)

    def test_draf_baik_skor_tinggi(self):
        draf = server.receipt.parse_receipt(RECEIPT_TEXT)
        self.assertGreaterEqual(server._draft_quality(draf), server.DRAFT_GOOD_SCORE)

    def test_draf_sampah_skor_rendah(self):
        sampah = server.receipt.parse_receipt("~ ~ ~ ~~~ \n ||| ||| \n §§ \n .. ..")
        self.assertLess(server._draft_quality(sampah), server.DRAFT_GOOD_SCORE)

    def test_kandidat_cadangan_valid(self):
        for used in (0, 90, 180, 270):
            with self.subTest(used=used):
                kandidat = server._fallback_candidates(used)
                self.assertTrue(kandidat, "harus ada minimal satu cadangan")
                for sudut in kandidat:
                    self.assertIn(sudut, (90, 270, 180))
                    self.assertNotEqual(sudut, used)


@unittest.skipUnless(HAVE_TESSERACT and HAVE_MAGICK, "butuh tesseract + ImageMagick")
class TestRotasiFoto(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="dompetku-rotasi-")
        cls.dir = Path(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def ocr(self, rotate):
        path = build_receipt_image(self.dir, f"struk{rotate}", rotate)
        return server.ocr_receipt(path.read_bytes(), ".png")

    def test_foto_tegak(self):
        hasil = self.ocr(0)
        self.assertEqual(hasil["engine"]["rotation"], 0)
        self.assertEqual(hasil["parsed"]["total"]["value"], 32500)
        self.assertEqual(len(hasil["parsed"]["items"]), 3)

    def test_foto_miring_90(self):
        hasil = self.ocr(90)
        self.assertNotEqual(hasil["engine"]["rotation"], 0, "foto miring tidak diluruskan")
        self.assertEqual(hasil["parsed"]["total"]["value"], 32500)
        self.assertEqual(len(hasil["parsed"]["items"]), 3)

    def test_foto_miring_270(self):
        hasil = self.ocr(270)
        self.assertNotEqual(hasil["engine"]["rotation"], 0, "foto miring tidak diluruskan")
        self.assertEqual(hasil["parsed"]["total"]["value"], 32500)

    def test_foto_miring_180(self):
        hasil = self.ocr(180)
        self.assertEqual(hasil["parsed"]["total"]["value"], 32500)

    def test_total_ribuan_spasi_dari_foto(self):
        """Gabungan: foto miring + nominal berformat '92 800'."""
        text_file = self.dir / "spasi.txt"
        text_file.write_text(
            "TOKO\n10/04/2026\nKopi Susu 22 000\nRoti Tawar 16 500\nTOTAL 92 800\n",
            encoding="utf-8")
        base = self.dir / "spasi.png"
        subprocess.run(
            [MAGICK, "-size", "900x500", "xc:white", "-font", "DejaVu-Sans", "-pointsize", "30",
             "-fill", "black", "-annotate", "+40+60", f"@{text_file}", str(base)],
            capture_output=True, check=True, timeout=60)
        turned = self.dir / "spasi-r90.png"
        subprocess.run([MAGICK, str(base), "-background", "white", "-rotate", "90", str(turned)],
                       capture_output=True, check=True, timeout=60)
        hasil = server.ocr_receipt(turned.read_bytes(), ".png")
        self.assertEqual(hasil["parsed"]["total"]["value"], 92800)


    def test_cadangan_tanpa_osd(self):
        """Kalau OSD gagal, satu rotasi cadangan harus menyelamatkan hasil."""
        path = build_receipt_image(self.dir, "tanpa-osd", 90)
        with unittest.mock.patch.object(server, "detect_rotation", return_value=None):
            hasil = server.ocr_receipt(path.read_bytes(), ".png")
        self.assertEqual(hasil["engine"]["rotation_source"], "cadangan")
        self.assertEqual(hasil["parsed"]["total"]["value"], 32500)
        self.assertEqual(len(hasil["parsed"]["items"]), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)