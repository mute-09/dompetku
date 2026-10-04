/* Pindai struk belanja: ambil foto -> OCR di server -> koreksi -> simpan.
 *
 * Aturan penting: hasil OCR TIDAK PERNAH langsung disimpan. Setiap hasil
 * opensheet review menampilkan teks mentah, field yang ditandai meragukan,
 * dan daftar item yang bisa diedit, dicentang, atau dihapus.
 */

import { api, ApiError } from './api.js';
import * as store from './store.js';
import { openSheet, toast } from './ui.js';
import { CATEGORIES } from './store.js';
import {
  ICONS,
  clearNode,
  el,
  formatNominalInput,
  formatRupiah,
  parseNominalInput,
  svgIcon,
  todayStr
} from './utils.js';

const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;
const LOW_CONFIDENCE = 72;

/* --- tebakan kategori (bisa diubah pengguna) ------------------------------ */

const CATEGORY_HINTS = [
  { id: 'Makanan', words: ['resto', 'restoran', 'cafe', 'warung', 'kedai', 'makan', 'bakso', 'sate', 'nasi', 'warteg', 'kafe', 'mcd', 'kfc'] },
  { id: 'Belanja', words: ['indomaret', 'alfamart', 'super', 'mart', 'minimarket', 'swalayan', 'belanja', 'carrefour', 'alfamart', 'lottomart', 'trans'] },
  { id: 'Kesehatan', words: ['apotek', 'klinik', 'clinic', 'hospital', 'rumah sakit', 'farmasi', 'bpjs'] },
  { id: 'Transportasi', words: ['pertamina', 'shell', 'pertashop', 'bensin', 'tol', 'parkir', 'gojek', 'grab', 'uber'] },
  { id: 'Tagihan', words: ['pln', 'listrik', 'pulsa', 'vodafone', 'telkomsel', 'indihome', 'wifi', 'internet', 'token'] },
  { id: 'Pendidikan', words: ['spp', 'sekolah', 'kampus', 'buku', 'atk', 'universitas'] }
];

/** Tebakan kategori dari isi struk; selalu bisa diganti pengguna. */
export function guessCategory(haystack) {
  const text = String(haystack || '').toLowerCase();
  if (!text.trim()) return 'Belanja';
  let best = null;
  CATEGORY_HINTS.forEach((hint) => {
    hint.words.forEach((word) => {
      if (text.includes(word) && (!best || word.length > best.length)) best = word;
    });
  });
  return best ? CATEGORY_HINTS.find((hint) => hint.words.includes(best)).id : 'Belanja';
}

/* --- draf item ------------------------------------------------------------- */

/**
 * Ubah hasil parser server menjadi daftar draf yang bisa diedit.
 * Setiap baris membawa `checked` (default aktif) dan `suspect` (perlu dicek).
 */
export function buildDraft(parsed, { rawText = '' } = {}) {
  const rows = Array.isArray(parsed?.items) ? parsed.items : [];
  const items = rows.map((item) => ({
    id: `${item.line ?? 'x'}-${item.label}-${item.amount}`,
    label: item.label || '',
    amount: Number(item.amount) || 0,
    qty: item.qty ?? null,
    suspect: Boolean(item.low_confidence),
    checked: true
  }));
  return {
    merchant: parsed?.merchant?.value || '',
    date: parsed?.date?.value || todayStr(),
    total: Number(parsed?.total?.value) || 0,
    totalSuspect: !parsed?.total?.value || parsed?.total?.source === 'tebakan' || !rawText,
    dateSuspect: !parsed?.date?.value,
    items,
    warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : [],
    rawText,
    confidence: parsed?.confidence ?? null,
    lowConfidence: Boolean(parsed?.low_confidence)
  };
}

/* --- prepping gambar ------------------------------------------------------- */

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gambar tidak bisa dibaca.'));
    reader.readAsDataURL(file);
  });
}

/** Perkecil foto di browser supaya unggahan ringan dan OCR lebih akurat. */
async function prepareImage(file) {
  const raw = await readAsDataUrl(file);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    if (scale === 1) return raw;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return raw;
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    return raw;
  }
}

/* --- sheet konfirmasi ------------------------------------------------------ */

function itemRow(row, { onChange, onRemove }) {
  const amountInput = el('input', {
    class: 'rcpt__amount-input',
    type: 'text',
    inputmode: 'numeric',
    value: formatNominalInput(row.amount),
    'aria-label': `Nominal ${row.label || 'item'}`
  });

  amountInput.addEventListener('input', () => {
    onChange({ amount: parseNominalInput(amountInput.dataset.raw ?? '') || 0 });
  });

  const labelInput = el('input', {
    class: 'rcpt__label-input',
    type: 'text',
    maxlength: '60',
    value: row.label,
    placeholder: 'Nama barang',
    'aria-label': 'Nama barang'
  });

  labelInput.addEventListener('input', () => onChange({ label: labelInput.value }));

  const check = el('input', { type: 'checkbox', class: 'rcpt__check', checked: row.checked });
  check.addEventListener('change', () => onChange({ checked: check.checked }));

  return el('label', { class: `rcpt__row${row.suspect ? ' is-suspect' : ''}` }, [
    check,
    el('span', { class: 'rcpt__row-main' }, [
      labelInput,
      el('span', { class: 'rcpt__row-meta' }, [
        row.qty ? el('span', { class: 'rcpt__qty', text: `${row.qty}×` }) : null,
        row.suspect
          ? el('span', { class: 'rcpt__warn', title: `Keyakinan OCR rendah (${row.confidence ?? '?'}%)` },
              [svgIcon(ICONS.alert, 13), 'Perlu dicek'])
          : null
      ])
    ]),
    el('span', { class: 'rcpt__row-amount' }, [el('span', { class: 'rcpt__rp', text: 'Rp' }), amountInput]),
    el('button', {
      class: 'icon-btn icon-btn--sm rcpt__remove',
      type: 'button',
      'aria-label': `Hapus ${row.label || 'baris'}`,
      onClick: (event) => {
        event.preventDefault();
        onRemove();
      }
    }, [svgIcon(ICONS.trash, 16)])
  ]);
}

/**
 * Sheet review: user wajib mengoreksi sebelum data disimpan.
 * @returns {{close: Function}}
 */
export function openReceiptReview({ result, onSaved }) {
  let draft = buildDraft(result?.parsed, { rawText: result?.text || '' });
  let reparseTimer = null;
  let reparsePending = false;

  const metaWrap = el('div', { class: 'rcpt__meta' });
  const warningsWrap = el('div', { class: 'rcpt__warnings' });
  const itemsWrap = el('div', { class: 'rcpt__items' });
  const rawWrap = el('details', { class: 'disclosure rcpt__raw' });
  const summaryBar = el('div', { class: 'rcpt__summary' });
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'button' }, ['Simpan']);
  const categoryWrap = el('div', { class: 'chips chips--sm rcpt__cats' });
  let category = guessCategory(`${draft.merchant} ${draft.items.map((i) => i.label).join(' ')}`);

  function checkedItems() {
    return draft.items.filter((item) => item.checked && item.amount > 0 && item.label.trim());
  }

  function sumChecked() {
    return checkedItems().reduce((total, item) => total + item.amount, 0);
  }

  function markSuspect(input, suspect) {
    input.classList.toggle('is-suspect', Boolean(suspect));
    const field = input.closest('.field');
    if (field) field.classList.toggle('is-suspect', Boolean(suspect));
  }

  function renderMeta() {
    clearNode(metaWrap);

    const merchantInput = el('input', {
      class: 'field__control',
      type: 'text',
      maxlength: '60',
      value: draft.merchant,
      placeholder: 'Nama toko',
      'aria-label': 'Nama toko'
    });
    merchantInput.addEventListener('input', () => { draft.merchant = merchantInput.value; });

    const dateInput = el('input', {
      class: 'field__control field__control--date',
      type: 'date',
      value: draft.date || todayStr(),
      'aria-label': 'Tanggal struk'
    });
    dateInput.addEventListener('change', () => { draft.date = dateInput.value || todayStr(); });

    const totalInput = el('input', {
      class: 'field__control',
      type: 'text',
      inputmode: 'numeric',
      value: formatNominalInput(draft.total),
      'aria-label': 'Total struk'
    });
    totalInput.addEventListener('input', () => {
      draft.total = parseNominalInput(totalInput.dataset.raw ?? '') || 0;
      renderSummary();
    });

    markSuspect(merchantInput, !draft.merchant);
    markSuspect(dateInput, draft.dateSuspect);
    markSuspect(totalInput, draft.totalSuspect);

    metaWrap.append(
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label' }, ['Toko', draft.dateSuspect || !draft.merchant ? suspectTag('cek manual') : null]),
        merchantInput
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label' }, ['Tanggal', draft.dateSuspect ? suspectTag('tidak terbaca') : null]),
        dateInput
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label' }, ['Total struk', draft.totalSuspect ? suspectTag('perlu dicek') : null]),
        totalInput
      ])
    );
  }

  function suspectTag(text) {
    return el('span', { class: 'rcpt__tag' }, [svgIcon(ICONS.alert, 12), text]);
  }

  function renderWarnings() {
    clearNode(warningsWrap);
    const messages = [];
    if (draft.lowConfidence) {
      messages.push(`Keyakinan OCR rendah${draft.confidence != null ? ` (${draft.confidence}%)` : ''}. Periksa nominal satu per satu.`);
    }
    (draft.warnings || []).forEach((warning) => messages.push(warning.message));
    const checkedSum = sumChecked();
    if (draft.total && checkedSum && checkedSum !== draft.total) {
      messages.push(`Jumlah item terpilih Rp ${checkedSum.toLocaleString('id-ID')} berbeda dari total struk Rp ${draft.total.toLocaleString('id-ID')}.`);
    }
    if (!messages.length) return;
    messages.forEach((message) => {
      warningsWrap.append(
        el('p', { class: 'rcpt__warning' }, [svgIcon(ICONS.alert, 14), message])
      );
    });
  }

  function renderItems() {
    clearNode(itemsWrap);
    if (!draft.items.length) {
      itemsWrap.append(
        el('p', { class: 'rcpt__empty', text: 'Tidak ada baris barang yang terbaca. Sunting teks OCR di bawah atau tambahkan baris manual.' })
      );
    }
    draft.items.forEach((row) => {
      itemsWrap.append(
        itemRow(row, {
          onChange(patch) {
            Object.assign(row, patch);
            if ('checked' in patch || 'amount' in patch) {
              renderSummary();
              renderWarnings();
            }
          },
          onRemove() {
            draft.items = draft.items.filter((item) => item.id !== row.id);
            renderItems();
            renderSummary();
            renderWarnings();
          }
        })
      );
    });
    itemsWrap.append(
      el('button', {
        class: 'btn btn--ghost btn--block rcpt__add',
        type: 'button',
        onClick: () => {
          draft.items.push({
            id: `manual-${Date.now()}`,
            label: '',
            amount: 0,
            qty: null,
            suspect: true,
            checked: true
          });
          renderItems();
          renderSummary();
        }
      }, [svgIcon(ICONS.plus, 16), 'Tambah baris'])
    );
  }

  function renderCategories() {
    clearNode(categoryWrap);
    CATEGORIES.forEach((option) => {
      const chip = el('button', {
        class: `chip chip--sm${option.id === category ? ' is-active' : ''}`,
        type: 'button',
        title: option.label,
        dataset: { value: option.id }
      }, [el('span', { class: 'chip__label', text: option.label })]);
      chip.addEventListener('click', () => {
        category = option.id;
        renderCategories();
      });
      categoryWrap.append(chip);
    });
  }

  function renderSummary() {
    const count = checkedItems().length;
    const sum = sumChecked();
    clearNode(summaryBar);
    summaryBar.append(
      el('span', { text: count ? `${count} item · ${formatRupiah(sum)}` : 'Belum ada item dipilih' })
    );
    saveBtn.textContent = count ? `Simpan ${count} item` : 'Simpan';
    saveBtn.disabled = count === 0;
    renderWarnings();
  }

  function renderRaw() {
    clearNode(rawWrap);
    const textarea = el('textarea', {
      class: 'rcpt__raw-text',
      rows: '10',
      spellcheck: 'false',
      'aria-label': 'Teks hasil OCR'
    });
    textarea.value = draft.rawText;

    const applyBtn = el('button', { class: 'btn btn--ghost', type: 'button' }, ['Terapkan ulang']);
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Menerjemahkan…';
      try {
        const response = await api.parseReceipt(textarea.value);
        draft = buildDraft(response.parsed, { rawText: textarea.value });
        renderMeta();
        renderItems();
        renderCategories();
        renderSummary();
        toast({ message: 'Draf diperbarui dari teks yang disunting.', tone: 'good' });
      } catch (err) {
        toast({ message: err.message || 'Gagal membaca ulang teks.', tone: 'warn' });
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Terapkan ulang';
      }
    });

    textarea.addEventListener('input', () => {
      draft.rawText = textarea.value;
      if (reparsePending) return;
      reparsePending = true;
      clearTimeout(reparseTimer);
      // Debounce: parse ulang diam-diam supaya draf ikut mengikuti suntingan.
      reparseTimer = setTimeout(async () => {
        reparsePending = false;
        try {
          const response = await api.parseReceipt(draft.rawText);
          const parsed = response.parsed;
          if (!parsed.items.length) return;
          draft.warnings = parsed.warnings || [];
          draft.total = Number(parsed.total?.value) || draft.total;
          draft.date = parsed.date?.value || draft.date;
          draft.merchant = parsed.merchant?.value || draft.merchant;
          const signature = (parsed.items || []).map((i) => `${i.label}:${i.amount}`).join('|');
          if (signature !== draft.items.map((i) => `${i.label}:${i.amount}`).join('|')) {
            draft.items = buildDraft(parsed, { rawText: draft.rawText }).items;
            renderItems();
          }
          renderMeta();
          renderCategories();
          renderSummary();
        } catch {
          /* abaikan: parse ulang hanya bonus */
        }
      }, 900);
    });

    rawWrap.append(
      el('summary', { class: 'disclosure__summary' }, [
        svgIcon(ICONS.pencil, 15),
        `Teks OCR mentah${draft.rawText ? ` (${draft.rawText.split('\n').length} baris)` : ''}`
      ]),
      el('div', { class: 'disclosure__body rcpt__raw-body' }, [
        el('p', { class: 'rcpt__hint', text: 'OCR sering salah membaca angka atau huruf. Koreksi di sini lalu pilih "Terapkan ulang" agar daftar item ikut berubah.' }),
        textarea,
        el('div', { class: 'rcpt__raw-actions' }, [applyBtn])
      ])
    );
  }

  async function save() {
    const items = checkedItems();
    if (!items.length) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan…';
    try {
      for (const item of items) {
        await store.addTransaction({
          type: 'expense',
          kategori: category,
          tanggal: draft.date || todayStr(),
          nominal: item.amount,
          keterangan: item.label.trim().slice(0, 140),
          frekuensi: 'harian'
        });
      }
      handle.close();
      toast({
        message: `${items.length} item struk dicatat (${formatRupiah(sumChecked())}).`,
        tone: 'good'
      });
      onSaved?.(items);
    } catch (err) {
      saveBtn.disabled = false;
      renderSummary();
      toast({ message: err.message || 'Gagal menyimpan.', tone: 'warn' });
    }
  }

  saveBtn.addEventListener('click', save);

  const engine = result?.engine || {};
  const subtitle = [
    engine.lang ? `OCR ${engine.lang}` : null,
    engine.elapsed_ms != null ? `${Math.round(engine.elapsed_ms / 100) / 10}s` : null,
    draft.items.length ? `${draft.items.length} baris terbaca` : null
  ].filter(Boolean).join(' · ');

  renderMeta();
  renderCategories();
  renderItems();
  renderSummary();
  renderRaw();

  const handle = openSheet({
    title: 'Periksa hasil struk',
    subtitle: subtitle || 'OCR selesai',
    size: 'tall',
    body: el('div', { class: 'rcpt' }, [
      el('p', { class: 'rcpt__intro', text: 'Belum ada yang tersimpan. Periksa dulu hasil bacaan OCR di bawah.' }),
      warningsWrap,
      metaWrap,
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Kategori untuk semua item' }),
        categoryWrap
      ]),
      el('div', { class: 'rcpt__items-head' }, [
        el('span', { class: 'field__label', text: 'Barang & nominal' }),
        el('span', { class: 'rcpt__hint', text: 'Untick yang tidak jadi disimpan' })
      ]),
      itemsWrap,
      rawWrap,
      summaryBar
    ]),
    footer: el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => handle.close() }, ['Batal']),
      saveBtn
    ])
  });

  return handle;
}

/* --- pemicu tombol --------------------------------------------------------- */

/**
 * Pasang tombol "Pindai struk".
 * @param {object} options
 * @param {HTMLElement} options.mount tempat tombol diletakkan
 * @param {Function} options.onSaved dipanggil setelah semua item tersimpan
 * @param {Function} options.onBusy dipakai untuk mengunci tombol
 */
export function setupReceiptScanner({ mount, onSaved } = {}) {
  if (!mount) return () => {};

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp',
    class: 'rcpt__file',
    hidden: true
  });
  const cameraInput = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    class: 'rcpt__file',
    hidden: true
  });

  let busy = false;

  async function handleFile(file) {
    if (!file || busy) return;
    busy = true;
    button.disabled = true;
    let spinner = null;
    try {
      const dataUrl = await prepareImage(file);
      const handle = openSheet({
        title: 'Membaca struk',
        subtitle: 'Gambar dikirim ke server untuk dibaca',
        body: el('div', { class: 'rcpt__loading' }, [
          (spinner = el('span', { class: 'spinner' })),
          el('p', { text: 'OCR berjalan, mohon tunggu…' })
        ])
      });
      try {
        const result = await api.ocr(dataUrl);
        handle.close();
        openReceiptReview({ result, onSaved });
      } catch (err) {
        handle.close();
        const message = err instanceof ApiError ? err.message : 'Gagal membaca struk.';
        toast({ message, tone: 'warn', duration: 6000 });
      }
    } catch (err) {
      toast({ message: err.message || 'Gagal memproses gambar.', tone: 'warn' });
    } finally {
      if (spinner) spinner.remove();
      button.disabled = false;
      busy = false;
      fileInput.value = '';
      cameraInput.value = '';
    }
  }

  fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));
  cameraInput.addEventListener('change', () => handleFile(cameraInput.files?.[0]));

  const onPaste = (event) => {
    const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  };
  document.addEventListener('paste', onPaste);

  const button = el('button', { class: 'btn btn--ghost rcpt__scan', type: 'button' }, [
    svgIcon(ICONS.camera, 18),
    'Pindai struk'
  ]);

  button.addEventListener('click', () => {
    if ('ontouchstart' in window && navigator.maxTouchPoints > 0) cameraInput.click();
    else fileInput.click();
  });

  mount.append(button, fileInput, cameraInput);

  // Kalau mesin OCR belum terpasang di server, tombol tetap tampil tapi
  // dinonaktifkan agar pengguna tahu penyebabnya sebelum menekan.
  api.health()
    .then((health) => {
      const ocr = health?.ocr;
      if (!ocr || ocr.available !== false) return;
      button.disabled = true;
      button.title = ocr.hint || 'Mesin OCR belum siap di server.';
      button.append(el('span', { class: 'rcpt__off', text: 'belum siap' }));
    })
    .catch(() => {
      /* offline: biarkan tombol aktif, error muncul saat dipakai */
    });

  return () => {
    // Modal bisa dibuka berulang, jadi semua listener harus ikut dilepas.
    document.removeEventListener('paste', onPaste);
    button.remove();
    fileInput.remove();
    cameraInput.remove();
  };
}