import * as store from './store.js';
import {
  PERIODS,
  bucketSeries,
  buildInsights,
  comparePeriods,
  dataBounds,
  expenseByCategory,
  incomeBySource,
  previousRange,
  resolveRange,
  shiftRange,
  slice,
  summarize,
  topExpenses
} from './analytics.js';
import { chartAvailable, createCashflowChart, createCategoryChart, destroyChart } from './charts.js';
import { filterTransactions, openEditSheet, renderTxList } from './tx-view.js';
import { initTheme, onThemeChange, openSettings, setupInstall, setupSyncBadge, setupThemeToggle, toast } from './ui.js';
import { ICONS, clearNode, el, formatRupiah, formatPercent, svgIcon, todayStr, toDateStr } from './utils.js';

const VIEW_KEY = 'dompetku.view.v2';

const dom = {
  appbar: document.getElementById('appbar'),
  appbarSub: document.getElementById('appbarSub'),
  themeToggle: document.getElementById('themeToggle'),
  settingsBtn: document.getElementById('settingsBtn'),
  openSettings: document.getElementById('openSettings'),
  periodChips: document.getElementById('periodChips'),
  periodTitle: document.getElementById('periodTitle'),
  periodMeta: document.getElementById('periodMeta'),
  prevPeriod: document.getElementById('prevPeriod'),
  nextPeriod: document.getElementById('nextPeriod'),
  customRange: document.getElementById('customRange'),
  fromDate: document.getElementById('fromDate'),
  toDate: document.getElementById('toDate'),
  kpis: document.getElementById('kpis'),
  trendHint: document.getElementById('trendHint'),
  cashflowLegend: document.getElementById('cashflowLegend'),
  cashflowChart: document.getElementById('cashflowChart'),
  cumulativeToggle: document.getElementById('cumulativeToggle'),
  compositionHint: document.getElementById('compositionHint'),
  categoryChart: document.getElementById('categoryChart'),
  categoryLegend: document.getElementById('categoryLegend'),
  topList: document.getElementById('topList'),
  insights: document.getElementById('insights'),
  categoryTable: document.querySelector('#categoryTable tbody'),
  categoryTfoot: document.querySelector('#categoryTable tfoot'),
  txSearch: document.getElementById('txSearch'),
  txFilter: document.getElementById('txFilter'),
  txList: document.getElementById('txList'),
  txMore: document.getElementById('txMore'),
  txlogCount: document.getElementById('txlogCount'),
  incomeHint: document.getElementById('incomeHint'),
  incomeList: document.getElementById('incomeList'),
  exportCsv: document.getElementById('exportCsv'),
  exportCsvAll: document.getElementById('exportCsvAll'),
  exportJson: document.getElementById('exportJson'),
  syncBadge: document.getElementById('syncBadge'),
  accountBtn: document.getElementById('accountBtn')
};

const view = loadView();
const TXLOG_PAGE = 7;
const txlog = { filter: 'all', query: '', visible: TXLOG_PAGE };
let cashflowChart = null;
let categoryChart = null;
let latest = null;

function loadView() {
  const fallback = { period: 'month', offset: 0, from: '', to: '', cumulative: false };
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      offset: 0,
      period: PERIODS.some((p) => p.id === parsed.period) || parsed.period === 'custom' ? parsed.period : 'month'
    };
  } catch {
    return fallback;
  }
}

function saveView() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    /* penyimpanan tidak tersedia, abaikan */
  }
}

function currentRange() {
  if (view.period === 'all') {
    const bounds = dataBounds(store.getState());
    const fallbackFrom = toDateStr(new Date(Date.now() - 29 * 86400000));
    return resolveRange({ period: 'custom', from: bounds?.from || fallbackFrom, to: todayStr() });
  }
  if (view.period === 'custom') {
    const to = view.to || todayStr();
    const from = view.from || to;
    return resolveRange({ period: 'custom', from, to });
  }
  return resolveRange({ period: view.period, offset: view.offset });
}

function goPeriod(period) {
  view.period = period;
  view.offset = 0;
  saveView();
  render();
}

function step(direction) {
  const next = shiftRange(currentRange(), direction);
  if (next.period === 'custom') {
    view.from = next.from;
    view.to = next.to;
  } else {
    view.period = next.period;
    view.offset = next.offset;
  }
  saveView();
  render();
}

function iconFor(name) {
  const paths = ICONS[name];
  if (paths) return svgIcon(paths, 17);
  return el('span', { text: name, style: 'font-size:1rem' });
}

/* === Period UI === */

function renderPeriodChips() {
  clearNode(dom.periodChips);
  const options = [...PERIODS, { id: 'custom', label: 'Rentang' }];
  dom.periodChips.append(
    ...options.map((option) => {
      const chip = el('button', {
        class: `chip chip--sm${view.period === option.id ? ' is-active' : ''}`,
        type: 'button',
        text: option.label,
        dataset: { period: option.id }
      });
      chip.addEventListener('click', () => goPeriod(option.id));
      return chip;
    })
  );
}

function renderPeriodHeader(range, prev) {
  dom.periodTitle.textContent = range.label;
  const gran = range.granularity === 'month' ? 'per bulan' : range.granularity === 'week' ? 'per minggu' : 'per hari';
  dom.periodMeta.textContent = `${range.days} hari · ${range.from} s/d ${range.to} · ${gran}`;
  dom.prevPeriod.disabled = view.period === 'custom' ? false : view.period === 'today' || view.period === 'all';
  dom.nextPeriod.disabled = view.period === 'all' || (view.period === 'custom' ? false : view.offset === 0);
  dom.customRange.hidden = view.period !== 'custom';
  dom.fromDate.value = view.from || range.from;
  dom.toDate.value = view.to || range.to;
}

/* === KPI === */

function deltaBadge(value, invert = false) {
  const abs = Math.abs(value);
  const good = invert ? value > 0 : value < 0;
  const tone = abs < 1 ? 'flat' : good ? 'down' : 'up';
  return el('span', { class: `delta delta--${tone}` }, [
    svgIcon(value >= 0 ? ICONS.arrowUp : ICONS.arrowDown, 11),
    `${abs.toFixed(0)}%`
  ]);
}

function renderKpis(range, cmp) {
  const { current, previous, delta } = cmp;
  clearNode(dom.kpis);

  dom.kpis.append(
    el('article', { class: 'kpi kpi--in', style: '--tone:var(--income)' }, [
      el('p', { class: 'kpi__label', text: 'Pemasukan' }),
      el('p', { class: 'kpi__value', text: formatRupiah(current.income, { compact: current.income >= 1e9 }) }),
      el('p', { class: 'kpi__foot' }, [
        previous ? deltaBadge(delta.income, true) : null,
        el('span', { text: previous ? 'vs periode lalu' : `${current.incomeCount} transaksi` })
      ])
    ]),
    el('article', { class: 'kpi kpi--out', style: '--tone:var(--expense)' }, [
      el('p', { class: 'kpi__label', text: 'Pengeluaran' }),
      el('p', { class: 'kpi__value', text: formatRupiah(current.expense, { compact: current.expense >= 1e9 }) }),
      el('p', { class: 'kpi__foot' }, [
        previous ? deltaBadge(delta.expense) : null,
        el('span', { text: previous ? 'vs periode lalu' : `${current.expenseCount} transaksi` })
      ])
    ]),
    el('article', { class: 'kpi kpi--wide', style: '--tone:var(--primary)' }, [
      el('p', { class: 'kpi__label', text: 'Selisih (saldo periode)' }),
      el('p', {
        class: 'kpi__value',
        style: current.net < 0 ? 'color:var(--expense)' : 'color:var(--income)',
        text: formatRupiah(current.net, { sign: true, compact: Math.abs(current.net) >= 1e9 })
      }),
      el('div', { class: 'gauge' }, [
        el('div', {
          class: 'gauge__fill',
          style: `width:${Math.max(0, Math.min(100, current.income > 0 ? (current.expense / current.income) * 100 : 0))}%`
        })
      ]),
      el('p', { class: 'kpi__foot' }, [
        previous ? deltaBadge(delta.net, true) : null,
        el('span', {
          text:
            current.income > 0
              ? `Tingkat tabungan ${formatPercent(current.savingsRate)}`
              : `${current.activeDays} hari ada pengeluaran`
        })
      ])
    ]),
    el('article', { class: 'kpi', style: '--tone:var(--warn)' }, [
      el('p', { class: 'kpi__label', text: 'Rata-rata / hari' }),
      el('p', { class: 'kpi__value', text: formatRupiah(current.avgExpensePerDay, { compact: current.avgExpensePerDay >= 1e9 }) }),
      el('p', { class: 'kpi__foot' }, [el('span', { text: `${current.activeDays}/${range.days} hari outpost` })])
    ])
  );
}

/* === Charts === */

function renderCashflow(state, range, summary) {
  const buckets = bucketSeries(state, range);
  dom.trendHint.textContent = range.granularity === 'day' ? 'Harian' : range.granularity === 'week' ? 'Mingguan' : 'Bulanan';

  clearNode(dom.cashflowLegend);
  [
    { label: 'Pemasukan', tone: 'var(--income)' },
    { label: 'Pengeluaran', tone: 'var(--expense)' }
  ].concat(view.cumulative ? [{ label: 'Saldo kumulatif', tone: 'var(--primary)' }] : []).forEach((item) => {
    dom.cashflowLegend.append(el('span', { style: `--tone:${item.tone}` }, [el('i'), item.label]));
  });

  destroyChart(cashflowChart);
  cashflowChart = null;

  if (!chartAvailable()) {
    showChartFallback(dom.cashflowChart, 'Grafik tidak tersedia. Koneksi internet diperlukan untuk memuat pustaka grafik.');
    return;
  }

  if (summary.txCount === 0) {
    showChartFallback(dom.cashflowChart, 'Tidak ada transaksi pada periode ini.');
    return;
  }

  clearChartFallback(dom.cashflowChart);
  cashflowChart = createCashflowChart(dom.cashflowChart, buckets, { showCumulative: view.cumulative });
}

function showChartFallback(canvas, message) {
  clearChartFallback(canvas);
  const wrap = canvas.parentElement;
  const note = el('div', { class: 'chart-empty', text: message });
  note.dataset.fallback = 'true';
  wrap.append(note);
}

function clearChartFallback(canvas) {
  canvas.parentElement.querySelectorAll('[data-fallback="true"]').forEach((n) => n.remove());
}

function renderComposition(state, range, summary) {
  const rows = expenseByCategory(state, range);
  dom.compositionHint.textContent = rows.length ? `${rows.length} kategori` : '';

  destroyChart(categoryChart);
  categoryChart = null;

  clearNode(dom.categoryLegend);

  if (!chartAvailable()) {
    showChartFallback(dom.categoryChart, 'Grafik tidak tersedia.');
  } else if (!rows.length) {
    showChartFallback(dom.categoryChart, 'Belum ada pengeluaran pada periode ini.');
  } else {
    clearChartFallback(dom.categoryChart);
    categoryChart = createCategoryChart(dom.categoryChart, rows, {
      centerLabel: 'Total',
      centerValue: formatRupiah(summary.expense, { compact: true })
    });
  }

  if (!rows.length) {
    dom.categoryLegend.append(
      el('li', { class: 'legend__item' }, [el('span', { class: 'legend__name', text: 'Belum ada pengeluaran.' })])
    );
    return;
  }

  rows.slice(0, 8).forEach((row) => {
    dom.categoryLegend.append(
      el('li', { class: 'legend__item', style: `--tone:${row.meta.color}` }, [
        el('span', { class: 'legend__dot' }),
        el('span', { class: 'legend__body' }, [
          el('span', { class: 'legend__name', text: `${row.meta.icon} ${row.meta.label}` }),
          el('span', { class: 'legend__bar' }, [el('i', { style: `width:${Math.max(2, row.share)}%` })])
        ]),
        el('span', { class: 'legend__value' }, [
          el('span', { class: 'legend__share', text: `${row.share.toFixed(0)}%` }),
          el('br'),
          formatRupiah(row.total, { compact: row.total >= 1e9 })
        ])
      ])
    );
  });

  if (rows.length > 8) {
    dom.categoryLegend.append(
      el('li', { class: 'legend__item' }, [
        el('span', { class: 'legend__name', text: `+${rows.length - 8} kategori lainnya` })
      ])
    );
  }
}

/* === Top list === */

function renderTop(state, range) {
  const rows = topExpenses(state, range, 5);
  clearNode(dom.topList);

  if (!rows.length) {
    dom.topList.append(el('li', { class: 'empty__hint', text: 'Belum ada pengeluaran pada periode ini.' }));
    return;
  }

  const max = rows[0].nominal;
  rows.forEach((tx, index) => {
    dom.topList.append(
      el('li', { class: 'rank__row', style: `--tone:${tx.meta.color}` }, [
        el('span', { class: 'rank__no', text: String(index + 1) }),
        el('span', { class: 'rank__icon', text: tx.meta.icon }),
        el('span', { class: 'rank__body' }, [
          el('span', { class: 'rank__name', text: tx.keterangan || tx.meta.label }),
          el('span', {
            class: 'rank__meta',
            text: `${tx.meta.label} · ${formatDateShort(tx.tanggal)}`
          }),
          el('span', { class: 'rank__bar' }, [el('i', { style: `width:${Math.max(4, (tx.nominal / max) * 100)}%` })])
        ]),
        el('span', { class: 'rank__value', text: formatRupiah(tx.nominal, { compact: tx.nominal >= 1e9 }) })
      ])
    );
  });
}

function formatDateShort(value) {
  return new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/* === Insights === */

function renderInsights(state, range, prevRangeData) {
  const insights = buildInsights(state, range, state.settings, prevRangeData);
  clearNode(dom.insights);
  insights.forEach((item) => {
    dom.insights.append(
      el('article', { class: `insight insight--${item.tone}` }, [
        el('span', { class: 'insight__icon' }, [iconFor(item.icon)]),
        el('div', {}, [
          el('h3', { class: 'insight__title', text: item.title }),
          el('p', { class: 'insight__detail', text: item.detail })
        ])
      ])
    );
  });
}

/* === Table === */

function renderTable(state, range, rows, summary) {
  clearNode(dom.categoryTable);
  clearNode(dom.categoryTfoot);

  if (!rows.length) {
    dom.categoryTable.append(el('tr', {}, [el('td', { colspan: '4', class: 'td-share', text: 'Belum ada pengeluaran pada periode ini.' })]));
    return;
  }

  rows.forEach((row) => {
    dom.categoryTable.append(
      el('tr', {}, [
        el('td', {}, [
          el('span', { class: 'td-name', style: `--tone:${row.meta.color}` }, [
            el('span', { class: 'td-swatch' }),
            el('span', { text: `${row.meta.icon} ${row.meta.label}` })
          ])
        ]),
        el('td', { class: 'ta-r', text: String(row.count) }),
        el('td', { class: 'ta-r td-share', text: formatRupiah(row.avg, { compact: row.avg >= 1e9 }) }),
        el('td', { class: 'ta-r td-total', text: formatRupiah(row.total, { compact: row.total >= 1e9 }) })
      ])
    );
  });

  dom.categoryTfoot.append(
    el('tr', { class: 'tfoot' }, [
      el('td', { text: 'Total' }),
      el('td', { class: 'ta-r', text: String(summary.expenseCount) }),
      el('td', { class: 'ta-r', text: '—' }),
      el('td', { class: 'ta-r', text: formatRupiah(summary.expense, { compact: summary.expense >= 1e9 }) })
    ])
  );
}

/* === Income === */

function renderIncome(state, range) {
  const rows = incomeBySource(state, range);
  clearNode(dom.incomeList);
  dom.incomeHint.textContent = rows.length ? `${rows.length} sumber` : '';

  if (!rows.length) {
    dom.incomeList.append(el('li', { class: 'empty__hint', text: 'Belum ada pemasukan pada periode ini.' }));
    return;
  }

  const max = rows[0].total;
  rows.forEach((row) => {
    dom.incomeList.append(
      el('li', { class: 'bars__row' }, [
        el('span', { class: 'bars__name', style: `--tone:${row.meta.color}` }, [
          el('span', { text: row.meta.icon }),
          el('span', { text: row.meta.label })
        ]),
        el('span', { class: 'bars__track' }, [el('i', { class: 'bars__fill', style: `width:${Math.max(4, (row.total / max) * 100)}%` })]),
        el('span', { class: 'bars__value', text: formatRupiah(row.total, { compact: row.total >= 1e9 }) })
      ])
    );
  });
}

/* === Export === */

function exportCsv() {
  if (!latest) return;
  const { range } = latest;
  const state = store.getState();
  const rows = [
    ['Tanggal', 'Jenis', 'Kategori/Sumber', 'Keterangan', 'Frekuensi', 'Nominal'],
    ...slice(state.expenses, range).map((tx) => [tx.tanggal, 'Pengeluaran', tx.kategori, tx.keterangan, tx.frekuensi, tx.nominal]),
    ...slice(state.incomes, range).map((tx) => [tx.tanggal, 'Pemasukan', tx.sumber, tx.keterangan, tx.frekuensi, tx.nominal])
  ];
  store.exportCSV(rows, `dompetku-transaksi-${range.from}-sd-${range.to}.csv`);
  toast({ message: `CSV ${rows.length - 1} transaksi diunduh.`, tone: 'good' });
}

/* === Render === */

/* === Daftar transaksi === */

function renderTxlog() {
  const { total, remaining } = renderTxList(dom.txList, {
    filter: txlog.filter,
    query: txlog.query,
    visible: txlog.visible,
    onEdit: openEditSheet
  });
  dom.txlogCount.textContent = total ? `${total} transaksi` : '';
  dom.txMore.hidden = remaining === 0;
  dom.txMore.textContent = `Tampilkan ${Math.min(TXLOG_PAGE, remaining)} hari lagi`;
}

function syncFilterChips() {
  dom.txFilter.querySelectorAll('.chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.filter === txlog.filter);
  });
}

dom.txFilter.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  txlog.filter = chip.dataset.filter;
  txlog.visible = TXLOG_PAGE;
  syncFilterChips();
  renderTxlog();
});

dom.txSearch.addEventListener('input', (e) => {
  txlog.query = e.target.value;
  txlog.visible = TXLOG_PAGE;
  renderTxlog();
});

dom.txMore.addEventListener('click', () => {
  txlog.visible += TXLOG_PAGE;
  renderTxlog();
});

function render() {
  const state = store.getState();
  const range = currentRange();
  const prev = previousRange(range);
  const cmp = comparePeriods(state, range, prev);
  const rows = expenseByCategory(state, range);

  latest = { range, prev, cmp, rows };

  renderPeriodChips();
  renderPeriodHeader(range, prev);
  renderKpis(range, cmp);
  renderCashflow(state, range, cmp.current);
  renderComposition(state, range, cmp.current);
  renderTop(state, range);
  renderInsights(state, range, prev);
  renderTable(state, range, rows, cmp.current);
  renderIncome(state, range);
  renderTxlog();

  dom.appbarSub.textContent = `${range.label} · saldo ${formatRupiah(store.totals().balance, { compact: true })}`;
}

/* === Events === */

dom.prevPeriod.addEventListener('click', () => step(-1));
dom.nextPeriod.addEventListener('click', () => step(1));

dom.fromDate.addEventListener('change', (e) => {
  view.from = e.target.value;
  if (!view.to || view.to < view.from) view.to = view.from;
  saveView();
  render();
});

dom.toDate.addEventListener('change', (e) => {
  view.to = e.target.value;
  if (!view.from || view.from > view.to) view.from = view.to;
  saveView();
  render();
});

dom.cumulativeToggle.addEventListener('change', (e) => {
  view.cumulative = e.target.checked;
  saveView();
  render();
});

dom.exportCsv.addEventListener('click', exportCsv);
dom.exportCsvAll.addEventListener('click', exportCsv);
dom.exportJson.addEventListener('click', () => {
  store.downloadJSON();
  toast({ message: 'Backup JSON diunduh.', tone: 'good' });
});

[dom.settingsBtn, dom.openSettings].forEach((btn) => btn.addEventListener('click', () => openSettings()));

store.subscribe(() => render());

/* === Init === */

initTheme();
setupThemeToggle(dom.themeToggle, () => store.getState().settings.theme);
setupSyncBadge(dom.syncBadge, dom.accountBtn);
setupInstall();

dom.cumulativeToggle.checked = view.cumulative;

if (view.period === 'custom' && !view.to) {
  view.to = todayStr();
  view.from = toDateStr(new Date(Date.now() - 29 * 86400000));
}

render();

store.init().then(() => {
  initTheme();
  render();
}).catch((err) => console.warn('Gagal memuat data:', err));

onThemeChange(() => render());

window.addEventListener(
  'scroll',
  () => dom.appbar.classList.toggle('is-scrolled', window.scrollY > 8),
  { passive: true }
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Pendaftaran service worker gagal:', err));
  });
}