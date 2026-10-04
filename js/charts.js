import { formatRupiah } from './utils.js';
import { cssVar } from './ui.js';

function theme() {
  return {
    text: cssVar('--text-soft', '#9aa3b8'),
    dim: cssVar('--text-muted', '#5c6478'),
    grid: cssVar('--chart-grid', 'rgba(255,255,255,0.06)'),
    surface: cssVar('--surface-2', '#161a26'),
    border: cssVar('--border', 'rgba(255,255,255,0.09)'),
    income: cssVar('--income', '#2fd6a5'),
    expense: cssVar('--expense', '#fb7185'),
    net: cssVar('--primary', '#7c8cff'),
    tooltipTitle: cssVar('--text', '#f2f4f8')
  };
}

export function chartAvailable() {
  return typeof window.Chart !== 'undefined';
}

function baseOptions(t, extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 420 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.surface,
        titleColor: t.tooltipTitle,
        bodyColor: t.text,
        borderColor: t.border,
        borderWidth: 1,
        padding: 12,
        cornerRadius: 12,
        displayColors: true,
        boxWidth: 10,
        boxHeight: 10,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${formatRupiah(ctx.parsed.y ?? ctx.parsed, { sign: (ctx.parsed.y ?? ctx.parsed) < 0 })}`
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: t.dim, maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } }
      },
      y: {
        beginAtZero: true,
        grid: { color: t.grid },
        border: { display: false },
        ticks: {
          color: t.dim,
          font: { size: 11 },
          maxTicksLimit: 6,
          callback: (v) => formatRupiah(v, { compact: true, prefix: '' })
        }
      }
    },
    ...extra
  };
}

export function createCashflowChart(canvas, buckets, { showCumulative = false } = {}) {
  if (!chartAvailable()) return null;
  const t = theme();
  const labels = buckets.map((b) => b.label);
  const hex = (color, alpha) => colorToRgba(color, alpha);

  const datasets = [
    {
      type: 'bar',
      label: 'Pemasukan',
      data: buckets.map((b) => b.income),
      backgroundColor: hex(t.income, 0.55),
      hoverBackgroundColor: t.income,
      borderRadius: 6,
      borderSkipped: false,
      barPercentage: 0.72,
      categoryPercentage: 0.7,
      order: 2
    },
    {
      type: 'bar',
      label: 'Pengeluaran',
      data: buckets.map((b) => b.expense),
      backgroundColor: hex(t.expense, 0.6),
      hoverBackgroundColor: t.expense,
      borderRadius: 6,
      borderSkipped: false,
      barPercentage: 0.72,
      categoryPercentage: 0.7,
      order: 2
    }
  ];

  if (showCumulative) {
    datasets.push({
      type: 'line',
      label: 'Saldo kumulatif',
      data: buckets.map((b) => b.cumulative),
      borderColor: t.net,
      backgroundColor: 'transparent',
      borderWidth: 2,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderDash: [4, 4],
      order: 1
    });
  }

  const canvasNode = canvas;
  const options = baseOptions(t);
  if (showCumulative) {
    options.scales.y.suggestedMin = undefined;
    options.plugins.tooltip.callbacks.label = (ctx) => {
      const value = ctx.parsed.y ?? 0;
      return ` ${ctx.dataset.label}: ${formatRupiah(value, { sign: value < 0 })}`;
    };
  }
  options.scales.x.stacked = false;

  return new window.Chart(canvasNode.getContext('2d'), {
    data: { labels, datasets },
    options
  });
}

export function createCategoryChart(canvas, rows, { centerLabel, centerValue } = {}) {
  if (!chartAvailable()) return null;
  const t = theme();
  const data = rows.length ? rows : [{ key: 'Kosong', total: 1, meta: { label: 'Belum ada data', color: t.grid } }];
  const labels = data.map((r) => r.meta?.label || r.key);

  return new window.Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data: data.map((r) => r.total),
          backgroundColor: data.map((r) => r.meta?.color || cssVar('--accent', '#7c8cff')),
          borderColor: t.surface,
          borderWidth: 3,
          hoverOffset: 6,
          hoverBorderColor: t.surface
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { duration: 450 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: t.surface,
          titleColor: t.tooltipTitle,
          bodyColor: t.text,
          borderColor: t.border,
          borderWidth: 1,
          padding: 12,
          cornerRadius: 12,
          usePointStyle: true,
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const share = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${formatRupiah(ctx.parsed)} · ${share}%`;
            }
          }
        }
      }
    },
    plugins: [
      {
        id: 'centerText',
        afterDraw(chart) {
          if (!centerLabel || !centerValue) return;
          const { ctx, chartArea } = chart;
          if (!chartArea) return;
          const x = (chartArea.left + chartArea.right) / 2;
          const y = (chartArea.top + chartArea.bottom) / 2;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.fillStyle = t.dim;
          ctx.font = `500 11px ${getComputedStyle(document.body).fontFamily}`;
          ctx.fillText(centerLabel.toUpperCase(), x, y - 10);
          ctx.fillStyle = cssVar('--text', '#f2f4f8');
          ctx.font = `700 17px ${getComputedStyle(document.body).fontFamily}`;
          ctx.fillText(centerValue, x, y + 12);
          ctx.restore();
        }
      }
    ]
  });
}

export function destroyChart(chart) {
  if (chart && typeof chart.destroy === 'function') chart.destroy();
  return null;
}

function colorToRgba(color, alpha) {
  const value = String(color).trim();
  if (value.startsWith('#')) {
    const hex = value.length === 4
      ? value.slice(1).split('').map((c) => c + c).join('')
      : value.slice(1, 6);
    const num = parseInt(hex, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }
  if (value.startsWith('rgb')) {
    return value.replace(/rgba?\(([^)]+)\)/, (_, inner) => {
      const parts = inner.split(/[,\s/]+/).filter(Boolean);
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
    });
  }
  return value;
}