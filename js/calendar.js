import { store } from './store.js';
import { el } from './ui.js';
import { Api } from './api.js';
import { requireAuth } from './auth-guard.js';

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

function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

function groupByDate(arr){
  const map = new Map();
  for(const it of arr){
    const key = it.date || it.start_date || '';
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  const keys = Array.from(map.keys()).sort((a,b)=>a.localeCompare(b));
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
      const meta = el('div', { class:'list__meta' }, [it.time?`• ${it.time}`:'', it.child?`• ${it.child}`:''].filter(Boolean).join(' ').replace('• •','•'));
      left.appendChild(title); if(meta.textContent.trim()) left.appendChild(meta);
      const right = el('div', { class:'list__aside' });
      const badge = el('span', { class:`badge badge--${typeTone(it.type)}` }, typeLabel(it.type));
      right.appendChild(badge);
      if(it.type==='bill' && it.amount){
        const amt = el('span', { class:'num list__amount' }, `Rp ${Number(it.amount).toLocaleString('id-ID')}`);
        right.appendChild(amt);
      }
      if(it.type==='bill'){
        const st = el('span', { class:`pill pill--${it.status==='paid'?'ok':'warn'}` }, it.status==='paid'?'Lunas':'Belum lunas');
        right.appendChild(st);
      }
      row.appendChild(left); row.appendChild(right);
      listEl.appendChild(row);
    }
  }
}

async function load(){
  try{
    // Coba ambil dari API kalau ada
    const res = await Api.get('/api/calendar-items?limit=200').catch(()=>null);
    if(res && res.items) items = res.items;
  }catch(e){}
  renderList();
}

function openForm(){
  // Untuk preview visual dulu, cukup info ringan. Bisa dilengkapi nanti.
  alert('Form tambah/edit akan muncul di sini (sesuai desain modal yang dipakai aplikasi).');
}

function init(){
  renderChips();
  if(addBtn) addBtn.addEventListener('click', openForm);
  if(fabBtn) fabBtn.addEventListener('click', openForm);
  load();
}

requireAuth().then(init).catch(()=>{});
