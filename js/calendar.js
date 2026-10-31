import * as store from './store.js';
import {
  el,
  initTheme,
  openSettings,
  setupInstall,
  setupSyncBadge,
  setupThemeToggle,
  setupUpdateCheck,
  openSheet
} from './ui.js';
import { Api } from './api.js';

const filterChips = document.getElementById('calendarFilterChips');
const listEl = document.getElementById('calendarList');
const emptyEl = document.getElementById('calendarEmpty');
const addBtn = document.getElementById('addCalendarBtn');
const fabBtn = document.getElementById('fabAddCalendar');

const filters = [
  { id: 'all', label: 'Semua' },
  { id: 'schedule', label: 'Jadwal Anak' },
  { id: 'birthday', label: 'Ulang Tahun' },
  { id: 'bill', label: 'Tagihan' }
];

let activeFilter = 'all';
let items = [];
let editing = null;

function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

function groupByDate(arr){
  const map = new Map();
  for(const it of arr){
    const key = it.date || it.start_date || '';
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  const keys = Array.from(map.keys()).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  return keys.map(k=>({date:k, items: map.get(k)}));
}

function typeLabel(t){
  if(t==='schedule') return 'Jadwal';
  if(t==='birthday') return 'Ulang Tahun';
  if(t==='bill') return 'Tagihan';
  return t;
}

function typeTone(t){
  if(t==='birthday') return 'income';
  if(t==='bill') return 'warn';
  return 'primary';
}

function renderChips(){
  if(!filterChips) return;
  filterChips.innerHTML = '';
  for(const f of filters){
    const btn = el('button', { class: `chip${activeFilter===f.id?' is-active':''}`, type:'button', 'data-filter': f.id }, f.label);
    btn.addEventListener('click', ()=>{
      activeFilter = f.id;
      renderChips();
      renderList();
    });
    filterChips.appendChild(btn);
  }
}

function renderList(){
  if(!listEl) return;
  listEl.innerHTML = '';
  let data = items.slice();
  if(activeFilter !== 'all') data = data.filter(x=>x.type===activeFilter);
  data.sort((a,b)=>{
    const da=a.date||a.start_date||'';
    const db=b.date||b.start_date||'';
    if(da!==db) return da.localeCompare(db);
    return (a.time||'').localeCompare(b.time||'');
  });
  if(data.length===0){
    if(emptyEl) emptyEl.hidden=false;
    return;
  }
  if(emptyEl) emptyEl.hidden=true;
  const groups = groupByDate(data);
  const today = todayStr();
  for(const g of groups){
    const head = el('div', { class:'list__group' }, g.date === today ? 'Hari Ini' : g.date);
    listEl.appendChild(head);
    for(const it of g.items){
      const row = el('button', { class:'list__row', type:'button' });
      const left = el('div', { class:'list__main' });
      const title = el('div', { class:'list__title' }, it.title || '(Tanpa judul)');
      const metaParts = [];
      if(it.time) metaParts.push(it.time);
      if(it.child) metaParts.push(it.child);
      const meta = el('div', { class:'list__meta' }, metaParts.join(' • '));
      left.appendChild(title); if(meta.textContent.trim()) left.appendChild(meta);
      const right = el('div', { class:'list__aside' });
      const badge = el('span', { class:`badge badge--${typeTone(it.type)}` }, typeLabel(it.type));
      right.appendChild(badge);
      if(it.type==='bill'){
        if(it.amount!=null){
          const amt = el('span', { class:'num list__amount' }, `Rp ${Number(it.amount).toLocaleString('id-ID')}`);
          right.appendChild(amt);
        }
        const st = el('span', { class:`pill pill--${it.status==='paid'?'ok':'warn'}` }, it.status==='paid'?'Lunas':'Belum lunas');
        right.appendChild(st);
      }
      row.appendChild(left); row.appendChild(right);
      row.addEventListener('click', ()=>openForm(it));
      listEl.appendChild(row);
    }
  }
}

async function load(){
  try{
    const res = await Api.get('/api/calendar-items?limit=200');
    if(res && res.items) items = res.items;
  }catch(e){}
  renderList();
}

function openForm(item=null){
  editing = item ? {...item} : null;
  const isEdit = !!editing;
  const body = el('div', { class:'sheet-form' });
  const form = el('form', { class:'form', novalidate:true });
  
  const typeWrap = el('div', { class:'field' });
  typeWrap.appendChild(el('label', { class:'field__label' }, 'Tipe'));
  const typeSel = el('select', { class:'select', name:'type' });
  [['schedule','Jadwal Anak'],['birthday','Ulang Tahun'],['bill','Tagihan']].forEach(([v,l])=>{
    const opt = el('option',{value:v}, l);
    if((editing?.type||'schedule')===v) opt.selected=true;
    typeSel.appendChild(opt);
  });
  typeWrap.appendChild(typeSel);
  form.appendChild(typeWrap);
  
  const title = el('div', { class:'field' });
  title.appendChild(el('label', { class:'field__label' }, 'Judul'));
  title.appendChild(el('input', { class:'input', name:'title', required:true, placeholder:'Contoh: Les renang / Ulang tahun / Listrik', value: editing?.title||'' }));
  form.appendChild(title);
  
  const row = el('div', { class:'grid grid--2' });
  const date = el('div', { class:'field' });
  date.appendChild(el('label', { class:'field__label' }, 'Tanggal'));
  date.appendChild(el('input', { class:'input', type:'date', name:'date', value: editing?.date||todayStr() }));
  row.appendChild(date);
  const time = el('div', { class:'field' });
  time.appendChild(el('label', { class:'field__label' }, 'Jam (opsional)'));
  time.appendChild(el('input', { class:'input', type:'time', name:'time', value: editing?.time||'' }));
  row.appendChild(time);
  form.appendChild(row);
  
  const child = el('div', { class:'field' });
  child.appendChild(el('label', { class:'field__label' }, 'Nama anak (opsional)'));
  child.appendChild(el('input', { class:'input', name:'child', value: editing?.child||'' }));
  form.appendChild(child);
  
  const billRow = el('div', { class:'grid grid--2' });
  const amount = el('div', { class:'field' });
  amount.appendChild(el('label', { class:'field__label' }, 'Nominal tagihan (opsional)'));
  amount.appendChild(el('input', { class:'input', name:'amount', inputmode:'numeric', placeholder:'Contoh: 250000', value: editing?.amount!=null?String(editing.amount):'' }));
  billRow.appendChild(amount);
  const status = el('div', { class:'field' });
  status.appendChild(el('label', { class:'field__label' }, 'Status'));
  const stSel = el('select', { class:'select', name:'status' });
  [['pending','Belum lunas'],['paid','Lunas'],['done','Selesai']].forEach(([v,l])=>{
    const opt = el('option',{value:v}, l);
    if((editing?.status||'pending')===v) opt.selected=true;
    stSel.appendChild(opt);
  });
  status.appendChild(stSel);
  billRow.appendChild(status);
  form.appendChild(billRow);
  
  const notes = el('div', { class:'field' });
  notes.appendChild(el('label', { class:'field__label' }, 'Catatan (opsional)'));
  notes.appendChild(el('textarea', { class:'textarea', name:'notes', rows:'3' }, editing?.notes||''));
  form.appendChild(notes);
  
  const err = el('div', { class:'form-error', hidden:true });
  form.appendChild(err);
  
  const actions = el('div', { class:'btn-row' });
  if(isEdit){
    const del = el('button', { class:'btn btn--ghost btn--danger', type:'button' }, 'Hapus');
    del.addEventListener('click', async ()=>{
      if(!confirm('Hapus agenda ini?')) return;
      try{
        await Api.del('/api/calendar-item', { id: editing.id });
        handle.close();
        await load();
      }catch(e){ err.textContent=e.message||'Gagal menghapus'; err.hidden=false; }
    });
    actions.appendChild(del);
    const save = el('button', { class:'btn btn--primary', type:'submit' }, 'Simpan');
    actions.appendChild(save);
  }else{
    const cancel = el('button', { class:'btn btn--ghost', type:'button' }, 'Batal');
    cancel.addEventListener('click', ()=>handle.close());
    actions.appendChild(cancel);
    const save = el('button', { class:'btn btn--primary', type:'submit' }, 'Simpan');
    actions.appendChild(save);
  }
  
  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    err.hidden=true;
    const fd = new FormData(form);
    const data = {
      type: fd.get('type'),
      title: fd.get('title'),
      date: fd.get('date'),
      time: fd.get('time')||'',
      child: fd.get('child')||'',
      amount: fd.get('amount')||'',
      status: fd.get('status'),
      notes: fd.get('notes')||''
    };
    if(isEdit) data.id = editing.id;
    try{
      if(isEdit) await Api.patch('/api/calendar-item', data);
      else await Api.post('/api/calendar-items', data);
      handle.close();
      await load();
    }catch(e){ err.textContent=e.message||'Gagal menyimpan'; err.hidden=false; }
  });
  
  body.appendChild(form);
  const handle = openSheet({ title: isEdit?'Ubah Agenda':'Tambah Agenda', subtitle: 'Jadwal anak, ulang tahun & tagihan', body, footer: actions });
}

function init(){
  const themeToggle = document.getElementById('themeToggle');
  const settingsBtn = document.getElementById('settingsBtn');
  const syncBadge = document.getElementById('syncBadge');
  const accountBtn = document.getElementById('accountBtn');

  initTheme();
  setupThemeToggle(themeToggle, () => store.getState().settings.theme);
  setupSyncBadge(syncBadge, accountBtn);
  setupInstall();
  setupUpdateCheck();
  settingsBtn?.addEventListener('click', () => openSettings());

  renderChips();
  if(addBtn) addBtn.addEventListener('click', (e)=>{ e.preventDefault(); openForm(null); });
  if(fabBtn) fabBtn.addEventListener('click', (e)=>{ e.preventDefault(); openForm(null); });
  load();
}

async function guard(){
  try{
    if(Api?.session){ await Api.session(); return true; }
  }catch(e){
    window.location.replace('login.html?alasan=keluar');
    return false;
  }
  return true;
}

guard().then(ok=>{ if(ok) init(); });
