"""Parser struk belanja (OCR) untuk DompetKu.

Modul ini murni stdlib dan tidak boleh mengimpor apa pun dari server.py,
supaya bisa diuji terpisah:

    python3 receipt.py contoh-struk.txt

Prinsip: hasil parser dianggap sebagai DRAF. Setiap field membawa catatan
keyakinan (`low_confidence`) supaya UI bisa menandai bagian yang perlu
dikoreksi manusia sebelum disimpan.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from datetime import date

BULAN = {
    "jan": 1, "januari": 1, "feb": 2, "februari": 2, "mar": 3, "maret": 3,
    "apr": 4, "april": 4, "mei": 5, "may": 5, "jun": 6, "juni": 6,
    "jul": 7, "juli": 7, "agu": 8, "agustus": 8, "aug": 8,
    "sep": 9, "sept": 9, "september": 9, "okt": 10, "oktober": 10, "oct": 10,
    "nov": 11, "november": 11, "des": 12, "desember": 12, "dec": 12,
}

# Baris yang bukan item belanja. Kata tunggal dipakai untuk pencocokan
# toleran salah baca OCR (mis. "TUNAT" untuk "TUNAI").
SKIP_WORDS = frozenset({
    "subtotal", "total", "ppn", "pb1", "pb11", "pajak", "diskon", "discount",
    "voucher", "promo", "potongan", "kembalian", "kembali", "change", "sisa",
    "tunai", "cash", "debit", "kredit", "kartu", "visa", "mastercard", "giro",
    "qris", "shopeepay", "gopay", "ovo", "dana", "linkaja", "permata", "transfer",
    "trf", "nota", "invoice", "faktur", "kasir", "operator", "meja", "tanggal",
    "tgl", "date", "waktu", "time", "jam", "telp", "telepon", "phone", "npwp",
    "terima", "kasih", "thank", "welcome", "powered", "www", "http", "https",
    "harga", "price", "item", "qty", "jumlah", "disc", "gratis",
})

# Frasa atau label ber punctuasi: dicocokkan sebagai batas kata.
SKIP_PHRASES = (
    "sub total", "sub-total", "total pajak", "total ppn", "no. nota", "no nota",
    "terima kasih", "thank you", "selamat jalan", "powered by", "kode pos",
    "no. telp", "harga satuan", "harga total", "grand total", "bayar",
)

# Baris yang menandai total.
TOTAL_KEYWORDS = (
    "total", "grand total", "total akhir", "total bayar", "total pembayaran",
    "total belanja", "total tagihan", "jumlah bayar", "bayar tunaiku",
)

MERCHANT_NOISE = (
    "npwp", "www", "http", "telp", "telepon", "phone", "hp", "email",
    "fax", "npwp:", "no. npwp", "kode pos", "kedalam", "ke",
)


def _keyword_pattern(keywords: tuple[str, ...]) -> re.Pattern[str]:
    """Cocokkan keyword sebagai KATA UTUH, bukan substring.

    Wajib: keyword pendek seperti "wa" dan "hp" akan salah cocok di dalam
    kata lain ("tawar", "alpha") kalau pakai `in` biasa.
    """
    parts = sorted({re.escape(k) for k in keywords}, key=len, reverse=True)
    return re.compile(r"(?<![a-z])(?:" + "|".join(parts) + r")(?![a-z])", re.IGNORECASE)


TOTAL_NEGATIVE = ("sub", "sebelum", "kembali", "hemat", "harga")
SKIP_RE = _keyword_pattern(SKIP_PHRASES)
TOTAL_RE = _keyword_pattern(TOTAL_KEYWORDS)
MERCHANT_NOISE_RE = _keyword_pattern(MERCHANT_NOISE)

ITEM_NO_PATTERN = re.compile(r"^(\d{1,3})[.)]\s+")

MAX_ITEMS = 60
MIN_ITEM_AMOUNT = 100


# --- utilitas ---------------------------------------------------------------


def clean_text(value: str) -> str:
    """Rapi whitespace & aksen tanpa mengubah huruf besar-kecil."""
    text = unicodedata.normalize("NFKC", value or "")
    text = "".join(ch for ch in text if ch == " " or not unicodedata.combining(ch))
    return re.sub(r"[ \t]+", " ", text).strip()


def parse_amount(raw: str) -> int | None:
    """Ubah angka gaya Indonesia/US menjadi rupiah bulat.

    diterima: ``Rp 1.250.000`` ``12,500`` ``45.000,50`` ``1,250.00`` ``9000``
    """
    if raw is None:
        return None
    text = unicodedata.normalize("NFKC", str(raw)).strip()
    if not text:
        return None
    text = re.sub(r"(?i)\b(rp|idr|rp\.)\b", " ", text)
    text = text.replace(" ", "")
    negative = text.startswith("-") or (text.startswith("(") and text.endswith(")"))
    text = re.sub(r"[^\d.,]", "", text)
    if not text or not re.search(r"\d", text):
        return None

    has_dot, has_comma = "." in text, "," in text
    if has_dot and has_comma:
        # Pemisah desimal = tanda baca paling kanan.
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif has_dot:
        parts = text.split(".")
        if len(parts) > 2:
            text = "".join(parts)
        elif len(parts[1]) == 3 and len(parts[0]) <= 6:
            text = "".join(parts)  # 45.000 -> 45000
        else:
            text = "".join(parts) if len(parts[0]) <= 3 else text.replace(".", "")
    elif has_comma:
        parts = text.split(",")
        if len(parts) > 1:
            text = "".join(parts)

    try:
        value = int(round(float(text)))
    except ValueError:
        return None
    if negative:
        value = -value
    return value


def _tokens(line: str) -> list[str]:
    return [t for t in re.split(r"\s{2,}|\t", line.strip()) if t]


TRAILING_NUMBER = re.compile(r"^(?P<label>.*?)\s*(?P<num>\(?-?\d[\d.,]*\)?)\s*$")
# "2 x 4.500", "2X4.500", atau "2 4.500" di ujung label = qty x harga satuan.
QTY_TAIL = re.compile(r"(?:^|\s)(?P<qty>\d{1,3})\s*(?:[xX@]|\s)\s*(?P<unit>\d[\d.,]*)\s*$")


def split_line(line: str) -> tuple[str, int | None] | None:
    """Pisahkan baris struk menjadi (label, nominal terakhir).

    Tidak mengandalkan kolom Perfect: hasil tesseract sering spasi tidak
    rapi, jadi cukup ambil angka paling kanan.
    """
    match = TRAILING_NUMBER.match(line.strip())
    if not match:
        return None
    label = clean_text(match.group("label"))
    if not label:
        return None
    return label, parse_amount(match.group("num"))


def _mean_confidence(indices: set[int], line_conf: dict[int, float] | None) -> float | None:
    if not line_conf:
        return None
    values = [line_conf[i] for i in indices if i in line_conf]
    if not values:
        return None
    return round(sum(values) / len(values), 1)


def is_low(conf: float | None, threshold: float = 72.0) -> bool:
    return conf is not None and conf < threshold


# --- tanggal ----------------------------------------------------------------


def _valid(day: int, month: int, year: int) -> str | None:
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    if not 2000 <= year <= 2100:
        return None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _expand_year(year: int) -> int:
    if year >= 1000:
        return year
    return 2000 + year if year <= 68 else 1900 + year


def find_date(lines: list[str]) -> dict | None:
    """Cari tanggal struk; mendukung gaya Indonesia dan ISO."""
    ambiguous = False
    for raw in lines:
        line = clean_text(raw)
        if not line:
            continue

        iso = re.search(r"\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b", line)
        if iso:
            found = _valid(int(iso.group(3)), int(iso.group(2)), int(iso.group(1)))
            if found:
                return {"value": found, "raw": iso.group(0)}

        dmy = re.search(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b", line)
        if dmy:
            day, month, year = int(dmy.group(1)), int(dmy.group(2)), _expand_year(int(dmy.group(3)))
            found = _valid(day, month, year)
            if found:
                if day <= 12 and month <= 12:
                    ambiguous = True
                return {"value": found, "raw": dmy.group(0), "ambiguous": ambiguous}

        text_month = re.search(
            r"\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})\b", line, re.IGNORECASE
        )
        if text_month and text_month.group(2).lower()[:3] in BULAN:
            month = BULAN[text_month.group(2).lower()[:3]]
            found = _valid(int(text_month.group(1)), month, _expand_year(int(text_month.group(3))))
            if found:
                return {"value": found, "raw": text_month.group(0)}

        month_first = re.search(
            r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b", line, re.IGNORECASE
        )
        if month_first and month_first.group(1).lower()[:3] in BULAN:
            month = BULAN[month_first.group(1).lower()[:3]]
            found = _valid(int(month_first.group(2)), month, int(month_first.group(3)))
            if found:
                return {"value": found, "raw": month_first.group(0)}
    return None


# --- merchant ---------------------------------------------------------------


def find_merchant(lines: list[str]) -> dict | None:
    """Toko biasanya di baris teratas: huruf dominan, bukan angka/date."""
    for index, raw in enumerate(lines[:8]):
        line = clean_text(raw)
        if not 3 <= len(line) <= 60:
            continue
        if MERCHANT_NOISE_RE.search(line):
            continue
        letters = sum(ch.isalpha() for ch in line)
        digits = sum(ch.isdigit() for ch in line)
        if letters < 3 or digits > len(line) / 2:
            continue
        if find_date([line]):
            continue
        if re.search(r"\b\d{1,2}[/\-.]\d{1,2}", line):
            continue
        words = line.split()
        if len(words) > 7:
            continue
        return {"value": line, "index": index}
    return None


# --- item & total -----------------------------------------------------------


def _is_skippable(low: str) -> bool:
    """Baris non-item, dengan toleransi salah baca satu huruf.

    Tesseract sering salah membaca "TUNAI" jadi "TUNAT", sehingga
    pencocokan kata memakai kedekatan karakter, bukan persis sama.
    """
    if SKIP_RE.search(low):
        return True
    for word in re.findall(r"[a-z]{3,}", low):
        if word in SKIP_WORDS:
            return True
        if len(word) >= 5 and difflib.get_close_matches(word, SKIP_WORDS, n=1, cutoff=0.8):
            return True
    return False


def _is_total_line(low: str) -> bool:
    if not TOTAL_RE.search(low):
        return False
    return not any(bad in low for bad in TOTAL_NEGATIVE)


def find_total(lines: list[str]) -> dict | None:
    """Ambil total dari baris berlabel total; fallback ke jumlah item."""
    candidates: list[tuple[int, int]] = []
    for index, raw in enumerate(lines):
        line = clean_text(raw)
        if not _is_total_line(line.lower()):
            continue
        split = split_line(line)
        if split and split[1] and split[1] > 0:
            candidates.append((index, split[1]))

    if candidates:
        best_index, best_amount = candidates[-1]
        for index, amount in candidates:
            if amount > best_amount:
                best_index, best_amount = index, amount
        return {"value": best_amount, "index": best_index, "source": "label"}

    fallback = [
        amount
        for raw in lines
        for split in [split_line(clean_text(raw))]
        if split and (amount := split[1]) and amount >= MIN_ITEM_AMOUNT
    ]
    if fallback:
        return {"value": max(fallback), "index": None, "source": "tebakan"}
    return None


def _strip_redundant_price(label: str, amount: int, qty: int | None) -> str:
    """Buang kolom harga satuan yang ikut terbaca sebagai bagian label.

    Struk berformat kolom sering menghasilkan label seperti
    "Telur Ayam 1kg 32.000 32.000" -> label cukup "Telur Ayam 1kg".
    """
    match = re.match(r"^(.*\S)\s+(\d[\d.,]*)$", label)
    if not match:
        return label
    head, tail = match.group(1), match.group(2)
    if sum(ch.isalpha() for ch in head) < 3:
        return label
    value = parse_amount(tail)
    if value is None:
        return label
    if value == amount or (qty and value * qty == amount):
        return head
    return label


def find_items(lines: list[str], line_conf: dict[int, float] | None = None,
               stop: int | None = None) -> list[dict]:
    """Baris belanja: label + nominal di ujung baris.

    Penting: baris yang tidak terbaca tidak boleh dibuat diam-diam jadi
    transaksi. Parser hanya menyiapkan draf untuk dikonfirmasi manusia.
    """
    items: list[dict] = []
    for index, raw in enumerate(lines):
        if stop is not None and index >= stop:
            break
        line = clean_text(raw)
        if not line:
            continue
        low = line.lower()
        if _is_total_line(low) or _is_skippable(low):
            continue

        split = split_line(line)
        if not split:
            continue
        label, amount = split
        qty = None
        mismatch = False

        qty_match = QTY_TAIL.search(label)
        if qty_match:
            qty_value = int(qty_match.group("qty"))
            unit_value = parse_amount(qty_match.group("unit"))
            if qty_value >= 1 and unit_value and unit_value > 0:
                computed = qty_value * unit_value
                qty = qty_value
                if amount and abs(computed - amount) > max(1, amount // 100):
                    mismatch = True
                amount = computed
                label = clean_text(label[: qty_match.start()])

        label = ITEM_NO_PATTERN.sub("", label).strip(" .-–:")
        if not amount or amount < MIN_ITEM_AMOUNT or not label:
            continue
        if sum(ch.isalpha() for ch in label) < 2:
            continue
        label = _strip_redundant_price(label, amount, qty)
        if sum(ch.isalpha() for ch in label) < 2:
            continue

        confidence = _mean_confidence({index}, line_conf)
        items.append({
            "label": re.sub(r"\s{2,}", " ", label)[:60],
            "amount": amount,
            "qty": qty,
            "line": index,
            "confidence": confidence,
            "low_confidence": is_low(confidence) or mismatch,
        })
        if len(items) >= MAX_ITEMS:
            break
    return items


def parse_receipt(text: str, line_conf: dict[int, float] | None = None) -> dict:
    """Ubah teks OCR menjadi draf struk + catatan untuk review manusia."""
    lines = [clean_text(l) for l in (text or "").splitlines()]
    total = find_total(lines)
    found_date = find_date(lines)
    merchant = find_merchant(lines)

    # Barang belanja selalu tercetak di ATAS baris total. Baris di bawah
    # total biasanya pembayaran, kembalian, atau footer terima kasih.
    boundary = total.get("index") if total and total.get("source") == "label" else None
    items = find_items(lines, line_conf, boundary)
    if boundary is None:
        items = find_items(lines, line_conf)

    warnings: list[dict] = []
    if boundary is not None and not items:
        # Tata letak tak lazim: coba tetap ambil item di bawah baris total.
        items = find_items(lines, line_conf)
        if items:
            warnings.append({
                "field": "items",
                "message": "Baris item ditemukan setelah baris TOTAL. Periksa daftar item di bawah.",
            })
    if not items:
        warnings.append({"field": "items", "message": "Tidak ada baris item yang terbaca. Isi manual atau foto ulang."})
    if not total:
        warnings.append({"field": "total", "message": "Total tidak ditemukan. Masukkan nominal sendiri."})
    elif total.get("source") == "tebakan":
        warnings.append({"field": "total", "message": "Total diperkirakan dari nominal terbesar, bukan dari label TOTAL."})
    if not found_date:
        warnings.append({"field": "date", "message": "Tanggal tidak terbaca. Default dipakai hari ini."})
    elif found_date.get("ambiguous"):
        warnings.append({"field": "date", "message": "Tanggal ambigu (bisa DD/MM atau MM/DD). Periksa manual."})
    if not merchant:
        warnings.append({"field": "merchant", "message": "Nama toko tidak terbaca."})

    item_sum = sum(i["amount"] for i in items)
    if total and items and total["value"] != item_sum:
        diff = total["value"] - item_sum
        warnings.append({
            "field": "total",
            "message": f"Total (Rp {total['value']:,}) tidak sama dengan jumlah item (Rp {item_sum:,}). Selisih Rp {abs(diff):,}.",
        })

    confidence = _mean_confidence({i["line"] for i in items}, line_conf)
    return {
        "merchant": {
            "value": merchant["value"] if merchant else "",
            "index": merchant["index"] if merchant else None,
        },
        "date": found_date or {"value": None, "raw": None},
        "total": total or {"value": None, "index": None, "source": None},
        "items": items,
        "item_sum": item_sum,
        "warnings": warnings,
        "confidence": confidence,
        "low_confidence": is_low(confidence),
    }


if __name__ == "__main__":  # pragma: no cover - alat bantu debugging manual
    import json
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Pakai: python3 receipt.py <file-struk.txt>")
    with open(sys.argv[1], encoding="utf-8") as handle:
        raw = handle.read()
    print(json.dumps(parse_receipt(raw), ensure_ascii=False, indent=2))