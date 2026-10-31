"""Regresi API kalender: python3 -m unittest tests.test_calendar -v

Kasus yang dijaga:
- CRUD agenda lewat HTTP sungguhan (tambah, ubah, tandai lunas, hapus).
- Field opsional bisa dikosongkan saat ubah (dulu nilai lama selalu kembali).
- Tanggal wajib, supaya agenda tidak hilang dari daftar per tanggal.
- POST tidak boleh menimpa agenda lain lewat `id` kiriman klien.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_http import ServerTestCase  # noqa: E402

import server  # noqa: E402


class TestNormalisasiAgenda(unittest.TestCase):
    def test_tanggal_wajib(self):
        with self.assertRaisesRegex(ValueError, "Tanggal"):
            server.normalize_calendar_item({"type": "schedule", "title": "Les"})

    def test_field_kosong_menimpa_nilai_lama(self):
        lama = server.normalize_calendar_item({
            "type": "schedule", "title": "Les renang", "date": "2026-11-02",
            "time": "15:30", "child": "Aisyah", "notes": "bawa handuk",
        })
        baru = server.normalize_calendar_item({"time": "", "child": "", "notes": ""}, lama)
        self.assertIsNone(baru["time"])
        self.assertIsNone(baru["child"])
        self.assertIsNone(baru["notes"])
        self.assertEqual(baru["title"], "Les renang")

    def test_nominal_berformat_ribuan(self):
        item = server.normalize_calendar_item({"type": "bill", "title": "Listrik", "date": "2026-11-05", "amount": "250.000"})
        self.assertEqual(item["amount"], 250000)


class TestApiKalender(ServerTestCase):
    def setUp(self):
        server.db().execute("DELETE FROM sessions")
        server.db().execute("DELETE FROM calendar_items")
        status, headers, _ = self.request("POST", "/api/login", body={
            "username": "buya", "password": server.DEFAULT_PASSWORD
        })
        self.assertEqual(status, 200)
        self.auth = {"Cookie": headers["Set-Cookie"].split(";")[0]}

    def call(self, method, path, body=None):
        status, _, raw = self.request(method, path, body=body, headers=self.auth)
        return status, self.json_of(raw)

    def test_crud_lengkap(self):
        status, data = self.call("POST", "/api/calendar-items", {
            "type": "bill", "title": "Listrik", "date": "2026-11-05", "amount": 250000,
        })
        self.assertEqual(status, 201, data)
        item = data["item"]
        self.assertEqual(item["status"], "pending")
        self.assertEqual(item["created_by"], "buya")

        status, data = self.call("PATCH", "/api/calendar-item", {"id": item["id"], "toggle_done": True})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["item"]["status"], "paid")

        status, data = self.call("PATCH", "/api/calendar-item", {
            "id": item["id"], "type": "bill", "title": "Listrik PLN", "date": "2026-11-06",
            "time": "", "amount": "", "status": "paid", "notes": "",
        })
        self.assertEqual(status, 200, data)
        self.assertEqual(data["item"]["title"], "Listrik PLN")
        self.assertIsNone(data["item"]["amount"])

        status, data = self.call("GET", "/api/calendar-items?limit=500")
        self.assertEqual(status, 200)
        self.assertEqual([x["id"] for x in data["items"]], [item["id"]])

        status, _ = self.call("DELETE", "/api/calendar-item", {"id": item["id"]})
        self.assertEqual(status, 200)
        status, data = self.call("GET", "/api/calendar-items")
        self.assertEqual(data["items"], [])

    def test_post_tidak_menimpa_agenda_lain(self):
        _, data = self.call("POST", "/api/calendar-items", {"type": "birthday", "title": "Ulang tahun", "date": "2026-12-01"})
        asli = data["item"]["id"]
        status, data = self.call("POST", "/api/calendar-items", {"id": asli, "type": "schedule", "title": "Penimpa", "date": "2026-12-02"})
        self.assertEqual(status, 201)
        self.assertNotEqual(data["item"]["id"], asli)
        _, data = self.call("GET", "/api/calendar-items")
        self.assertEqual(len(data["items"]), 2)

    def test_tanggal_kosong_ditolak_sebagai_json(self):
        status, data = self.call("POST", "/api/calendar-items", {"type": "schedule", "title": "Les"})
        self.assertEqual(status, 400)
        self.assertIn("Tanggal", data["error"])

    def test_tanpa_sesi_ditolak(self):
        status, _, _ = self.request("GET", "/api/calendar-items")
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main()
