import * as store from './store.js';
import { createQuickForm } from './quick-form.js';
import { dailyAverage, resolveRange, slice, summarize } from './analytics.js';
import { initTheme, onThemeChange, openSheet, openSettings, setupInstall, setupSyncBadge, setupThemeToggle, toast } from './ui.js';
import { ICONS, clearNode, el, formatDate, formatRupiah, relativeDayLabel, svgIcon, todayStr } from './utils.js';

const PAGE_SIZE = 7;

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
  formMount: document.getElementById('quickFormMount'),
  activityList: document.getElementById('activityList'),
  activityCount: document.getElementById('activityCount'),
  activityFilter: document.getElementById('activityFilter'),
  searchInput: document.getElementById('searchInput'),
  moreBtn: document.getElementById('moreBtn'),
  syncBadge: document.getElementById('syncBadge'),
  accountBtn: document.getElementById('accountBtn')
};

const ui = {
  filter: 'all',
  query: '',
  visible: PAGE_SIZE,
  lastAddedId: null
};

/* === Balance === */

function renderBalance() {
  const state = store.getState();
  const totals = store.totals();
  const today = todayStr();
  const todayRange = resolveRange({ period: 'today' });
  const monthRange = resolveRange({ period: 'month' });
  const avg = dailyAverage(state, today, 30);

  dom.balanceAmount.textContent = formatRupiah(totals.balance);
  dom.balanceAmount.classList.toggle('is-negative', totals.balance < 0);
  dom.totalIncome.textContent = formatRupiah(totals.income, { compact: totals.income >= 1e9 });
  dom.totalExpense.textContent = formatRupiah(totals.expense, { compact: totals.expense >= 1e9 });
  dom.balanceDate.textContent = `Per ${formatDate(today)}`;

  const todayNet = summarize(state, todayRange).net;
  const monthNet = summarize(state, monthRange).net;

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

/* === Activity === */

function visibleTransactions() {
  const state = store.getState();
  const query = ui.query.trim().toLowerCase();
  return store
    .allTransactions()
    .filter((tx) => (ui.filter === 'all' ? true : tx.type === ui.filter))
    .filter((tx) => {
      if (!query) return true;
      const haystack = [tx.keterangan, tx.kategori, tx.sumber, tx.frekuensi, formatRupiah(tx.nominal)].join(' ').toLowerCase();
      return haystack.includes(query);
    });
}

function txRow(tx, flagged) {
  const meta = tx.type === 'expense' ? store.categoryMeta(tx.kategori) : store.sourceMeta(tx.sumber);
  const parts = [tx.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'];
  if (tx.keterangan) parts.push(tx.keterangan);
  if (tx.frekuensi && tx.frekuensi !== 'harian') parts.push(tx.frekuensi);

  return el(
    'button',
    {
      class: `tx${tx.id === ui.lastAddedId ? ' is-new' : ''}`,
      type: 'button',
      'aria-label': `${meta.label}, ${formatRupiah(tx.nominal)}, ${formatDate(tx.tanggal)}. Ketuk untuk mengubah.`,
      onClick: () => openEditSheet(tx)
    },
    [
      el('span', { class: 'tx__icon', style: `--tone:${meta.color}`, text: meta.icon }),
      el('span', { class: 'tx__body' }, [
        el('span', { class: 'tx__name' }, [
          meta.label,
          flagged ? el('span', { class: 'tx__flag', text: 'Tidak biasa' }) : null
        ]),
        el('span', { class: 'tx__meta', text: parts.join(' · ') })
      ]),
      el('span', {
        class: `tx__amount num ${tx.type === 'income' ? 'is-in' : 'is-out'}`,
        text: `${tx.type === 'income' ? '+' : '−'}${formatRupiah(tx.nominal)}`
      })
    ]
  );
}

function flaggedIds() {
  const state = store.getState();
  const baseline = dailyAverage(state, todayStr(), 30);
  if (!baseline.avg) return new Set();
  const limit = baseline.avg * state.settings.threshold;
  return new Set(slice(state.expenses, resolveRange({ period: 'week' })).filter((tx) => tx.nominal >= limit).map((tx) => tx.id));
}

function renderActivity() {
  const items = visibleTransactions();
  dom.activityCount.textContent = items.length ? `${items.length} transaksi` : '';

  clearNode(dom.activityList);

  if (!items.length) {
    const isSearching = Boolean(ui.query.trim());
    dom.activityList.append(
      el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon' }, [svgIcon(ICONS.empty, 24)]),
        el('p', { class: 'empty__title', text: isSearching ? 'Tidak ada transaksi cocok' : 'Belum ada transaksi' }),
        el('p', {
          class: 'empty__text',
          text: isSearching ? 'Coba kata kunci lain atau ganti saringan.' : 'Catat pengeluaran atau pemasukan pertamamu di atas.'
        })
      ])
    );
    dom.moreBtn.hidden = true;
    return;
  }

  const groups = new Map();
  items.forEach((tx) => {
    if (!groups.has(tx.tanggal)) groups.set(tx.tanggal, []);
    groups.get(tx.tanggal).push(tx);
  });

  const flagged = flaggedIds();
  const entries = [...groups.entries()].slice(0, ui.visible);

  entries.forEach(([date, group]) => {
    const net = group.reduce((acc, tx) => acc + (tx.type === 'income' ? tx.nominal : -tx.nominal), 0);
    dom.activityList.append(
      el('section', { class: 'daygroup' }, [
        el('div', { class: 'daygroup__head' }, [
          el('div', {}, [
            el('span', { class: 'daygroup__label', text: relativeDayLabel(date) }),
            el('span', { class: 'daygroup__sub', text: `${group.length} transaksi · ${formatDate(date, date === todayStr() ? 'day' : 'short')}` })
          ]),
          el('span', {
            class: 'daygroup__net num',
            text: net === 0 ? formatRupiah(0) : formatRupiah(net, { sign: true })
          })
        ]),
        el('div', { class: 'tx-list' }, group.map((tx) => txRow(tx, flagged.has(tx.id))))
      ])
    );
  });

  dom.moreBtn.hidden = groups.size <= ui.visible;
  dom.moreBtn.textContent = `Tampilkan ${Math.min(PAGE_SIZE, groups.size - ui.visible)} hari lagi`;
}

function renderAll() {
  renderBalance();
  renderActivity();
}

/* === Quick form === */

const quickForm = createQuickForm({
  onSubmit(payload) {
    const tx = store.addTransaction(payload);
    if (!tx) return false;
    if (ui.filter !== 'all' && ui.filter !== payload.type) ui.filter = 'all';
    ui.query = '';
    dom.searchInput.value = '';
    ui.visible = PAGE_SIZE;
    ui.lastAddedId = tx.id;
    renderAll();
    toast({
      message: `${payload.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} ${formatRupiah(tx.nominal)} dicatat.`,
      tone: payload.type === 'income' ? 'good' : 'neutral',
      actionLabel: 'Ubah',
      onAction: () => openEditSheet(tx)
    });
    quickForm.focusAmount();
    return true;
  }
});

quickForm.setBalanceProvider(() => store.totals().balance);
dom.formMount.append(quickForm.root);

/* === Edit sheet === */

function openEditSheet(tx) {
  const meta = tx.type === 'expense' ? store.categoryMeta(tx.kategori) : store.sourceMeta(tx.sumber);
  const editForm = createQuickForm({
    title: 'edit',
    compact: true,
    onSubmit(payload) {
      store.updateTransaction(tx.id, payload);
      handle.close();
      toast({ message: 'Transaksi diperbarui.', tone: 'good' });
      return true;
    }
  });
  editForm.fill({ ...tx, type: tx.type });

  const removeBtn = el('button', { class: 'btn btn--danger-ghost', type: 'button', onClick: () => removeTx(tx, () => handle.close()) }, [
    svgIcon(ICONS.trash, 17),
    'Hapus'
  ]);

  const saveBtn = el('button', { class: 'btn btn--primary', type: 'button', onClick: () => editForm.form.requestSubmit() }, ['Simpan']);

  const handle = openSheet({
    title: 'Ubah transaksi',
    subtitle: `${meta.icon} ${meta.label} · ${formatDate(tx.tanggal)}`,
    body: editForm.root,
    footer: el('div', { class: 'btn-row' }, [removeBtn, saveBtn])
  });
}

function removeTx(tx, after) {
  store.removeTransaction(tx.id);
  after?.();
  toast({
    message: `Transaksi ${formatRupiah(tx.nominal)} dihapus.`,
    tone: 'warn',
    icon: 'undo',
    actionLabel: 'Urungkan',
    duration: 6000,
    onAction: () => {
      store.restoreTransaction({ ...tx, type: tx.type });
      toast({ message: 'Transaksi dikembalikan.' });
    }
  });
}

/* === Controls === */

function syncFilterChips() {
  dom.activityFilter.querySelectorAll('.chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.filter === ui.filter);
  });
}

dom.activityFilter.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  ui.filter = chip.dataset.filter;
  ui.visible = PAGE_SIZE;
  syncFilterChips();
  renderActivity();
});

dom.searchInput.addEventListener('input', (e) => {
  ui.query = e.target.value;
  ui.visible = PAGE_SIZE;
  renderActivity();
});

dom.moreBtn.addEventListener('click', () => {
  ui.visible += PAGE_SIZE;
  renderActivity();
});

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

onThemeChange(() => renderActivity());

window.addEventListener(
  'scroll',
  () => dom.appbar.classList.toggle('is-scrolled', window.scrollY > 8),
  { passive: true }
);

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement === document.body) {
    e.preventDefault();
    quickForm.focusAmount();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Pendaftaran service worker gagal:', err));
  });
}