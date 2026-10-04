/* Tampilan transaksi yang dipakai bersama oleh halaman Catat dan Laporan:
   baris transaksi, pengelompokan per hari, sheet ubah, dan hapus. */

import { dailyAverage, resolveRange, slice } from './analytics.js';
import { createQuickForm } from './quick-form.js';
import * as store from './store.js';
import { openSheet, toast } from './ui.js';
import { ICONS, clearNode, el, formatDate, formatRupiah, relativeDayLabel, svgIcon, todayStr } from './utils.js';

/** Transaksi yang jauh di atas rata-rata harian (untuk penanda "Tidak biasa"). */
export function flaggedIds() {
  const state = store.getState();
  const baseline = dailyAverage(state, todayStr(), 30);
  if (!baseline.avg) return new Set();
  const limit = baseline.avg * state.settings.threshold;
  return new Set(
    slice(state.expenses, resolveRange({ period: 'week' }))
      .filter((tx) => tx.nominal >= limit)
      .map((tx) => tx.id)
  );
}

export function matchesQuery(tx, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [tx.keterangan, tx.kategori, tx.sumber, tx.frekuensi, formatRupiah(tx.nominal)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function filterTransactions({ filter = 'all', query = '' } = {}) {
  return store
    .allTransactions()
    .filter((tx) => (filter === 'all' ? true : tx.type === filter))
    .filter((tx) => matchesQuery(tx, query));
}

/** Satu baris transaksi: kiri keterangan + kategori, kanan jumlah. */
export function txRow(tx, flagged = new Set(), { onEdit, isNew = false } = {}) {
  const meta = tx.type === 'expense' ? store.categoryMeta(tx.kategori) : store.sourceMeta(tx.sumber);
  const title = tx.keterangan || meta.label;
  const subtitle = tx.keterangan ? meta.label : '';
  const amount = `${tx.type === 'income' ? '+' : '−'}${formatRupiah(tx.nominal)}`;

  return el(
    'button',
    {
      class: `tx${isNew ? ' is-new' : ''}`,
      type: 'button',
      'aria-label': `${title}, ${meta.label}, ${amount}, ${formatDate(tx.tanggal)}. Ketuk untuk mengubah.`,
      onClick: () => onEdit?.(tx)
    },
    [
      el('span', { class: 'tx__body' }, [
        el('span', { class: 'tx__name' }, [
          title,
          flagged.has(tx.id) ? el('span', { class: 'tx__flag', text: 'Tidak biasa' }) : null
        ]),
        subtitle ? el('span', { class: 'tx__meta', text: subtitle }) : null
      ]),
      el('span', {
        class: `tx__amount num ${tx.type === 'income' ? 'is-in' : 'is-out'}`,
        text: amount
      })
    ]
  );
}

/**
 * Render daftar transaksi dikelompokkan per hari.
 * @returns {{total: number, remaining: number}} jumlah transaksi dan sisa kelompok hari
 */
export function renderTxList(mount, { filter = 'all', query = '', visible = 7, lastAddedId = null, onEdit } = {}) {
  const items = filterTransactions({ filter, query });
  clearNode(mount);

  if (!items.length) {
    mount.append(
      el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon' }, [svgIcon(ICONS.empty, 24)]),
        el('p', { class: 'empty__title', text: query.trim() ? 'Tidak ada transaksi cocok' : 'Belum ada transaksi' }),
        el('p', {
          class: 'empty__text',
          text: query.trim() ? 'Coba kata kunci lain atau ganti saringan.' : 'Catat pengeluaran atau pemasukan pertamamu di beranda.'
        })
      ])
    );
    return { total: 0, remaining: 0 };
  }

  const groups = new Map();
  items.forEach((tx) => {
    if (!groups.has(tx.tanggal)) groups.set(tx.tanggal, []);
    groups.get(tx.tanggal).push(tx);
  });

  const flagged = flaggedIds();
  const today = todayStr();
  const entries = [...groups.entries()].slice(0, visible);

  entries.forEach(([date, group]) => {
    const net = group.reduce((acc, tx) => acc + (tx.type === 'income' ? tx.nominal : -tx.nominal), 0);
    mount.append(
      el('section', { class: 'daygroup' }, [
        el('div', { class: 'daygroup__head' }, [
          el('div', {}, [
            el('span', { class: 'daygroup__label', text: relativeDayLabel(date) }),
            el('span', { class: 'daygroup__sub', text: `${group.length} transaksi · ${formatDate(date, date === today ? 'day' : 'short')}` })
          ]),
          net === 0 ? null : el('span', { class: 'daygroup__net num', text: formatRupiah(net, { sign: true }) })
        ]),
        el('div', { class: 'tx-list' }, group.map((tx) => txRow(tx, flagged, { onEdit, isNew: tx.id === lastAddedId })))
      ])
    );
  });

  return { total: items.length, remaining: Math.max(0, groups.size - visible) };
}

/* === Ubah & hapus === */

export function removeTx(tx, after) {
  store.removeTransaction(tx.id);
  after?.();
  toast({
    message: `Transaksi ${formatRupiah(tx.nominal)} dihapus.`,
    tone: 'warn',
    icon: 'undo',
    actionLabel: 'Urungkan',
    duration: 6000,
    onAction() {
      store.restoreTransaction({ ...tx, type: tx.type });
      toast({ message: 'Transaksi dikembalikan.' });
    }
  });
}

export function openEditSheet(tx) {
  const meta = tx.type === 'expense' ? store.categoryMeta(tx.kategori) : store.sourceMeta(tx.sumber);
  let handle;

  const editForm = createQuickForm({
    title: 'edit',
    compact: true,
    onSubmit(payload) {
      store.updateTransaction(tx.id, payload);
      handle?.close();
      toast({ message: 'Transaksi diperbarui.', tone: 'good' });
      return true;
    }
  });
  editForm.fill({ ...tx, type: tx.type });

  const removeBtn = el('button', { class: 'btn btn--danger-ghost', type: 'button', onClick: () => removeTx(tx, () => handle?.close()) }, [
    svgIcon(ICONS.trash, 17),
    'Hapus'
  ]);
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'button', onClick: () => editForm.form.requestSubmit() }, ['Simpan']);

  handle = openSheet({
    title: 'Ubah transaksi',
    subtitle: `${meta.label} · ${formatDate(tx.tanggal)}`,
    body: editForm.root,
    footer: el('div', { class: 'btn-row' }, [removeBtn, saveBtn])
  });

  return handle;
}