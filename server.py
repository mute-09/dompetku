#!/usr/bin/env python3
"""DompetKu - server aplikasirumah tangga.

Menyajikan PWA statis + API data bersama dengan autentikasi dua pengguna
(buya & ummah) dan batas maksimal dua sesi login aktif.

Perintah:
  python3 server.py                      # jalankan server (default 0.0.0.0:8090)
  python3 server.py serve --port 8090
  python3 server.py user list
  python3 server.py user passwd buya
  python3 server.py user add ummah
  python3 server.py user rm ummah
  python3 server.py sessions
  python3 server.py sessions revoke <token>
  python3 server.py ocr --cek           # apakah mesin OCR terpasang
  python3 server.py ocr struk.jpg       # uji OCR dari terminal
"""

from __future__ import annotations

import argparse
import base64
import binascii
import csv
import hashlib
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import receipt

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DOMPETKU_DATA", ROOT / "data"))
DB_PATH = Path(os.environ.get("DOMPETKU_DB", DATA_DIR / "dompetku.db"))

COOKIE_NAME = "dompetku_session"
MAX_SESSIONS = int(os.environ.get("DOMPETKU_MAX_SESSIONS", "2"))
SESSION_IDLE_SECONDS = int(os.environ.get("DOMPETKU_SESSION_DAYS", "30")) * 86400
SESSION_COOKIE_AGE = SESSION_IDLE_SECONDS
SESSION_HANDSHAKE = int(os.environ.get("DOMPETKU_HANDSHAKE_MINUTES", "10")) * 60
LOGIN_ATTEMPTS = 10
LOGIN_WINDOW = 600
JSON_MAX_BYTES = 4_000_000
MIN_PASSWORD_LENGTH = 6
RESET_CONFIRM = "HAPUS SEMUA"
ALLOWED_METHODS = "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS"

DEFAULT_USERS = ("buya", "ummah")
DEFAULT_PASSWORD = os.environ.get("DOMPETKU_DEFAULT_PASSWORD", "rahasiasekali")

# Versi aplikasi dengan skema MAJOR.MINOR (contoh: 1.9).
# MAJOR hanya naik untuk perubahan besar/migrasi; MINOR naik tiap rilis shell.
# Harus sama dengan APP_VERSION di js/utils.js dan CACHE_NAME di sw.js
# (dicek tests/test_version.py). App menampilkan tombol muat ulang kalau server
# sudah lebih baru dari shell yang sedang berjalan.
APP_VERSION = os.environ.get("DOMPETKU_VERSION", "1.14")

SCRYPT_N = 1 << 14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32

CATEGORIES = {
    "Makanan", "Belanja", "Transportasi", "Tagihan", "Rumah Tangga",
    "Kesehatan", "Pendidikan", "Hiburan", "Pakaian", "Kebutuhan Anak",
    "Lainnya",
}
SOURCES = {"Gaji", "Freelance", "Usaha", "Investasi", "Bonus", "Lainnya"}
FREQUENCIES = {"harian", "mingguan", "bulanan", "tahunan"}

LOCAL_DB = threading.local()
ATTEMPTS: dict[str, deque] = defaultdict(deque)
ATTEMPTS_LOCK = threading.Lock()


# --- database ---------------------------------------------------------------


def now() -> float:
    return time.time()


def iso(ts: float | None = None) -> str:
    return datetime.fromtimestamp(ts if ts is not None else now(), timezone.utc).isoformat()


def db() -> sqlite3.Connection:
    conn = getattr(LOCAL_DB, "conn", None)
    if conn is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        LOCAL_DB.conn = conn
    return conn


def init_db() -> None:
    conn = db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            username   TEXT PRIMARY KEY,
            salt       TEXT NOT NULL,
            pass_hash  TEXT NOT NULL,
            dibuat      REAL NOT NULL,
            diubah      REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT PRIMARY KEY,
            username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            dibuat     REAL NOT NULL,
            terakhir   REAL NOT NULL,
            alamat     TEXT,
            perangkat  TEXT
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id         TEXT PRIMARY KEY,
            type       TEXT NOT NULL CHECK (type IN ('expense', 'income')),
            nominal    INTEGER NOT NULL CHECK (nominal > 0),
            tanggal    TEXT NOT NULL,
            kategori   TEXT,
            sumber     TEXT,
            keterangan TEXT NOT NULL DEFAULT '',
            frekuensi  TEXT NOT NULL DEFAULT 'harian',
            dibuat     TEXT NOT NULL,
            diubah     REAL NOT NULL,
            oleh       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_transactions_tanggal ON transactions(tanggal);
        CREATE TABLE IF NOT EXISTS app_state (
            key    TEXT PRIMARY KEY,
            value  TEXT NOT NULL
        );
        """
    )
    row = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()
    if row["n"] == 0:
        for username in DEFAULT_USERS:
            create_user(username, DEFAULT_PASSWORD)
        print(f"[dompetku] akun awal dibuat: {', '.join(DEFAULT_USERS)} (password: {DEFAULT_PASSWORD})")
    row = conn.execute("SELECT value FROM app_state WHERE key='settings'").fetchone()
    if row is None:
        set_settings({"threshold": 1.5, "theme": "auto", "onboarded": True})
    row = conn.execute("SELECT value FROM app_state WHERE key='rev'").fetchone()
    if row is None:
        conn.execute("INSERT INTO app_state(key, value) VALUES('rev', '1')")


def bump_rev(conn: sqlite3.Connection | None = None) -> int:
    conn = conn or db()
    conn.execute("UPDATE app_state SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key='rev'")
    row = conn.execute("SELECT value FROM app_state WHERE key='rev'").fetchone()
    return int(row["value"]) if row else 1


def current_rev() -> int:
    row = db().execute("SELECT value FROM app_state WHERE key='rev'").fetchone()
    return int(row["value"]) if row else 0


# --- password ---------------------------------------------------------------


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_DKLEN)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        _, candidate = hash_password(password, bytes.fromhex(salt_hex))
    except ValueError:
        return False
    return hmac.compare_digest(candidate, hash_hex)


def create_user(username: str, password: str) -> None:
    username = normalize_username(username)
    if not username:
        raise SystemExit("Username tidak valid.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise SystemExit(f"Password minimal {MIN_PASSWORD_LENGTH} karakter.")
    if db().execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        raise SystemExit(f"User '{username}' sudah ada.")
    salt, digest = hash_password(password)
    timestamp = now()
    db().execute(
        "INSERT INTO users(username, salt, pass_hash, dibuat, diubah) VALUES(?,?,?,?,?)",
        (username, salt, digest, timestamp, timestamp),
    )


def normalize_username(value: str) -> str:
    return re.sub(r"[^a-z0-9_.-]", "", str(value or "").strip().lower())[:32]


# --- sessions ---------------------------------------------------------------


def prune_sessions(conn: sqlite3.Connection | None = None) -> None:
    conn = conn or db()
    cutoff = now() - SESSION_IDLE_SECONDS
    conn.execute("DELETE FROM sessions WHERE terakhir < ?", (cutoff,))


def session_info(token: str) -> sqlite3.Row | None:
    prune_sessions()
    row = db().execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
    if row and (now() - row["terakhir"]) > SESSION_IDLE_SECONDS:
        db().execute("DELETE FROM sessions WHERE token=?", (token,))
        return None
    return row


def active_sessions() -> list[sqlite3.Row]:
    prune_sessions()
    return db().execute("SELECT * FROM sessions ORDER BY terakhir DESC").fetchall()


def create_session(username: str, address: str, device: str) -> str:
    token = secrets.token_urlsafe(32)
    timestamp = now()
    # Satu akun = satu sesi aktif. Kalau login lagi (misalnya cookie hilang
    # setelah cache dibersihkan), sesi lama akun yang sama dicabut supaya
    # kuota sesi tidak terpakai dua kali oleh orang yang sama.
    db().execute("DELETE FROM sessions WHERE username=?", (username,))
    db().execute(
        "INSERT INTO sessions(token, username, dibuat, terakhir, alamat, perangkat) VALUES(?,?,?,?,?,?)",
        (token, username, timestamp, timestamp, address[:64], device[:120]),
    )
    return token


# --- data -------------------------------------------------------------------


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clean_text(value, limit: int = 140) -> str:
    return str(value or "").strip()[:limit]


def normalize_transaction(payload: dict, existing: sqlite3.Row | None = None) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Data transaksi tidak valid.")
    raw_type = payload.get("type")
    if raw_type in (None, ""):
        kind = existing["type"] if existing else "expense"
    elif raw_type in ("expense", "income"):
        kind = raw_type
    else:
        raise ValueError("Tipe transaksi harus expense atau income.")

    try:
        nominal = int(round(float(payload.get("nominal", existing["nominal"] if existing else 0))))
    except (TypeError, ValueError):
        nominal = 0
    if nominal <= 0 or nominal > 999_999_999_999:
        raise ValueError("Nominal tidak valid.")

    tanggal = payload.get("tanggal") or (existing["tanggal"] if existing else "")
    if not DATE_RE.match(str(tanggal)):
        raise ValueError("Tanggal tidak valid.")

    keterangan = clean_text(payload.get("keterangan", existing["keterangan"] if existing else ""))
    frekuensi = clean_text(payload.get("frekuensi", existing["frekuensi"] if existing else "harian"), 16).lower()
    if frekuensi not in FREQUENCIES:
        frekuensi = "harian"

    if kind == "expense":
        kategori = clean_text(payload.get("kategori", existing["kategori"] if existing else ""), 32)
        if kategori not in CATEGORIES:
            kategori = "Lainnya"
        sumber = None
    else:
        sumber = clean_text(payload.get("sumber", existing["sumber"] if existing else ""), 32)
        if sumber not in SOURCES:
            sumber = "Lainnya"
        kategori = None

    identifier = clean_text(payload.get("id", existing["id"] if existing else ""), 40) or secrets.token_hex(8)
    identifier = re.sub(r"[^A-Za-z0-9_.-]", "", identifier)[:40]
    dibuat = existing["dibuat"] if existing else iso()
    oleh = existing["oleh"] if existing else ""

    return {
        "id": identifier,
        "type": kind,
        "nominal": nominal,
        "tanggal": tanggal,
        "kategori": kategori,
        "sumber": sumber,
        "keterangan": keterangan,
        "frekuensi": frekuensi,
        "dibuat": dibuat,
        "oleh": oleh,
    }


def upsert_transaction(tx: dict, username: str) -> dict:
    conn = db()
    existing = conn.execute("SELECT * FROM transactions WHERE id=?", (tx["id"],)).fetchone()
    if existing:
        conn.execute(
            """UPDATE transactions SET type=?, nominal=?, tanggal=?, kategori=?, sumber=?,
               keterangan=?, frekuensi=?, diubah=?, oleh=? WHERE id=?""",
            (tx["type"], tx["nominal"], tx["tanggal"], tx["kategori"], tx["sumber"], tx["keterangan"],
             tx["frekuensi"], now(), username, tx["id"]),
        )
    else:
        conn.execute(
            """INSERT INTO transactions(id, type, nominal, tanggal, kategori, sumber, keterangan,
               frekuensi, dibuat, diubah, oleh) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (tx["id"], tx["type"], tx["nominal"], tx["tanggal"], tx["kategori"], tx["sumber"],
             tx["keterangan"], tx["frekuensi"], tx["dibuat"], now(), username),
        )
    return read_transaction(tx["id"])


def read_transaction(identifier: str) -> dict | None:
    row = db().execute("SELECT * FROM transactions WHERE id=?", (identifier,)).fetchone()
    if not row:
        return None
    data = dict(row)
    data.pop("diubah", None)
    return data


def get_settings() -> dict:
    row = db().execute("SELECT value FROM app_state WHERE key='settings'").fetchone()
    if not row:
        return {"threshold": 1.5, "theme": "auto", "onboarded": True}
    try:
        return json.loads(row["value"])
    except json.JSONDecodeError:
        return {"threshold": 1.5, "theme": "auto", "onboarded": True}


def set_settings(settings: dict) -> dict:
    merged = get_settings()
    if "threshold" in settings:
        try:
            threshold = float(settings["threshold"])
        except (TypeError, ValueError):
            threshold = merged.get("threshold", 1.5)
        merged["threshold"] = min(max(round(threshold, 2), 1.1), 3.0)
    if "theme" in settings and settings["theme"] in {"auto", "light", "dark"}:
        merged["theme"] = settings["theme"]
    merged["onboarded"] = True
    db().execute(
        "INSERT INTO app_state(key, value) VALUES('settings', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (json.dumps(merged, ensure_ascii=False),),
    )
    return merged


def read_state() -> dict:
    rows = db().execute("SELECT * FROM transactions").fetchall()
    expenses, incomes = [], []
    for row in rows:
        item = dict(row)
        item.pop("diubah", None)
        (incomes if item["type"] == "income" else expenses).append(item)
    expenses.sort(key=lambda t: (t["tanggal"], t["dibuat"]), reverse=True)
    incomes.sort(key=lambda t: (t["tanggal"], t["dibuat"]), reverse=True)
    return {"rev": current_rev(), "expenses": expenses, "incomes": incomes, "settings": get_settings()}


# --- http -------------------------------------------------------------------

# --- ocr struk --------------------------------------------------------------
# OCR memakai tesseract di server. Hasil parser SELALU diperlakukan sebagai
# draf: frontend wajib menampilkan teks mentah + daftar item agar pengguna
# mengoreksi sebelum menyimpan.

OCR_LANG_PREFERRED = ("ind", "eng")
OCR_TIMEOUT = int(os.environ.get("DOMPETKU_OCR_TIMEOUT", "45"))
OCR_MAX_BYTES = int(os.environ.get("DOMPETKU_OCR_MAX_BYTES", str(8 * 1024 * 1024)))
# Base64 menambah ~33%, jadi batas JSON untuk unggahan foto lebih besar
# dari batas gambar hasil decode.
OCR_MAX_JSON_BYTES = int(os.environ.get("DOMPETKU_OCR_MAX_JSON", str(12 * 1024 * 1024)))
OCR_INSTALL_HINT = "sudo apt install tesseract-ocr tesseract-ocr-ind"
OCR_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
OCR_SIGNATURES = ((b"\xff\xd8\xff", "image/jpeg"), (b"\x89PNG\r\n\x1a\n", "image/png"))
OCR_LANG_CACHE_SECONDS = 300
_OCR_LANGS: tuple[float, list[str]] | None = None


class OCRUnavailable(Exception):
    """Tesseract belum terpasang, atau bahasa yang dibutuhkan tidak ada."""


def tesseract_binary() -> str | None:
    configured = os.environ.get("DOMPETKU_TESSERACT")
    if configured:
        return configured if os.access(configured, os.X_OK) else None
    return shutil.which("tesseract")


def imagemagick_binary() -> str | None:
    """Cari ImageMagick untuk memperbaiki orientasi foto struk."""
    configured = os.environ.get("DOMPETKU_MAGICK")
    if configured:
        return configured if os.access(configured, os.X_OK) else None
    for name in ("magick", "convert"):
        found = shutil.which(name)
        if found:
            return found
    return None


def available_ocr_langs() -> list[str]:
    """Bahasa tesseract yang benar-benar terpasang.

    Hasil KOSONG tidak pernah di-cache: kalau tesseract baru saja diinstal
    sementara server sudah jalan, daftar bahasa harus langsung terbaca
    tanpa perlu tunggu cache habis.
    """
    global _OCR_LANGS
    if _OCR_LANGS and _OCR_LANGS[1] and time.time() - _OCR_LANGS[0] < OCR_LANG_CACHE_SECONDS:
        return _OCR_LANGS[1]
    binary = tesseract_binary()
    langs: list[str] = []
    if binary:
        try:
            done = subprocess.run([binary, "--list-langs"], capture_output=True, text=True,
                                  timeout=20, check=False)
        except (OSError, subprocess.SubprocessError):
            done = None
        for line in (done.stdout if done else "").splitlines()[1:]:
            name = line.strip()
            if name and re.fullmatch(r"[A-Za-z0-9_+.-]+", name):
                langs.append(name)
    if langs:
        _OCR_LANGS = (time.time(), langs)
    return langs


def resolve_ocr_lang() -> tuple[str, list[str]]:
    """Pilih bahasa OCR dari yang benar-benar terpasang.

    Kembalikan (bahasa_dipakai, preferensi_yang_belum_terpasang) supaya
    server bisa memberi tahu operator apa yang perlu diinstal.
    """
    langs = available_ocr_langs()
    preferred = [l for l in OCR_LANG_PREFERRED if l in langs]
    missing = [l for l in OCR_LANG_PREFERRED if l not in langs]
    chosen = "+".join(preferred) if preferred else (langs[0] if langs else "")
    return chosen, missing


def ocr_ready() -> bool:
    """Tesseract jalan dan minimal punya satu bahasa yang bisa dipakai."""
    return bool(resolve_ocr_lang()[0])


def ocr_status() -> dict:
    """Ringkasan readiness OCR untuk API health & UI."""
    lang, missing = resolve_ocr_lang()
    return {
        "available": bool(lang),
        "lang": lang or None,
        "missing": missing,
        "installed": available_ocr_langs(),
        "hint": OCR_INSTALL_HINT if missing else "",
    }


def sniff_image(raw: bytes) -> str | None:
    """Deteksi tipe gambar dari magic bytes, bukan dari nama berkas."""
    for signature, mime in OCR_SIGNATURES:
        if raw.startswith(signature):
            return mime
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return None


def decode_image(value: str) -> tuple[bytes, str]:
    """Terima data URL, validasi tipe + magic bytes, kembalikan (bytes, ekstensi).

    Foto struk berisi data sensitif, jadi file hanya hidup di
    TemporaryDirectory dan langsung terhapus setelah OCR selesai.
    """
    if not isinstance(value, str) or not value.startswith("data:image/"):
        raise ValueError("Gambar tidak valid.")
    header, _, payload = value.partition(",")
    mime = header[5:].split(";")[0].strip().lower()
    extension = OCR_IMAGE_TYPES.get(mime)
    if not extension:
        raise ValueError("Format gambar harus JPEG, PNG, atau WebP.")
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("Gambar tidak bisa dibaca (base64 rusak).")
    if not raw:
        raise ValueError("Gambar kosong.")
    if len(raw) > OCR_MAX_BYTES:
        raise ValueError(f"Ukuran gambar maksimal {OCR_MAX_BYTES // (1024 * 1024)} MB.")
    if sniff_image(raw) != mime:
        raise ValueError("Isi gambar tidak cocok dengan format yang dikirim.")
    return raw, extension


def _tesseract_env() -> dict:
    env = dict(os.environ)
    env.setdefault("OMP_THREAD_LIMIT", "1")
    return env


def _tesseract_run(args: list[str], lang: str) -> subprocess.CompletedProcess:
    binary = tesseract_binary()
    if not binary:
        raise OCRUnavailable(f"Mesin OCR belum terpasang di server. Jalankan: {OCR_INSTALL_HINT}")
    try:
        return subprocess.run([binary, *args, "-l", lang], capture_output=True, text=True,
                              timeout=OCR_TIMEOUT, env=_tesseract_env(), check=False)
    except subprocess.TimeoutExpired:
        raise ValueError("OCR terlalu lama. Coba foto yang lebih terang atau potong bagian struk saja.")


def ocr_lines(image_path: Path, lang: str, psm: int = 6) -> tuple[str, dict[int, float]]:
    """Jalankan tesseract mode TSV lalu rakit kembali teks per baris.

    TSV tesseract menyimpan kata di level 5 dan baris di level 4 (tanpa
    teks), jadi kata harus digabung ulang memakai kunci
    (blok, paragraf, baris). Keyakinan per kata dirata-rata menjadi
    keyakinan baris; nilai rendah dipakai UI untuk menandai field yang
    perlu diperiksa manusia.
    """
    done = _tesseract_run([str(image_path), "stdout", "--psm", str(psm), "--dpi", "300", "tsv"], lang)
    grouped: dict[tuple[str, str, str], list[dict]] = {}
    order: list[tuple[str, str, str]] = []

    if done.returncode == 0 and done.stdout.strip():
        reader = csv.DictReader(io.StringIO(done.stdout), delimiter="\t", quoting=csv.QUOTE_NONE)
        for row in reader:
            if (row.get("level") or "").strip() != "5":
                continue
            text = receipt.clean_text(row.get("text") or "")
            if not text:
                continue
            key = (row.get("block_num") or "", row.get("par_num") or "", row.get("line_num") or "")
            if key not in grouped:
                grouped[key] = []
                order.append(key)
            grouped[key].append(row)

    lines: list[str] = []
    confidence: dict[int, float] = {}
    for key in order:
        words = sorted(grouped[key], key=lambda r: int(r.get("left") or 0))
        pieces: list[str] = []
        scores: list[float] = []
        previous_right: int | None = None
        previous_height = 20
        for word in words:
            try:
                left = int(word.get("left") or 0)
                height = int(word.get("height") or previous_height)
                score = float(word.get("conf") or -1)
            except ValueError:
                left, height, score = previous_right or 0, previous_height, -1.0
            text = receipt.clean_text(word.get("text") or "")
            if not text:
                continue
            if previous_right is not None and left - previous_right > max(18, int(previous_height * 1.1)):
                pieces.append("   ")  # pertahankan jarak kolom struk
            pieces.append(text)
            if score >= 0:
                scores.append(score)
            previous_right = left + int(word.get("width") or 0)
            previous_height = height
        line = receipt.clean_text(" ".join(pieces).replace("    ", "   "))
        if not line:
            continue
        lines.append(line)
        if scores:
            confidence[len(lines) - 1] = round(sum(scores) / len(scores), 1)

    if not lines:
        plain = _tesseract_run([str(image_path), "stdout", "--psm", str(psm)], lang)
        lines = [text for text in (receipt.clean_text(l) for l in plain.stdout.splitlines()) if text]

    return "\n".join(lines), confidence


def _auto_orient(src: Path, dst: Path) -> Path:
    """Terapkan orientasi EXIF dulu supaya pengukuran sudut tidak keliru."""
    binary = imagemagick_binary()
    if binary:
        try:
            done = subprocess.run([binary, str(src), "-auto-orient", "-strip", str(dst)],
                                  capture_output=True, text=True, timeout=OCR_TIMEOUT, check=False)
            if done.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
                return dst
        except (OSError, subprocess.SubprocessError):
            pass
    return src


def _rotate_image(src: Path, dst: Path, degrees: int) -> bool:
    """Putar foto (sekali jalan) supaya teks struk tegak."""
    binary = imagemagick_binary()
    if not binary:
        return False
    degrees %= 360
    if degrees == 0:
        return False
    args = [binary, str(src), "-auto-orient", "-background", "white",
            "-rotate", str(degrees), "-strip", str(dst)]
    try:
        done = subprocess.run(args, capture_output=True, text=True,
                              timeout=OCR_TIMEOUT, check=False)
    except (OSError, subprocess.SubprocessError):
        return False
    return done.returncode == 0 and dst.exists() and dst.stat().st_size > 0


OSD_ROTATE = re.compile(r"Rotate:\s*(\d+)")
OSD_DEGREES = re.compile(r"Orientation in degrees:\s*(\d+)")


def detect_rotation(image_path: Path) -> int | None:
    """Deteksi sudut putar foto lewat Orientation & Script Detection.

    Mengembalikan derajat yang perlu ditambahkan agar foto tegak, atau None
    kalau tesseract tidak yakin (terlalu sedikit teks, data OSD belum ada).
    """
    if not tesseract_binary():
        return None
    try:
        done = _tesseract_run([str(image_path), "stdout", "--psm", "0",
                               "-c", "min_characters_to_try=25"], "osd")
    except (ValueError, OCRUnavailable):
        return None
    if done.returncode != 0:
        return None
    text = done.stdout or ""
    match = OSD_ROTATE.search(text) or OSD_DEGREES.search(text)
    if not match:
        return None
    degrees = int(match.group(1)) % 360
    return degrees or None


def _draft_quality(parsed: dict | None) -> int:
    """Skor kualitas draf: makin tinggi makin yakin struk terbaca."""
    if not parsed:
        return 0
    items = parsed.get("items") or []
    score = min(len(items), 12) * 10
    total = (parsed.get("total") or {}).get("value")
    item_sum = parsed.get("item_sum")
    if total:
        score += 40
    if total and item_sum and abs(total - item_sum) <= max(1, total // 100):
        score += 30
    if (parsed.get("merchant") or {}).get("value"):
        score += 10
    confidence = parsed.get("confidence")
    if isinstance(confidence, (int, float)) and confidence > 0:
        score += int(confidence / 10)
    return score


# Rotasi cadangan ketika hasil OCR pertama tetap jelek. OSD memberi arah
# yang tepat; tanpa OSD kita coba dua arah dan berhenti begitu dapat draf
# yang meyakinkan.
def _fallback_candidates(rotation: int) -> list[int]:
    if rotation in (90, 270):
        return [(rotation + 180) % 360]
    return [90, 270]


DRAFT_GOOD_SCORE = 70


def ocr_receipt(raw: bytes, extension: str, psm: int = 6) -> dict:
    """OCR satu gambar struk -> teks mentah + draf terstruktur.

    Foto miring (HP difoto memiring) otomatis diluruskan: orientasi EXIF dibaca
    lebih dulu, lalu sudut putar dideteksi dengan Orientation & Script
    Detection. Kalau draf hasilnya tetap tidak meyakinkan, satu sudut cadangan
    dicoba agar proses tidak meledak.
    """
    lang, missing = resolve_ocr_lang()
    if not lang:
        raise OCRUnavailable(f"Mesin OCR belum siap. Jalankan: {OCR_INSTALL_HINT}")
    started = time.time()

    def run(source: Path, rotation: int, how: str) -> dict:
        text, confidence = ocr_lines(source, lang, psm)
        parsed = receipt.parse_receipt(text, confidence) if text.strip() else None
        return {"text": text, "confidence": confidence, "parsed": parsed,
                "rotation": rotation, "source": how, "score": _draft_quality(parsed)}

    with tempfile.TemporaryDirectory(prefix="dompetku-ocr-") as workdir:
        target = Path(workdir) / f"struk{extension}"
        target.write_bytes(raw)
        base = _auto_orient(target, Path(workdir) / f"exif{extension}")

        rotation = detect_rotation(base) or 0
        upright = Path(workdir) / f"upright{extension}"
        if rotation and _rotate_image(base, upright, rotation):
            best = run(upright, rotation, "osd")
        else:
            rotation = 0
            best = run(base, 0, "apa-adanya")

        if best["score"] < DRAFT_GOOD_SCORE:
            # OSD bisa salah arah atau gagal; coba sudut lain, lalu berhenti
            # begitu dapat draf yang meyakinkan atau waktu sudah habis.
            for cadangan in _fallback_candidates(rotation):
                if time.time() - started > OCR_TIMEOUT:
                    break
                other = Path(workdir) / f"rotate{cadangan}{extension}"
                if not _rotate_image(base, other, cadangan):
                    continue
                trial = run(other, cadangan, "cadangan")
                if trial["score"] > best["score"]:
                    best = trial
                if best["score"] >= DRAFT_GOOD_SCORE:
                    break

    if not best["text"].strip():
        raise ValueError("Teks tidak terbaca. Coba foto yang lebih terang, rapi, dan dekat.")
    parsed = best["parsed"]
    elapsed_ms = int((time.time() - started) * 1000)
    print(f"[dompetku] ocr rotasi={best['rotation']} ({best['source']}) skor={best['score']} "
          f"item={len(parsed['items'])} total={(parsed['total'] or {}).get('value')} {elapsed_ms}ms",
          file=sys.stderr, flush=True)
    return {
        "text": best["text"],
        "confidence": parsed["confidence"],
        "low_confidence": parsed["low_confidence"],
        "parsed": parsed,
        "engine": {
            "lang": lang,
            "psm": psm,
            "rotation": best["rotation"],
            "rotation_source": best["source"],
            "elapsed_ms": elapsed_ms,
            "missing_langs": missing,
        },
    }


STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}
SKIP_FILES = {"server.py", "sw.js.orig"}
SKIP_DIRS = {"data", "deploy", "__pycache__", ".git"}
# Shell PWA (HTML/JS/CSS) harus selalu bisa direvalidasi: kalau proxy seperti
# Cloudflare menyimpan JS lama selama berjam-jam, pengguna tidak pernah melihat
# rilis baru meski sudah "muat ulang". Cache jangka panjangnya dipegang service worker di sisi klien.
NO_CACHE = {".html", ".json", ".webmanifest", ".js", ".css"}
# Service worker selalu harus segar; jangan pernah disimpan proxy mana pun.
NO_STORE = {"sw.js"}


class Handler(BaseHTTPRequestHandler):
    server_version = "DompetKu"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # noqa: A003
        if os.environ.get("DOMPETKU_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # helpers

    def address(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For", "")
        return (forwarded.split(",")[0].strip() if forwarded else self.client_address[0])[:64]

    def is_https(self) -> bool:
        return self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip().lower() == "https"

    def device(self) -> str:
        agent = self.headers.get("User-Agent", "")
        browser = "Browser"
        for needle, label in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Chrome/", "Chrome"),
                              ("Firefox/", "Firefox"), ("Safari/", "Safari")):
            if needle in agent:
                browser = label
                break
        platform = "Ponsel" if ("Mobile" in agent or "Android" in agent or "iPhone" in agent) else "Komputer"
        return f"{browser} · {platform}"

    def read_json(self, max_bytes: int = JSON_MAX_BYTES) -> dict | None:
        # Tandai body sudah ditangani agar drain_body() tidak membacanya dua kali.
        self._body_done = True
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > max_bytes:
            # Body tetap harus dibaca habis, kalau tidak klien yang masih
            # mengirim akan mendapat broken pipe alih-alih pesan 413.
            self.drain(length)
            raise ValueError(f"Data terlalu besar. Maksimal {max_bytes // (1024 * 1024)} MB.")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Body harus JSON valid.")
        return data if isinstance(data, dict) else {}

    def drain(self, length: int, chunk: int = 65536) -> None:
        """Baca dan buang sisa body agar koneksi tidak broken pipe."""
        self._body_done = True
        remaining = length
        while remaining > 0:
            data = self.rfile.read(min(chunk, remaining))
            if not data:
                break
            remaining -= len(data)

    def handle_one_request(self):
        # Bendera body harus diulang tiap permintaan: satu koneksi keep-alive
        # melayani banyak permintaan dengan instance handler yang sama.
        self._body_done = False
        super().handle_one_request()

    def drain_body(self, max_bytes: int = 8 * 1024 * 1024) -> None:
        """Buang body yang belum dibaca sebelum membalas.

        Tanpa ini, body permintaan akan ikut terbaca sebagai baris permintaan
        berikutnya pada koneksi keep-alive, sehingga klien menerima halaman
        error HTML Python (400/501 "Unsupported method") alih-alih JSON.
        """
        if getattr(self, "_body_done", False):
            return
        self._body_done = True
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            # Panjang tidak diketahui; lebih aman menutup koneksi.
            self.close_connection = True
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return
        self.drain(min(length, max_bytes))
        if length > max_bytes:
            self.close_connection = True

    def origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urllib.parse.urlparse(origin)
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host", "")
        return parsed.netloc == host

    def session(self) -> sqlite3.Row | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(raw)
        except Exception:
            return None
        morsel = cookie.get(COOKIE_NAME)
        if not morsel:
            return None
        row = session_info(morsel.value)
        if row:
            db().execute("UPDATE sessions SET terakhir=? WHERE token=?", (now(), row["token"]))
        return row

    def require_session(self) -> sqlite3.Row | None:
        row = self.session()
        if row is None:
            self.send_json(401, {"error": "Sesi berakhir. Silakan masuk kembali."})
        return row

    def send_json(self, status: int, payload: dict, headers: dict | None = None) -> None:
        self.drain_body()
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
                         "img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
                         f"connect-src 'self' {'https:' if self.is_https() else ''}")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)
        if status >= 400:
            self.log_problem(status)

    def log_problem(self, status: int) -> None:
        """Catat kegagalan ke journal (tanpa verbose) agar mudah ditelusuri."""
        try:
            path = urllib.parse.urlparse(self.path).path
        except Exception:
            path = "-"
        agent = (self.headers.get("User-Agent") or "-")[:60].replace("\n", " ")
        print(f"[dompetku] {self.command} {path} -> {status} dari {self.client_address[0]} ua={agent}",
              file=sys.stderr, flush=True)

    def send_error(self, code, message=None, explain=None):  # noqa: D102
        """Balas sebagai JSON, bukan halaman HTML bawaan Python."""
        note = str(message) if message else "Permintaan tidak valid."
        if explain:
            note = f"{note} ({explain})"
        headers = {"Connection": "close"}
        if code == 405:
            headers["Allow"] = ALLOWED_METHODS
        self.close_connection = True
        self.send_json(code, {"error": note}, headers=headers)

    def __getattr__(self, name: str):
        """Tangkap method HTTP tak dikenal -> JSON 501, bukan HTML 501."""
        if name.startswith("do_"):
            method = name[3:]
            return lambda: self.unsupported_method(method)
        raise AttributeError(name)

    def unsupported_method(self, method: str) -> None:
        self.close_connection = True
        self.send_json(501, {"error": f"Metode {method} tidak didukung."},
                       headers={"Connection": "close", "Allow": ALLOWED_METHODS})

    def do_OPTIONS(self):  # noqa: N802
        self.drain_body()
        self.send_response(204)
        self.send_header("Allow", ALLOWED_METHODS)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def send_bytes(self, body: bytes, content_type: str, status: int = 200, cache: str = "no-cache",
                   headers: dict | None = None) -> None:
        self.drain_body()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def guard(self) -> bool:
        if not self.origin_ok():
            self.send_json(403, {"error": "Asal permintaan tidak diizinkan."})
            return False
        return True

    # routing

    def split_api(self, path: str) -> tuple[bool, str]:
        """Deteksi endpoint API berdasarkan segmen path, bukan substring."""
        parts = [p for p in urllib.parse.unquote(path).split("/") if p]
        if parts and parts[-1].lower() == "api":
            return True, ""
        if len(parts) >= 2 and parts[-2].lower() == "api":
            return True, parts[-1].lower()
        return False, ""

    def route(self, method: str) -> None:
        path = urllib.parse.urlparse(self.path).path
        is_api, action = self.split_api(path)
        if is_api:
            return self.handle_api(method, action)
        if method in {"GET", "HEAD"}:
            return self.serve_static(path)
        self.send_error(405, "Method Not Allowed")

    def do_GET(self):  # noqa: N802
        self.route("GET")

    def do_HEAD(self):  # noqa: N802
        self.route("HEAD")

    def do_POST(self):  # noqa: N802
        self.route("POST")

    def do_PATCH(self):  # noqa: N802
        self.route("PATCH")

    def do_PUT(self):  # noqa: N802
        self.route("PUT")

    def do_DELETE(self):  # noqa: N802
        self.route("DELETE")

    # static

    def resolve_static(self, path: str) -> Path | None:
        relative = urllib.parse.unquote(path).lstrip("/")
        if not relative or relative.endswith("/"):
            relative += "index.html"
        target = (ROOT / relative).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            return None
        if target.is_dir():
            target = (target / "index.html").resolve()
        if not target.is_file():
            return None
        if target.name in SKIP_FILES or target.parts[len(ROOT.parts)] in SKIP_DIRS:
            return None
        return target

    def serve_static(self, path: str) -> None:
        target = self.resolve_static(path)
        if target is None:
            if Path(urllib.parse.unquote(path)).suffix:
                return self.send_error(404, "Tidak ditemukan")
            fallback = self.resolve_static("/index.html")
            if fallback is None:
                return self.send_error(404, "Tidak ditemukan")
            body = fallback.read_bytes()
            return self.send_bytes(body, STATIC_TYPES[".html"])
        suffix = target.suffix.lower()
        content_type = STATIC_TYPES.get(suffix) or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.name in NO_STORE:
            cache = "no-store"
        elif suffix in NO_CACHE:
            cache = "no-cache"
        else:
            cache = "public, max-age=3600"
        self.send_bytes(target.read_bytes(), content_type, cache=cache)

    # api

    def handle_api(self, method: str, action: str = "") -> None:
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            handler = getattr(self, f"api_{action.replace('-', '_')}", None)
            if handler is None:
                return self.send_json(404, {"error": "Endpoint tidak dikenal."})
            handler(method, query)
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:  # pragma: no cover
            import traceback

            traceback.print_exc()
            self.send_json(500, {"error": f"Kesalahan server: {exc}"})

    def api_health(self, method: str, query: dict) -> None:
        self.send_json(200, {
            "status": "ok",
            "version": APP_VERSION,
            "sessions": {"used": len(active_sessions()), "max": MAX_SESSIONS},
            "ocr": ocr_status(),
        })

    def api_slots(self, method: str, query: dict) -> None:
        used = len(active_sessions())
        self.send_json(200, {"used": used, "max": MAX_SESSIONS, "available": max(0, MAX_SESSIONS - used)})

    def api_session(self, method: str, query: dict) -> None:
        row = self.require_session()
        if row is None:
            return
        sessions = [
            {
                "token": s["token"][:8] + "…",
                "username": s["username"],
                "sejak": iso(s["dibuat"]),
                "terakhir": iso(s["terakhir"]),
                "perangkat": s["perangkat"],
                "alamat": s["alamat"],
                "ini": s["token"] == row["token"],
            }
            for s in active_sessions()
        ]
        self.send_json(200, {
            "user": {"username": row["username"]},
            "slots": {"used": len(sessions), "max": MAX_SESSIONS},
            "sessions": sessions,
            "handshake": SESSION_HANDSHAKE,
        })

    def api_login(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        if method != "POST":
            return self.send_json(405, {"error": "Method tidak diizinkan."})
        data = self.read_json() or {}
        username = normalize_username(data.get("username", ""))
        password = str(data.get("password", ""))
        key = f"{self.address()}|{username}"
        now_ts = now()
        with ATTEMPTS_LOCK:
            bucket = ATTEMPTS[key]
            while bucket and bucket[0] < now_ts - LOGIN_WINDOW:
                bucket.popleft()
            if len(bucket) >= LOGIN_ATTEMPTS:
                retry = int(LOGIN_WINDOW - (now_ts - bucket[0]))
                return self.send_json(429, {"error": f"Terlalu banyak percobaan. Coba lagi dalam {retry // 60 + 1} menit."})

        user = db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not user or not verify_password(password, user["salt"], user["pass_hash"]):
            with ATTEMPTS_LOCK:
                ATTEMPTS[key].append(now_ts)
            return self.send_json(401, {"error": "Username atau password salah."})

        with ATTEMPTS_LOCK:
            ATTEMPTS.pop(key, None)

        sessions = active_sessions()
        current = self.session()
        returning = current if current and any(s["token"] == current["token"] for s in sessions) else None
        if returning:
            db().execute("UPDATE sessions SET terakhir=? WHERE token=?", (now(), returning["token"]))
            token = returning["token"]
        else:
            if len(sessions) >= MAX_SESSIONS:
                return self.send_json(409, {
                    "error": f"Kuota {MAX_SESSIONS} sesi sudah penuh. Keluar dari salah satu perangkat lalu coba lagi.",
                    "sessions": [{"username": s["username"], "perangkat": s["perangkat"], "sejak": iso(s["dibuat"])} for s in sessions],
                    "detail": "; ".join(f"{s['username']} ({s['perangkat']})" for s in sessions),
                })
            token = create_session(user["username"], self.address(), self.device())
        cookie = (
            f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_COOKIE_AGE}"
            + ("; Secure" if self.is_https() else "")
        )
        self.send_json(200, {"user": {"username": user["username"]}, "handshake": SESSION_HANDSHAKE},
                       headers={"Set-Cookie": cookie})

    def api_logout(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        row = self.require_session()
        if row is None:
            return
        data = self.read_json() or {}
        scope = str(data.get("scope", "self"))
        conn = db()
        if scope == "all":
            conn.execute("DELETE FROM sessions")
        elif scope == "others":
            conn.execute("DELETE FROM sessions WHERE token<>?", (row["token"],))
        else:
            conn.execute("DELETE FROM sessions WHERE token=?", (row["token"],))
        cookie = f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
        self.send_json(200, {"ok": True}, headers={"Set-Cookie": cookie})

    def api_password(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        row = self.require_session()
        if row is None:
            return
        data = self.read_json() or {}
        current = str(data.get("current", ""))
        new_password = str(data.get("next", ""))
        if len(new_password) < MIN_PASSWORD_LENGTH:
            return self.send_json(400, {"error": f"Password baru minimal {MIN_PASSWORD_LENGTH} karakter."})
        user = db().execute("SELECT * FROM users WHERE username=?", (row["username"],)).fetchone()
        if not verify_password(current, user["salt"], user["pass_hash"]):
            return self.send_json(401, {"error": "Password lama tidak cocok."})
        salt, digest = hash_password(new_password)
        db().execute("UPDATE users SET salt=?, pass_hash=?, diubah=? WHERE username=?",
                     (salt, digest, now(), user["username"]))
        db().execute("DELETE FROM sessions WHERE token<>?", (row["token"],))
        self.send_json(200, {"ok": True, "message": "Password diperbarui. Sesi di perangkat lain telah dikeluarkan."})

    def api_state(self, method: str, query: dict) -> None:
        if self.require_session() is None:
            return
        state = read_state()
        try:
            since = int((query.get("rev") or ["0"])[0])
        except ValueError:
            since = 0
        if since and since == state["rev"]:
            return self.send_json(200, {"unchanged": True, "rev": state["rev"]})
        self.send_json(200, state)

    def api_transaction(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        row = self.require_session()
        if row is None:
            return
        data = self.read_json() or {}
        if method == "POST":
            existing = db().execute("SELECT * FROM transactions WHERE id=?", (str(data.get("id", "")),)).fetchone()
            tx = normalize_transaction(data, existing)
            saved = upsert_transaction(tx, row["username"])
            rev = bump_rev()
            return self.send_json(201, {"transaction": saved, "rev": rev})
        if method == "PATCH":
            existing = db().execute("SELECT * FROM transactions WHERE id=?", (str(data.get("id", "")),)).fetchone()
            if not existing:
                return self.send_json(404, {"error": "Transaksi tidak ditemukan."})
            tx = normalize_transaction(data, existing)
            saved = upsert_transaction(tx, row["username"])
            rev = bump_rev()
            return self.send_json(200, {"transaction": saved, "rev": rev})
        if method == "DELETE":
            identifier = str(data.get("id") or (query.get("id") or [""])[0])
            conn = db()
            cur = conn.execute("DELETE FROM transactions WHERE id=?", (identifier,))
            if cur.rowcount == 0:
                return self.send_json(404, {"error": "Transaksi tidak ditemukan."})
            rev = bump_rev()
            return self.send_json(200, {"ok": True, "rev": rev})
        self.send_json(405, {"error": "Method tidak diizinkan."})

    def api_transactions(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        if self.require_session() is None:
            return
        if method != "GET":
            return self.send_json(405, {"error": "Method tidak diizinkan."})
        rows = db().execute("SELECT * FROM transactions ORDER BY tanggal DESC, dibuat DESC").fetchall()
        self.send_json(200, {"rev": current_rev(), "transactions": [dict(r) for r in rows]})

    def api_settings(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        if self.require_session() is None:
            return
        if method == "GET":
            return self.send_json(200, {"settings": get_settings(), "rev": current_rev()})
        if method in {"PUT", "POST", "PATCH"}:
            data = self.read_json() or {}
            settings = set_settings(data.get("settings") if isinstance(data.get("settings"), dict) else data)
            rev = bump_rev()
            return self.send_json(200, {"settings": settings, "rev": rev})
        self.send_json(405, {"error": "Method tidak diizinkan."})

    def api_import(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        row = self.require_session()
        if row is None:
            return
        if method != "POST":
            return self.send_json(405, {"error": "Method tidak diizinkan."})
        data = self.read_json() or {}
        payload = data.get("state") if isinstance(data.get("state"), dict) else data
        if not isinstance(payload, dict):
            return self.send_json(400, {"error": "Berkas import tidak valid."})
        expenses, incomes = payload.get("expenses"), payload.get("incomes")
        if expenses is None and incomes is None:
            return self.send_json(400, {"error": "Berkas import tidak berisi transaksi."})
        if expenses is not None and not isinstance(expenses, list):
            return self.send_json(400, {"error": "Daftar pengeluaran tidak valid."})
        if incomes is not None and not isinstance(incomes, list):
            return self.send_json(400, {"error": "Daftar pemasukan tidak valid."})
        items = [item for item in (expenses or []) + (incomes or []) if isinstance(item, dict)]
        if not items:
            return self.send_json(400, {"error": "Tidak ada transaksi valid untuk diimpor."})

        imported = skipped = 0
        for item in items:
            try:
                tx = normalize_transaction(item)
            except ValueError:
                skipped += 1
                continue
            if db().execute("SELECT 1 FROM transactions WHERE id=?", (tx["id"],)).fetchone():
                skipped += 1
                continue
            upsert_transaction(tx, row["username"])
            imported += 1
        if isinstance(payload.get("settings"), dict):
            set_settings(payload["settings"])
        rev = bump_rev()
        self.send_json(200, {"ok": True, "imported": imported, "skipped": skipped, "rev": rev})

    def api_export(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        if self.require_session() is None:
            return
        if method != "GET":
            return self.send_json(405, {"error": "Method tidak diizinkan."})
        state = read_state()
        state["app"] = "dompetku"
        state["versi"] = 2
        body = json.dumps(state, ensure_ascii=False, indent=2).encode("utf-8")
        stamp = datetime.fromtimestamp(now()).strftime("%Y%m%d-%H%M")
        self.send_bytes(body, "application/json; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="dompetku-{stamp}.json"'})

    def api_ocr(self, method: str, query: dict) -> None:
        """Terima foto struk (data URL) -> teks OCR + draf item.

        Wajib sesi: endpoint ini mahal (CPU tesseract) dan tidak boleh
        dipakai tanpa login.
        """
        if not self.guard():
            return
        if self.require_session() is None:
            return
        if method != "POST":
            return self.send_json(405, {"error": "Method tidak diizinkan."})
        data = self.read_json(max_bytes=OCR_MAX_JSON_BYTES) or {}
        raw, extension = decode_image(data.get("image"))
        try:
            psm = int(data.get("psm") or 6)
        except (TypeError, ValueError):
            raise ValueError("Mode OCR tidak valid.")
        if psm not in {3, 4, 6, 11, 12}:
            psm = 6
        try:
            result = ocr_receipt(raw, extension, psm)
        except OCRUnavailable as exc:
            return self.send_json(503, {"error": str(exc), "ocr": ocr_status()})
        self.send_json(200, {"ok": True, **result})

    def api_receipt_parse(self, method: str, query: dict) -> None:
        """Parse ulang teks OCR yang sudah dikoreksi user.

        Dipakai setiap kali pengguna menyunting teks mentah di sheet
        konfirmasi, supaya draf item ikut menyesuaikan.
        """
        if not self.guard():
            return
        if self.require_session() is None:
            return
        if method != "POST":
            return self.send_json(405, {"error": "Method tidak diizinkan."})
        data = self.read_json() or {}
        text = data.get("text")
        if not isinstance(text, str):
            raise ValueError("Teks struk tidak valid.")
        if len(text) > 20_000:
            raise ValueError("Teks struk terlalu panjang.")
        self.send_json(200, {"ok": True, "parsed": receipt.parse_receipt(text)})

    def api_reset(self, method: str, query: dict) -> None:
        if not self.guard():
            return
        row = self.require_session()
        if row is None:
            return
        if method != "POST":
            return self.send_json(405, {"error": "Method tidak diizinkan."})
        data = self.read_json() or {}
        if str(data.get("confirm", "")).strip().upper() != RESET_CONFIRM:
            return self.send_json(400, {"error": f"Ketik {RESET_CONFIRM} untuk memastikan penghapusan."})
        db().execute("DELETE FROM transactions")
        rev = bump_rev()
        self.send_json(200, {"ok": True, "rev": rev})


# --- cli --------------------------------------------------------------------


def read_password(prompt: str) -> str:
    """Baca password tanpa ditampilkan.

    `--password-stdin` membaca dari pipe supaya password tidak pernah
    muncul di daftar proses (ps) maupun riwayat shell.
    """
    if os.environ.get("DOMPETKU_PASSWORD_STDIN") or not sys.stdin.isatty():
        return sys.stdin.readline().rstrip("\n")
    import getpass

    return getpass.getpass(prompt)


def cmd_user(args) -> None:
    if not args.action:
        raise SystemExit("Pakai: user list | add <nama> | passwd <nama> | rm <nama>")
    if args.action == "list":
        rows = db().execute("SELECT username, dibuat, diubah FROM users ORDER BY username").fetchall()
        if not rows:
            print("Belum ada user.")
            return
        for row in rows:
            sessions = db().execute("SELECT COUNT(*) AS n FROM sessions WHERE username=?", (row["username"],)).fetchone()["n"]
            print(f"- {row['username']:<12} diubah={datetime.fromtimestamp(row['diubah']).date()} sesi_aktif={sessions}")
        return
    if args.action == "add":
        password = args.password or os.environ.get("DOMPETKU_DEFAULT_PASSWORD", DEFAULT_PASSWORD)
        create_user(args.name, password)
        print(f"User '{normalize_username(args.name)}' dibuat.")
        return
    if args.action == "passwd":
        password = args.password or read_password(f"Password baru untuk {args.name}: ")
        if not password:
            raise SystemExit("Password tidak boleh kosong.")
        if len(password) < 8:
            raise SystemExit("Password minimal 8 karakter.")
        username = normalize_username(args.name)
        user = db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not user:
            raise SystemExit(f"User '{username}' tidak ada.")
        salt, digest = hash_password(password)
        db().execute(
            "UPDATE users SET salt=?, pass_hash=?, diubah=? WHERE username=?", (salt, digest, now(), username)
        )
        db().execute("DELETE FROM sessions WHERE username=?", (username,))
        print(f"Password '{username}' diperbarui, semua sesinya dikeluarkan.")
        return
    if args.action == "rm":
        username = normalize_username(args.name)
        db().execute("DELETE FROM users WHERE username=?", (username,))
        print(f"User '{username}' dihapus.")
        return


def cmd_sessions(args) -> None:
    rows = active_sessions()
    if not rows:
        print("Tidak ada sesi aktif.")
        return
    for row in rows:
        print(f"- {row['username']:<10} token={row['token'][:12]}… perangkat={row['perangkat']} sejak={datetime.fromtimestamp(row['dibuat']).isoformat(timespec='minutes')}")
    if args.action == "revoke":
        db().execute("DELETE FROM sessions WHERE token LIKE ?", (f"{args.token}%",))
        print(f"Sesi {args.token} dicabut.")


def cmd_ocr(args) -> None:
    """Cek kesiapan OCR, atau uji OCR dari terminal."""
    status = ocr_status()
    if not args.path:
        print(f"tesseract : {tesseract_binary() or 'belum terpasang'}")
        print(f"bahasa   : {status['lang'] or '-'} (terpasang: {', '.join(status['installed']) or '-'})")
        if status["missing"]:
            print(f"perlu    : {status['hint']}")
        print(f"siap     : {'ya' if status['available'] else 'belum'}")
        if not status["available"]:
            raise SystemExit(1)
        return

    path = Path(args.path)
    if not path.is_file():
        raise SystemExit(f"Berkas '{path}' tidak ada.")
    raw = path.read_bytes()
    extension = {".jpg": ".jpg", ".jpeg": ".jpg", ".png": ".png", ".webp": ".webp"}.get(
        path.suffix.lower(), ".png"
    )
    if len(raw) > OCR_MAX_BYTES:
        raise SystemExit(f"Ukuran berkas maksimal {OCR_MAX_BYTES // (1024 * 1024)} MB.")
    try:
        result = ocr_receipt(raw, extension, args.psm)
    except (OCRUnavailable, ValueError) as exc:
        raise SystemExit(str(exc))
    parsed = result["parsed"]
    print(f"--- teks OCR ({result['engine']['lang']}, {result['engine']['elapsed_ms']} ms) ---")
    print(result["text"])
    print(f"--- draf: {parsed['merchant']['value'] or '-'} | {parsed['date']['value'] or '-'} | "
          f"total {parsed['total']['value']} ({parsed['total'].get('source')}) ---")
    for item in parsed["items"]:
        flag = " (perlu dicek)" if item["low_confidence"] else ""
        print(f"  - {item['label']}: {item['amount']}{flag}")
    for warning in parsed["warnings"]:
        print(f"  ! {warning['field']}: {warning['message']}")


def serve(args) -> None:
    init_db()
    host, port = args.host, args.port
    if not 0 < port < 65536:
        raise SystemExit("Port tidak valid.")
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    shown = "localhost" if host in {"0.0.0.0", ""} else host
    print(f"[dompetku] berjalan di http://{shown}:{port}  (root: {ROOT})")
    print(f"[dompetku] maksimal {MAX_SESSIONS} sesi login aktif, password awal: {DEFAULT_PASSWORD}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[dompetku] dihentikan.")
    finally:
        httpd.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Server DompetKu")
    sub = parser.add_subparsers(dest="command")

    serve_parser = sub.add_parser("serve")
    serve_parser.add_argument("--host", default=os.environ.get("DOMPETKU_HOST", "0.0.0.0"))
    serve_parser.add_argument("--port", type=int, default=int(os.environ.get("DOMPETKU_PORT", "8090")))

    user_parser = sub.add_parser("user")
    user_parser.add_argument("action", choices=["list", "add", "passwd", "rm"], nargs="?")
    user_parser.add_argument("name", nargs="?")
    user_parser.add_argument("--password", help="-password baru (opsional, hindari: terlihat di ps)")
    user_parser.add_argument("--password-stdin", action="store_true",
                             help="baca password baru dari stdin agar tidak masuk riwayat/ps")

    session_parser = sub.add_parser("sessions")
    session_parser.add_argument("action", nargs="?", choices=["revoke"])
    session_parser.add_argument("token", nargs="?")

    ocr_parser = sub.add_parser("ocr", help="cek/uji mesin OCR struk")
    ocr_parser.add_argument("path", nargs="?", help="gambar struk (jpg/png/webp)")
    ocr_parser.add_argument("--psm", type=int, default=6, help="mode layout tesseract (default 6)")

    args = parser.parse_args()
    init_db()
    if args.command == "user":
        cmd_user(args)
    elif args.command == "sessions":
        cmd_sessions(args)
    elif args.command == "ocr":
        cmd_ocr(args)
    elif args.command == "serve":
        serve(args)
    else:
        args.host = os.environ.get("DOMPETKU_HOST", "0.0.0.0")
        args.port = int(os.environ.get("DOMPETKU_PORT", "8090"))
        serve(args)


if __name__ == "__main__":
    main()