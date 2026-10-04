"""Regresi lapisan HTTP: python3 -m unittest discover -s tests -v

Kasus yang dijaga:
- Body permintaan yang belum dibaca tidak boleh mencemari koneksi keep-alive.
  Gejalanya: permintaan berikutnya menerima halaman error HTML Python
  ("400 Bad request syntax" / "501 Unsupported method") alih-alih JSON.
- Method HTTP tak dikenal harus dibalas JSON, bukan HTML bawaan BaseHTTPRequestHandler.
- Error tidak boleh bocor sebagai HTML ke klien.
"""

import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402


class ServerTestCase(unittest.TestCase):
    """Jalankan server sungguhan di port acak agar perilaku HTTP teruji nyata."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="dompetku-http-")
        os.environ["DOMPETKU_DB"] = os.path.join(cls.tmp, "uji.db")
        os.environ["DOMPETKU_OCR_ENABLED"] = "0"
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)
        os.environ.pop("DOMPETKU_DB", None)

    def connect(self):
        return http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)

    def request(self, method, path, body=None, headers=None):
        conn = self.connect()
        self.addCleanup(conn.close)
        payload = None
        head = dict(headers or {})
        if body is not None:
            payload = body if isinstance(body, bytes) else json.dumps(body).encode()
            head["Content-Type"] = "application/json"
        conn.request(method, path, body=payload, headers=head)
        response = conn.getresponse()
        raw = response.read()
        return response.status, dict(response.getheaders()), raw

    def json_of(self, raw):
        return json.loads(raw.decode("utf-8"))


class TestBodyDiTidakDibacaHarusDrain(ServerTestCase):
    def setUp(self):
        # Sesi tidak pernah ada -> require_session() membalas 401 tanpa
        # membaca body lebih dulu.
        self.dead = {"Cookie": "dompetku_session=SESI-MATI-SECARA-SENGJA"}

    def test_401_lalu_permintaan_berikutnya_tetap_bersih(self):
        """Inti bug: 401 tanpa drain resurrection -> 400/501 pada request berikutnya."""
        conn = self.connect()
        self.addCleanup(conn.close)
        conn.request("POST", "/api/logout", body=json.dumps({"scope": "self"}),
                     headers={"Content-Type": "application/json", **self.dead})
        first = conn.getresponse()
        self.assertEqual(first.status, 401)
        self.json_of(first.read())

        # Permintaan kedua pada koneksi yang sama harus tetap JSON yang benar.
        conn.request("GET", "/api/slots")
        second = conn.getresponse()
        raw = second.read()
        self.assertEqual(second.status, 200, f"koneksi tercemar: {raw[:160]!r}")
        self.assertEqual(self.json_of(raw)["max"], 2)

    def test_403_asal_juga_drain(self):
        conn = self.connect()
        self.addCleanup(conn.close)
        conn.request("POST", "/api/logout", body=json.dumps({"scope": "self"}),
                     headers={"Content-Type": "application/json",
                              "Origin": "https://penyerang.example", **self.dead})
        first = conn.getresponse()
        self.assertEqual(first.status, 403)
        first.read()
        conn.request("GET", "/api/slots")
        second = conn.getresponse()
        self.assertEqual(second.status, 200)

    def test_405_pada_file_statis_drain(self):
        conn = self.connect()
        self.addCleanup(conn.close)
        conn.request("POST", "/index.html", body=b"abc", headers={"Content-Type": "text/plain"})
        first = conn.getresponse()
        self.assertEqual(first.status, 405)
        first.read()
        conn.request("GET", "/api/slots")
        self.assertEqual(conn.getresponse().status, 200)


    def test_tiga_permintaan_beruntun_satu_koneksi(self):
            """Regresi: penanda body harus diulang tiap permintaan.

            Kalau tidak, permintaan kedua (yang punya body) tidak di-drain dan
            sisa body menempel ke baris permintaan ketiga sehingga ia dibalas
            "501 Unsupported method ('{\"scope\":\"self\"}GET')" — persis gejala
            yang dilaporkan pengguna saat menekan Keluar.
            """
            conn = self.connect()
            self.addCleanup(conn.close)

            conn.request("GET", "/api/state", headers=self.dead)
            awal = conn.getresponse()
            self.assertEqual(awal.status, 401)
            awal.read()

            conn.request("POST", "/api/logout", body=json.dumps({"scope": "self"}),
                         headers={"Content-Type": "application/json", **self.dead})
            keluar = conn.getresponse()
            self.assertEqual(keluar.status, 401)
            keluar.read()

            conn.request("GET", "/api/session", headers=self.dead)
            akhir = conn.getresponse()
            raw = akhir.read()
            self.assertEqual(akhir.status, 401, f"koneksi tercemar: {raw[:160]!r}")
            self.assertNotIn(b"<!DOCTYPE", raw)


class TestMethodTakDikenal(ServerTestCase):
    def test_method_asing_balas_json_bukan_html(self):
        status, headers, raw = self.request("FROB", "/api/logout")
        self.assertEqual(status, 501)
        self.assertIn("application/json", headers.get("Content-Type", ""))
        self.assertNotIn(b"<!DOCTYPE", raw)
        self.assertIn("tidak didukung", self.json_of(raw)["error"])
        self.assertIn("FROB", self.json_of(raw)["error"])

    def test_options_memberi_allow(self):
        status, headers, _ = self.request("OPTIONS", "/api/session")
        self.assertEqual(status, 204)
        self.assertIn("GET", headers.get("Allow", ""))
        self.assertIn("POST", headers.get("Allow", ""))


class TestErrorSelaluJson(ServerTestCase):
    def test_endpoint_tidak_dikenal(self):
        status, headers, raw = self.request("GET", "/api/entah")
        self.assertEqual(status, 404)
        self.assertIn("application/json", headers.get("Content-Type", ""))
        self.assertEqual(self.json_of(raw)["error"], "Endpoint tidak dikenal.")

    def test_405_memakai_allow(self):
        status, headers, raw = self.request("POST", "/index.html", body=b"x")
        self.assertEqual(status, 405)
        self.assertIn("Allow", headers)
        self.assertNotIn(b"<!DOCTYPE", raw)


if __name__ == "__main__":
    unittest.main(verbosity=2)