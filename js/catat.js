import { createQuickForm } from './quick-form.js';
import { setupReceiptScanner } from './receipt.js';
import * as store from './store.js';
import { openEditSheet } from './tx-view.js';
import { dailyAverage, resolveRange, summarize } from './analytics.js';
import { initTheme, onThemeChange, openSettings, openSheet, setupInstall, setupSyncBadge, setupThemeToggle, toast } from './ui.js';
import { clearNode, el, formatDate, formatRupiah, todayStr } from './utils.js';

// Fitur "Pindai Struk" (OCR) belum diaktifkan: hasil pembacaan struk masih
// sering salah, jadi tombolnya disembunyikan. Set true untuk menghidupkan lagi.
const SCAN_STRUK_ENABLED = false;

const dom = {
  appbar: document.getElementById('appbar'),
  appbarSub: document.getElementById('appbarSub'),
  themeToggle: document.getElementById('themeToggle'),
  settingsBtn: document.getElementById('settingsBtn'),
  balanceDate: document.getElementById('balanceDate'),
  balanceAmount: document.getElementById('balanceAmount'),
  totalIncome: document.getElementById('totalIncome'),
  totalExpense: document.getElementById('totalExpense'),
  balanceStats: document.getElementById('balanceStats'),
  catatExpense: document.getElementById('catatExpense'),
  catatIncome: document.getElementById('catatIncome'),
  syncBadge: document.getElementById('syncBadge'),
  accountBtn: document.getElementById('accountBtn')
};

/* === Balance === */

function renderBalance() {
  const state = store.getState();
  const totals = store.totals();
  const today = todayStr();
  const todayNet = summarize(state, resolveRange({ period: 'today' })).net;
  const monthNet = summarize(state, resolveRange({ period: 'month' })).net;
  const avg = dailyAverage(state, today, 30);

  dom.balanceAmount.textContent = formatRupiah(totals.balance);
  dom.balanceAmount.classList.toggle('is-negative', totals.balance < 0);
  dom.totalIncome.textContent = formatRupiah(totals.income, { compact: totals.income >= 1e9 });
  dom.totalExpense.textContent = formatRupiah(totals.expense, { compact: totals.expense >= 1e9 });
  dom.balanceDate.textContent = `Per ${formatDate(today)}`;

  clearNode(dom.balanceStats);
  [
    { label: 'Hari ini', value: todayNet, net: true },
    { label: 'Bulan ini', value: monthNet, net: true },
    { label: 'Rata-rata/hari', value: avg.avg }
  ].forEach((item) => {
    const signClass = item.net ? (item.value > 0 ? 'pos' : item.value < 0 ? 'neg' : '') : '';
    dom.balanceStats.append(
      el('div', { class: 'bstat' }, [
        el('span', { class: 'bstat__label', text: item.label }),
        el('span', {
          class: `bstat__value num ${signClass}`,
          text: formatRupiah(item.value, { sign: item.net, compact: Math.abs(item.value) >= 1e9 })
        })
      ])
    );
  });
}

function renderAll() {
  renderBalance();
}

/* === Modal catat transaksi === */

/**
 * Buka modal form untuk mencatat pengeluaran atau pemasukan.
 * @param {'expense'|'income'} type
 */
function openCatatSheet(type) {
  const isExpense = type === 'expense';
  let handle;
  let teardownScanner = null;

  const form = createQuickForm({
    title: type,
    onSubmit(payload) {
      const tx = store.addTransaction(payload);
      if (!tx) return false;
      handle?.close();
      renderAll();
      toast({
        message: `${isExpense ? 'Pengeluaran' : 'Pemasukan'} ${formatRupiah(tx.nominal)} dicatat.`,
        tone: isExpense ? 'neutral' : 'good',
        actionLabel: 'Ubah',
        onAction: () => openEditSheet(tx)
      });
      return true;
    }
  });
  form.setBalanceProvider(() => store.totals().balance);
  if (!isExpense) form.setType('income');

  const body = el('div', { class: 'sheet-form' }, [form.root]);

  // Pindai struk disembunyikan sementara: hasil OCR masih belum rapi untuk
  // dipakai harian. Kode dan endpoint-nya tetap utuh; cukup ubah ke true
  // untuk menghidupkan lagi.
  if (isExpense && SCAN_STRUK_ENABLED) {
    const scanMount = el('div', { class: 'sheet-form__scan' });
    body.append(scanMount);
    teardownScanner = setupReceiptScanner({
      mount: scanMount,
      onSaved() {
        handle?.close();
        renderAll();
      }
    });
  }

  handle = openSheet({
    title: isExpense ? 'Catat Pengeluaran' : 'Catat Pemasukan',
    subtitle: isExpense ? 'Uang keluar dari dompet' : 'Uang masuk ke dompet',
    body,
    onClose() {
      teardownScanner?.();
      teardownScanner = null;
    }
  });

  return handle;
}

dom.catatExpense.addEventListener('click', () => openCatatSheet('expense'));
dom.catatIncome.addEventListener('click', () => openCatatSheet('income'));

/* === Kontrol === */

dom.settingsBtn.addEventListener('click', () => openSettings());

store.subscribe(() => renderAll());

/* === Init === */

initTheme();
setupThemeToggle(dom.themeToggle, () => store.getState().settings.theme);
setupSyncBadge(dom.syncBadge, dom.accountBtn);
setupInstall();

dom.appbarSub.textContent = formatDate(todayStr(), 'day');
renderAll();

store.init().then(({ user }) => {
  if (!user) return;
  initTheme();
  renderAll();
}).catch((err) => console.warn('Gagal memuat data:', err));

onThemeChange(() => renderBalance());

window.addEventListener(
  'scroll',
  () => dom.appbar.classList.toggle('is-scrolled', window.scrollY > 8),
  { passive: true }
);

window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key.toLowerCase() === 'n' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector('.sheet-backdrop')) {
    e.preventDefault();
    openCatatSheet('expense');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Pendaftaran service worker gagal:', err));
  });
}

