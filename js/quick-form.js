import { CATEGORIES, SOURCES } from './store.js';
import { ICONS, addDays, clearNode, el, formatNominalInput, formatRupiah, parseNominalInput, svgIcon, toDateStr, todayStr } from './utils.js';

const FREKUENSI = [
  { id: 'harian', label: 'Harian' },
  { id: 'mingguan', label: 'Mingguan' },
  { id: 'bulanan', label: 'Bulanan' },
  { id: 'tahunan', label: 'Tahunan' }
];

export function createQuickForm({ onSubmit, title, compact = false } = {}) {
  let type = 'expense';

  const amountInput = el('input', {
    class: 'amount__input',
    id: `${title || 'form'}-amount`,
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: '0',
    'aria-label': 'Nominal'
  });

  const hint = el('p', { class: 'amount__hint', id: `${title || 'form'}-hint` });

  const typeSwitch = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Jenis transaksi' }, [
    el('button', {
      class: 'segmented__btn is-active',
      type: 'button',
      dataset: { type: 'expense' },
      'aria-pressed': 'true',
      onClick: () => setType('expense')
    }, [svgIcon(ICONS.minus, 16), 'Pengeluaran']),
    el('button', {
      class: 'segmented__btn',
      type: 'button',
      dataset: { type: 'income' },
      'aria-pressed': 'false',
      onClick: () => setType('income')
    }, [svgIcon(ICONS.plus, 16), 'Pemasukan'])
  ]);

  const optionWrap = el('div', { class: 'chips', role: 'group', 'aria-label': 'Kategori' });

  const dateInput = el('input', {
    class: 'field__control field__control--date',
    type: 'date',
    'aria-label': 'Tanggal'
  });
  dateInput.value = todayStr();

  const dateChips = el('div', { class: 'datepick' }, [
    el('button', { class: 'datepick__chip is-active', type: 'button', text: 'Hari ini', dataset: { offset: '0' } }),
    el('button', { class: 'datepick__chip', type: 'button', text: 'Kemarin', dataset: { offset: '-1' } }),
    el('label', { class: 'datepick__manual' }, [
      svgIcon(ICONS.calendar, 16),
      dateInput
    ])
  ]);

  const noteInput = el('input', {
    class: 'field__control',
    type: 'text',
    maxlength: '140',
    placeholder: 'Opsional, mis. makan siang',
    'aria-label': 'Keterangan'
  });

  const frekuensiWrap = el('div', { class: 'chips chips--sm' });
  const frekuensiButtons = FREKUENSI.map((f) =>
    el('button', {
      class: `chip chip--sm${f.id === 'harian' ? ' is-active' : ''}`,
      type: 'button',
      text: f.label,
      dataset: { frekuensi: f.id }
    })
  );
  frekuensiButtons.forEach((b) => b.addEventListener('click', () => selectFrekuensi(b.dataset.frekuensi)));
  frekuensiWrap.append(...frekuensiButtons);
  let frekuensi = 'harian';
  function selectFrekuensi(id) {
    frekuensi = id;
    frekuensiButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.frekuensi === id));
  }

  const errorText = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const submitBtn = el('button', { class: 'btn btn--primary btn--block btn--lg', type: 'submit' });

  const form = el('form', { class: `quick-form${compact ? ' quick-form--compact' : ''}`, novalidate: true }, [
    typeSwitch,
    el('div', { class: 'amount' }, [
      el('span', { class: 'amount__prefix', text: 'Rp' }),
      amountInput
    ]),
    hint,
    errorText,
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Kategori' }),
      optionWrap
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Tanggal' }),
      dateChips
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Keterangan' }),
      noteInput
    ]),
    el('details', { class: 'disclosure' }, [
      el('summary', { class: 'disclosure__summary', text: 'Detail frekuensi' }),
      el('div', { class: 'disclosure__body' }, [frekuensiWrap])
    ]),
    submitBtn
  ]);

  function options() {
    return type === 'expense' ? CATEGORIES : SOURCES;
  }

  function renderOptions() {
    clearNode(optionWrap);
    optionWrap.append(...options().map((opt) => {
      const chip = el('button', {
        class: 'chip',
        type: 'button',
        title: opt.label,
        style: `--tone:${opt.color}`,
        dataset: { value: opt.id }
      }, [el('span', { class: 'chip__label', text: opt.label })]);
      chip.addEventListener('click', () => {
        optionWrap.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        optionWrap.dataset.value = opt.id;
        hideError();
      });
      return chip;
    }));
    optionWrap.dataset.value = options()[0].id;
    optionWrap.querySelector('.chip')?.classList.add('is-active');
  }

  function setType(next) {
    if (type === next) return;
    type = next;
    typeSwitch.querySelectorAll('.segmented__btn').forEach((b) => {
      const active = b.dataset.type === type;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    root.dataset.type = type;
    renderOptions();
    renderSubmit();
    renderHint();
    amountInput.focus();
  }

  function renderSubmit() {
    clearNode(submitBtn);
    submitBtn.append(
      svgIcon(type === 'expense' ? ICONS.minus : ICONS.plus, 18),
      document.createTextNode(type === 'expense' ? 'Catat Pengeluaran' : 'Catat Pemasukan')
    );
    submitBtn.classList.toggle('btn--income', type === 'income');
  }

  function renderHint() {
    const value = parseNominalInput(amountInput.dataset.raw ?? '');
    hint.textContent = '';
    if (!value) return;
    hint.textContent = 'Saldo setelah dicatat: ' + formatRupiah(currentBalanceAfter(value));
  }

  let getBalance = () => 0;
  function currentBalanceAfter(value) {
    const base = getBalance();
    return type === 'expense' ? base - value : base + value;
  }

  amountInput.addEventListener('input', () => {
    const caret = amountInput.selectionStart ?? amountInput.value.length;
    const digitsBefore = amountInput.value.slice(0, caret).replace(/\D/g, '');
    const digits = amountInput.value.replace(/\D/g, '').slice(0, 12);
    const formatted = digits ? formatNominalInput(digits) : '';
    amountInput.dataset.raw = digits;
    amountInput.value = formatted;
    if (formatted) {
      const prefix = digitsBefore.slice(0, digits.length);
      const caretPos = formatNominalInput(prefix).length;
      amountInput.setSelectionRange(caretPos, caretPos);
    }
    hideError();
    renderHint();
  });

  amountInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  dateChips.querySelectorAll('.datepick__chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      dateChips.querySelectorAll('.datepick__chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      dateInput.value = toDateStr(addDays(new Date(), Number(chip.dataset.offset)));
    });
  });

  dateInput.addEventListener('change', () => {
    dateChips.querySelectorAll('.datepick__chip').forEach((c) => c.classList.remove('is-active'));
  });

  function showError(message) {
    errorText.textContent = message;
    errorText.hidden = false;
  }
  function hideError() {
    errorText.hidden = true;
  }

  function reset({ keepType = true } = {}) {
    amountInput.value = '';
    amountInput.dataset.raw = '';
    noteInput.value = '';
    dateInput.value = todayStr();
    dateChips.querySelectorAll('.datepick__chip').forEach((c, i) => c.classList.toggle('is-active', i === 0));
    selectFrekuensi('harian');
    if (!keepType) setType('expense');
    renderHint();
    hideError();
  }

  function fill(tx) {
    type = tx.type === 'income' ? 'income' : 'expense';
    typeSwitch.querySelectorAll('.segmented__btn').forEach((b) => {
      const active = b.dataset.type === type;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    root.dataset.type = type;
    renderOptions();
    amountInput.dataset.raw = String(tx.nominal);
    amountInput.value = formatNominalInput(tx.nominal);
    noteInput.value = tx.keterangan || '';
    dateInput.value = tx.tanggal;
    dateChips.querySelectorAll('.datepick__chip').forEach((c) => c.classList.remove('is-active'));
    selectFrekuensi(tx.frekuensi || 'harian');
    renderSubmit();
    renderHint();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nominal = parseNominalInput(amountInput.dataset.raw ?? '');
    if (!nominal || nominal <= 0) {
      showError('Masukkan nominal lebih dari 0.');
      amountInput.focus();
      return;
    }
    const payload = {
      type,
      nominal,
      tanggal: dateInput.value || todayStr(),
      keterangan: noteInput.value.trim(),
      frekuensi
    };
    if (type === 'expense') payload.kategori = optionWrap.dataset.value;
    else payload.sumber = optionWrap.dataset.value;

    const result = onSubmit?.(payload);
    if (result === false) return;
    reset();
  });

  const root = el('div', { class: 'quick-form-wrap', dataset: { type } });
  root.append(form);
  renderOptions();
  renderSubmit();

  return {
    root,
    form,
    amountInput,
    setType,
    reset,
    fill,
    setBalanceProvider(fn) {
      getBalance = fn;
    },
    focusAmount() {
      amountInput.focus();
    },
    get payload() {
      return {
        type,
        nominal: parseNominalInput(amountInput.dataset.raw ?? ''),
        kategori: optionWrap.dataset.value,
        sumber: optionWrap.dataset.value,
        tanggal: dateInput.value,
        keterangan: noteInput.value.trim(),
        frekuensi
      };
    }
  };
}