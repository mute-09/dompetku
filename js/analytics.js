import { addDays, addMonths, daysBetween, eachDay, formatDate, MONTHS_LONG, MONTHS_SHORT, parseDate, startOfDay, sum, toDateStr } from './utils.js';
import { categoryMeta, sourceMeta } from './store.js';

export const PERIODS = [
  { id: 'today', label: 'Hari Ini' },
  { id: 'week', label: '7 Hari' },
  { id: 'month', label: 'Bulan Ini' },
  { id: 'quarter', label: '3 Bulan' },
  { id: 'year', label: 'Tahun Ini' },
  { id: 'all', label: 'Semua' }
];

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function resolveRange({ period = 'month', offset = 0, from, to } = {}) {
  const now = new Date();
  const today = startOfDay(now);
  let start;
  let end = today;
  let label = '';

  if (period === 'custom' && from && to) {
    start = parseDate(from);
    end = parseDate(to);
    if (start > end) [start, end] = [end, start];
    label = `${formatDate(start)} – ${formatDate(end)}`;
  } else {
    if (period === 'today') {
      start = offset === 0 ? today : addDays(today, offset);
      end = start;
      label = formatDate(start, 'long');
    } else if (period === 'week') {
      start = addDays(today, -6 + offset * 7);
      end = addDays(start, 6);
      if (end > today) end = today;
      label = `${formatDate(start)} – ${formatDate(end)}`;
    } else if (period === 'quarter') {
      const base = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), offset * 3);
      start = base;
      end = offset === 0 ? today : endOfMonth(addMonths(base, 2));
      label = `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
    } else if (period === 'year') {
      const year = now.getFullYear() + offset;
      start = new Date(year, 0, 1);
      end = offset === 0 ? today : new Date(year, 11, 31);
      label = `Tahun ${year}`;
    } else if (period === 'all') {
      start = new Date(1970, 0, 1);
      end = today;
      label = 'Semua periode';
    } else {
      const base = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), offset);
      start = base;
      end = offset === 0 ? today : endOfMonth(base);
      label = `${MONTHS_LONG[base.getMonth()]} ${base.getFullYear()}`;
    }
  }

  if (end > today) end = today;
  const days = Math.max(1, daysBetween(start, end) + 1);
  return {
    period,
    offset,
    from: toDateStr(start),
    to: toDateStr(end),
    start,
    end,
    days,
    label: label || `${formatDate(start)} – ${formatDate(end)}`,
    granularity: days > 70 ? 'month' : days > 45 ? 'week' : 'day'
  };
}

export function shiftRange(range, direction) {
  if (range.period === 'custom') return range;
  return resolveRange({ period: range.period, offset: range.offset + direction });
}

export function previousRange(range) {
  if (range.period === 'custom') {
    const span = daysBetween(range.start, range.end);
    const end = addDays(range.start, -1);
    const start = addDays(end, -span);
    return { ...resolveRange({ period: 'custom', from: toDateStr(start), to: toDateStr(end) }), period: 'custom', offset: 0 };
  }
  if (range.period === 'all' || range.period === 'today') return null;
  return resolveRange({ period: range.period, offset: range.offset - 1 });
}

export function inRange(tx, range) {
  return tx.tanggal >= range.from && tx.tanggal <= range.to;
}

export function slice(list, range) {
  return list.filter((tx) => inRange(tx, range));
}

export function summarize(list, range) {
  const income = sum(slice(list.incomes, range), (t) => t.nominal);
  const expense = sum(slice(list.expenses, range), (t) => t.nominal);
  const txIncome = slice(list.incomes, range);
  const txExpense = slice(list.expenses, range);
  const net = income - expense;
  const days = range.days;
  const activeDays = new Set(txExpense.map((t) => t.tanggal)).size;
  return {
    income,
    expense,
    net,
    days,
    activeDays,
    idleDays: Math.max(0, days - activeDays),
    incomeCount: txIncome.length,
    expenseCount: txExpense.length,
    txCount: txIncome.length + txExpense.length,
    avgExpensePerDay: expense / days,
    avgIncomePerDay: income / days,
    avgExpensePerTx: txExpense.length ? expense / txExpense.length : 0,
    savingsRate: income > 0 ? (net / income) * 100 : (expense > 0 ? -100 : 0),
    expenseRatio: income > 0 ? (expense / income) * 100 : 0,
    burnPerDay: expense / days
  };
}

export function dailySeries(list, range) {
  const days = eachDay(range.start, range.end);
  const incomeMap = new Map();
  const expenseMap = new Map();
  slice(list.incomes, range).forEach((t) => incomeMap.set(t.tanggal, (incomeMap.get(t.tanggal) || 0) + t.nominal));
  slice(list.expenses, range).forEach((t) => expenseMap.set(t.tanggal, (expenseMap.get(t.tanggal) || 0) + t.nominal));
  let running = 0;
  return days.map((date) => {
    const income = incomeMap.get(date) || 0;
    const expense = expenseMap.get(date) || 0;
    running += income - expense;
    const d = parseDate(date);
    return {
      date,
      label: range.granularity === 'month' ? MONTHS_SHORT[d.getMonth()] : String(d.getDate()),
      fullLabel: formatDate(date),
      income,
      expense,
      net: income - expense,
      cumulative: running
    };
  });
}

export function bucketSeries(list, range) {
  const daily = dailySeries(list, range);
  if (range.granularity === 'day') return daily;

  const buckets = new Map();
  const keyOf = (dateStr) => {
    const d = parseDate(dateStr);
    if (range.granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monday = addDays(d, -(d.getDay() || 7) + 1);
    return toDateStr(monday);
  };

  daily.forEach((point) => {
    const key = keyOf(point.date);
    if (!buckets.has(key)) {
      const d = parseDate(key);
      buckets.set(key, {
        date: key,
        label: range.granularity === 'month' ? `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`,
        fullLabel: range.granularity === 'month' ? `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : `Minggu ${formatDate(key)}`,
        income: 0,
        expense: 0,
        net: 0,
        cumulative: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.income += point.income;
    bucket.expense += point.expense;
    bucket.net += point.net;
    bucket.cumulative = point.cumulative;
  });

  return [...buckets.values()];
}

export function breakdownBy(list, range, key, metaOf) {
  const items = slice(list, range);
  const total = sum(items, (t) => t.nominal);
  const map = new Map();
  items.forEach((tx) => {
    const k = tx[key];
    if (!map.has(k)) map.set(k, { key: k, total: 0, count: 0, last: null, meta: metaOf(k) });
    const entry = map.get(k);
    entry.total += tx.nominal;
    entry.count += 1;
    if (!entry.last || tx.tanggal > entry.last) entry.last = tx.tanggal;
  });
  return [...map.values()]
    .map((entry) => ({
      ...entry,
      share: total > 0 ? (entry.total / total) * 100 : 0,
      avg: entry.count ? entry.total / entry.count : 0
    }))
    .sort((a, b) => b.total - a.total);
}

export function expenseByCategory(list, range) {
  return breakdownBy(list.expenses, range, 'kategori', categoryMeta);
}

export function incomeBySource(list, range) {
  return breakdownBy(list.incomes, range, 'sumber', sourceMeta);
}

export function topExpenses(list, range, limit = 5) {
  return slice(list.expenses, range)
    .sort((a, b) => b.nominal - a.nominal)
    .slice(0, limit)
    .map((tx) => ({ ...tx, meta: categoryMeta(tx.kategori) }));
}

export function dataBounds(list) {
  const all = [...list.expenses, ...list.incomes];
  if (!all.length) return null;
  let min = all[0].tanggal;
  let max = all[0].tanggal;
  all.forEach((t) => {
    if (t.tanggal < min) min = t.tanggal;
    if (t.tanggal > max) max = t.tanggal;
  });
  return { from: min, to: max };
}

export function dailyAverage(list, endDate, windowDays = 30, threshold = 1) {
  const end = parseDate(endDate);
  const bounds = dataBounds(list);
  let start = addDays(end, -(windowDays - 1));
  if (bounds && start < parseDate(bounds.from)) start = parseDate(bounds.from);
  if (start > end) return { avg: 0, days: 1, from: toDateStr(end), to: toDateStr(end) };
  const range = { from: toDateStr(start), to: toDateStr(end), start, end };
  const total = sum(slice(list.expenses, range), (t) => t.nominal);
  const days = Math.max(1, daysBetween(start, end) + 1);
  return { avg: total / days, days, from: range.from, to: range.to, total, threshold };
}

export function detectUnusual(list, range, threshold) {
  const baseline = dailyAverage(list, range.to, 30);
  if (!baseline.avg) return { baseline, items: [], days: [] };

  const limit = baseline.avg * threshold;
  const lookback = { from: toDateStr(addDays(range.end, -29)), to: range.to };

  const items = slice(list.expenses, lookback)
    .filter((tx) => tx.nominal >= limit)
    .sort((a, b) => b.nominal - a.nominal)
    .map((tx) => ({ ...tx, ratio: tx.nominal / baseline.avg, meta: categoryMeta(tx.kategori) }));

  const perDay = new Map();
  slice(list.expenses, lookback).forEach((tx) => {
    perDay.set(tx.tanggal, (perDay.get(tx.tanggal) || 0) + tx.nominal);
  });
  const dayHits = [...perDay.entries()]
    .filter(([, total]) => total >= limit)
    .map(([date, total]) => ({
      date,
      total,
      ratio: total / baseline.avg,
      count: slice(list.expenses, lookback).filter((tx) => tx.tanggal === date).length
    }))
    .sort((a, b) => b.total - a.total);

  return { baseline, limit, items, days: dayHits };
}

export function comparePeriods(list, range, prev) {
  const current = summarize(list, range);
  if (!prev) return { current, previous: null, delta: null };
  const previous = summarize(list, prev);
  const pct = (now, before) => (before > 0 ? ((now - before) / before) * 100 : now > 0 ? 100 : 0);
  return {
    current,
    previous,
    delta: {
      income: pct(current.income, previous.income),
      expense: pct(current.expense, previous.expense),
      net: previous.net !== 0 ? ((current.net - previous.net) / Math.abs(previous.net)) * 100 : current.net > 0 ? 100 : 0,
      txCount: pct(current.txCount, previous.txCount)
    }
  };
}

export function categoryTrends(list, range, prev) {
  if (!prev) return { up: [], down: [] };
  const current = expenseByCategory(list, range);
  const previous = expenseByCategory(list, prev);
  const prevMap = new Map(previous.map((c) => [c.key, c.total]));
  const rows = current.map((entry) => {
    const before = prevMap.get(entry.key) || 0;
    const change = before > 0 ? ((entry.total - before) / before) * 100 : (entry.total > 0 ? 100 : 0);
    return { ...entry, before, change, diff: entry.total - before };
  });
  return {
    up: rows.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 3),
    down: rows.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 3),
    rows
  };
}

export function streaks(list, range) {
  const days = eachDay(range.start, range.end);
  const set = new Set(slice(list.expenses, range).map((t) => t.tanggal));
  let best = 0;
  let current = 0;
  days.forEach((d) => {
    if (set.has(d)) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  });
  return { best, days: set.size };
}

export function buildInsights(list, range, settings, prevRangeData) {
  const { baseline, items, days } = detectUnusual(list, range, settings.threshold);
  const summaryNow = summarize(list, range);
  const top = topExpenses(list, range, 1)[0];
  const cats = expenseByCategory(list, range);
  const trends = categoryTrends(list, range, prevRangeData);
  const streak = streaks(list, range);
  const busiest = dailySeries(list, range)
    .filter((d) => d.expense > 0)
    .sort((a, b) => b.expense - a.expense)[0];

  const insights = [];

  if (summaryNow.txCount === 0) {
    insights.push({
      tone: 'neutral',
      icon: 'empty',
      title: 'Belum ada transaksi di periode ini',
      detail: 'Catat pengeluaran atau pemasukan untuk melihat laporan.'
    });
    return insights;
  }

  if (baseline.avg > 0 && items.length) {
    const worst = items[0];
    insights.push({
      tone: 'warn',
      icon: 'flame',
      title: `Transaksi tidak biasa: ${worst.meta.label}`,
      detail: `${formatRupiahPlain(worst.nominal)} pada ${formatDate(worst.tanggal)} — ${worst.ratio.toFixed(1)}× rata-rata harian ${formatRupiahPlain(baseline.avg)}. Ada ${items.length} transaksi melewati ambang ${settings.threshold.toFixed(1)}×.`
    });
  } else if (baseline.avg > 0) {
    insights.push({
      tone: 'good',
      icon: 'scale',
      title: 'Pengeluaran terkendali',
      detail: `Tidak ada transaksi yang melebihi ${settings.threshold.toFixed(1)}× rata-rata harian ${formatRupiahPlain(baseline.avg)}.`
    });
  }

  if (busiest) {
    insights.push({
      tone: 'neutral',
      icon: 'calendar',
      title: `Hari pengeluaran tertinggi: ${formatDate(busiest.date, 'day')}`,
      detail: `Total ${formatRupiahPlain(busiest.expense)}, yaitu ${((busiest.expense / summaryNow.expense) * 100).toFixed(0)}% dari seluruh pengeluaran periode ini.`
    });
  }

  if (cats.length) {
    const leader = cats[0];
    insights.push({
      tone: 'neutral',
      icon: leader.meta.icon === '📦' ? 'coins' : 'chart',
      title: `Kategori terbesar: ${leader.meta.label}`,
      detail: `${formatRupiahPlain(leader.total)} dari ${formatRupiahPlain(summaryNow.expense)} (${leader.share.toFixed(0)}%) dari ${leader.count} transaksi, rata-rata ${formatRupiahPlain(leader.avg)} per transaksi.`
    });
  }

  if (prevRangeData) {
    const cmp = comparePeriods(list, range, prevRangeData);
    const dir = cmp.delta.expense > 5 ? 'naik' : cmp.delta.expense < -5 ? 'turun' : 'nyaris sama';
    insights.push({
      tone: cmp.delta.expense > 5 ? 'warn' : 'good',
      icon: cmp.delta.expense > 5 ? 'arrowUp' : 'arrowDown',
      title: `Pengeluaran ${dir} ${Math.abs(cmp.delta.expense).toFixed(0)}%`,
      detail: `Dibanding periode sebelumnya: ${formatRupiahPlain(cmp.previous.expense)} → ${formatRupiahPlain(cmp.current.expense)}.`
    });
    if (trends.up.length) {
      insights.push({
        tone: 'warn',
        icon: 'arrowUp',
        title: `Kenaikan terbesar: ${trends.up[0].meta.label}`,
        detail: `+${formatRupiahPlain(trends.up[0].diff)} dibanding periode sebelumnya.`
      });
    }
  }

  if (summaryNow.income > 0) {
    insights.push({
      tone: summaryNow.savingsRate >= 0 ? 'good' : 'warn',
      icon: 'wallet',
      title: `Tingkat tabungan ${summaryNow.savingsRate.toFixed(0)}%`,
      detail: `Dari pemasukan ${formatRupiahPlain(summaryNow.income)}, tersisa ${formatRupiahPlain(summaryNow.net)}. Rata-rata pengeluaran ${formatRupiahPlain(summaryNow.avgExpensePerDay)} per hari.`
    });
  }

  if (streak.best >= 3) {
    insights.push({
      tone: 'neutral',
      icon: 'flame',
      title: `Ber pengeluaran ${streak.best} hari berturut-turut`,
      detail: `Total ${streak.days} hari ada pengeluaran dalam ${range.days} hari periode ini.`
    });
  }

  if (top) {
    insights.push({
      tone: 'neutral',
      icon: top.meta.icon === '📦' ? 'coins' : 'wallet',
      title: `Transaksi terbesar: ${top.meta.label}`,
      detail: `${formatRupiahPlain(top.nominal)}${top.keterangan ? ` — ${top.keterangan}` : ''} pada ${formatDate(top.tanggal)}.`
    });
  }

  return insights;
}

function formatRupiahPlain(n) {
  return `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
}