'use strict';
const KEY = 'so-nuoc-v1';
const PRE_IDB_BACKUP_KEY = 'so-nuoc-v1-pre-indexeddb-backup';
const DB_NAME = 'so-nuoc-indexeddb';
const DB_VERSION = 1;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const monthValid = m => typeof m === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(m);
function previousMonth(m) { const [y,n] = m.split('-').map(Number); return n === 1 ? `${y-1}-12` : `${y}-${String(n-1).padStart(2,'0')}`; }
function nextMonth(m) { const [y,n] = m.split('-').map(Number); return n === 12 ? `${y+1}-01` : `${y}-${String(n+1).padStart(2,'0')}`; }
function monthsInRange(start, end) {
  if(!monthValid(start) || !monthValid(end) || start>end) return [];
  const months=[];
  for(let month=start;month<=end;month=nextMonth(month)) months.push(month);
  return months;
}
const numberValid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e12;
function defaultHouseholds() { return Object.fromEntries(Array.from({length:200},(_,index)=>[String(index+1),{name:`Hộ dân ${String(index+1).padStart(3,'0')}`,active:true}])); }
function normalizeState(value) {
  const households={...(value.households??defaultHouseholds())};
  for(const houses of Object.values(value.records??{})) for(const id of Object.keys(houses)) households[id]??={name:`Hộ dân ${String(id).padStart(3,'0')}`,active:true};
  return {...value,households};
}
function validateHouseholds(households) {
  if(!households||typeof households!=='object'||Array.isArray(households)) throw Error('Danh sách hộ dân không hợp lệ.');
  for(const [id,household] of Object.entries(households)) {
    if(!/^[1-9]\d*$/.test(id)||!household||typeof household.name!=='string'||!household.name.trim()||household.name.length>100||typeof household.active!=='boolean') throw Error(`Thông tin hộ dân ${id} không hợp lệ.`);
  }
  return households;
}
function buildMonthlyRecords(start, end, previous, currents, debt=0, note='') {
  const months=monthsInRange(start,end);
  if(!numberValid(previous) || months.length===0 || currents.length!==months.length) throw Error('Vui lòng nhập đủ chỉ số cho từng tháng.');
  const result={}; let prior=previous;
  months.forEach((month,index)=>{
    const current=currents[index];
    if(!numberValid(current) || current<prior) throw Error(`Chỉ số mới tháng ${month.split('-').reverse().join('/')} phải lớn hơn hoặc bằng chỉ số trước đó.`);
    result[month]={previous:prior,current,debt:index===months.length-1?debt:0,note:index===months.length-1?note:''};
    prior=current;
  });
  return result;
}
function baseline(records, month, id) { return records[previousMonth(records[month]?.[id]?.startMonth ?? month)]?.[id]?.current ?? records[month]?.[id]?.previous; }
function coveredRecord(records, month, id) {
  for (const end of Object.keys(records).sort()) {
    const record=records[end]?.[id];
    if(record && (record.startMonth ?? end)<=month && month<=end) return {end,record};
  }
  return null;
}
function periodLabel(start, end) { return start===end ? end : `${start} → ${end}`; }
function validateRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw Error('Dữ liệu sao lưu không hợp lệ.');
  for (const [month, houses] of Object.entries(records)) {
    if (!monthValid(month) || !houses || typeof houses !== 'object' || Array.isArray(houses)) throw Error('Tháng trong dữ liệu không hợp lệ.');
    for (const [id, r] of Object.entries(houses)) {
      if (!/^[1-9]\d*$/.test(id) || !r || !numberValid(r.previous) || !numberValid(r.current)) throw Error('Chỉ số hoặc số hộ trong dữ liệu không hợp lệ.');
      if (r.startMonth !== undefined && (!monthValid(r.startMonth) || r.startMonth > month)) throw Error('Tháng bắt đầu phải nhỏ hơn hoặc bằng tháng kết thúc.');
      if (r.debt !== undefined && (!numberValid(r.debt) || !Number.isInteger(r.debt))) throw Error('Số tiền nợ không hợp lệ.');
      if (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > 1000)) throw Error('Ghi chú tối đa 1000 ký tự.');
      if (r.current < baseline(records, month, id)) throw Error(`Hộ ${id}, tháng ${month}: chỉ số mới nhỏ hơn chỉ số tháng trước.`);
    }
  }
  const householdIds=new Set(Object.values(records).flatMap(houses=>Object.keys(houses)));
  for(const id of householdIds) {
    let lastEnd=null;
    for(const end of Object.keys(records).sort()) {
      const r=records[end][id]; if(!r) continue;
      if(lastEnd && (r.startMonth ?? end)<=lastEnd) throw Error(`Hộ ${id}: kỳ ghi bị trùng với kỳ kết thúc tháng ${lastEnd}.`);
      lastEnd=end;
    }
  }
  return records;
}
if (typeof module !== 'undefined') module.exports = {previousMonth, nextMonth, monthsInRange, buildMonthlyRecords, defaultHouseholds, normalizeState, validateHouseholds, baseline, validateRecords, coveredRecord, WEEK};
if (typeof document !== 'undefined') {
  document.querySelector('thead th:last-child').textContent='THAO TÁC';
  document.querySelector('.heading > div > p:last-child').textContent='Quản lý danh sách hộ dân, chỉ số đồng hồ và lượng nước sử dụng theo từng tháng.';
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const fmt = n => new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(n);
  const currentLabel=$('current').closest('label'), previousLabel=$('previous').closest('label'), previousHint=$('previous-hint');
  const periodFields=document.querySelector('.period-fields'), periodHint=document.querySelector('.period-fields + .hint');
  const monthlyReadings=document.createElement('div'), multiToggle=document.createElement('button');
  monthlyReadings.id='monthly-readings'; previousLabel.before(monthlyReadings);
  multiToggle.type='button'; multiToggle.className='multi-toggle'; periodFields.before(multiToggle);
  const clearCacheButton=document.createElement('button');
  clearCacheButton.type='button'; clearCacheButton.className='clear-cache'; clearCacheButton.textContent='Xóa cache localStorage';
  document.querySelector('.notice').append(clearCacheButton);
  const addHouseholdButton=document.createElement('button');
  addHouseholdButton.type='button'; addHouseholdButton.className='add-household'; addHouseholdButton.textContent='＋ Thêm hộ dân';
  $('count').before(addHouseholdButton);
  const householdDialog=document.createElement('dialog');
  householdDialog.className='household-dialog';
  householdDialog.innerHTML='<form id="household-form"><div class="dialog-heading"><div><p class="eyebrow" id="household-mode"></p><h2 id="household-dialog-title"></h2></div><button type="button" id="household-dialog-close" aria-label="Đóng">×</button></div><p class="household-code" id="household-code"></p><label>Tên chủ hộ hoặc tên hộ dân<input id="household-name" maxlength="100" autocomplete="off" required placeholder="Ví dụ: Nguyễn Văn An"></label><p class="hint">Tên này được dùng khi tìm kiếm và xuất Excel. Mã hộ cùng toàn bộ lịch sử chỉ số vẫn giữ nguyên khi đổi tên.</p><p id="household-error" role="alert"></p><div class="dialog-actions"><button type="button" id="household-cancel">Hủy</button><button type="submit" class="primary">Lưu tên hộ</button></div></form>';
  document.body.append(householdDialog);
  previousLabel.hidden=true; previousHint.hidden=true; currentLabel.hidden=true; $('previous').required=false; $('current').required=false;
  periodHint.textContent='Chọn 2 hoặc 3 tháng. Mỗi tháng có chỉ số cũ và chỉ số mới riêng; chỉ số cũ của tháng sau tự lấy từ chỉ số mới tháng trước.';
  let state, database=null, storageMode='indexeddb', ready=false, saving=false, editing = null, householdEditing=null, toastTimer, multiEntry=false;
  const fresh = () => ({version:1, resetAt:Date.now()+WEEK, households:defaultHouseholds(), records:{}});
  function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,5500); }
  const requestResult = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transactionDone = transaction => new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('Giao dịch IndexedDB bị hủy.'));});
  function openDatabase() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('records')) {
          const records=db.createObjectStore('records',{keyPath:['month','houseId']});
          records.createIndex('byMonth','month'); records.createIndex('byHouse','houseId');
        }
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
      };
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('IndexedDB đang bị khóa bởi một cửa sổ khác.'));
    });
  }
  function canonicalState(value) {
    const records={};
    for(const month of Object.keys(value.records).sort()) {
      records[month]={};
      for(const id of Object.keys(value.records[month]).sort((a,b)=>a-b)) records[month][id]=value.records[month][id];
    }
    const households={};
    for(const id of Object.keys(value.households).sort((a,b)=>a-b)) households[id]=value.households[id];
    return {version:value.version,resetAt:value.resetAt,households,records};
  }
  function flattenedRecords(value) {
    const result=new Map();
    for(const [month,houses] of Object.entries(value.records)) for(const [houseId,record] of Object.entries(houses)) result.set(`${month}\u0000${houseId}`,{month,houseId:String(houseId),...record});
    return result;
  }
  async function readDatabaseState(db) {
    const transaction=db.transaction(['records','meta'],'readonly'), recordsStore=transaction.objectStore('records'), metaStore=transaction.objectStore('meta');
    const [meta,rows]=await Promise.all([requestResult(metaStore.get('state')),requestResult(recordsStore.getAll()),transactionDone(transaction)]);
    if(!meta) return null;
    const loaded={version:meta.version,resetAt:meta.resetAt,updatedAt:meta.updatedAt??0,households:meta.households??defaultHouseholds(),records:{}};
    for(const row of rows) {
      const {month,houseId,...record}=row;
      loaded.records[month]??={}; loaded.records[month][houseId]=record;
    }
    if(loaded.version!==1||!Number.isFinite(loaded.resetAt)) throw Error('Thông tin IndexedDB không hợp lệ.');
    const normalized=normalizeState(loaded);
    validateHouseholds(normalized.households); validateRecords(normalized.records); return normalized;
  }
  async function writeDatabaseState(db,before,next) {
    const oldRows=flattenedRecords(before??{records:{}}), newRows=flattenedRecords(next);
    const transaction=db.transaction(['records','meta'],'readwrite'), recordsStore=transaction.objectStore('records'), metaStore=transaction.objectStore('meta');
    for(const [key,row] of oldRows) if(!newRows.has(key)) recordsStore.delete([row.month,row.houseId]);
    for(const [key,row] of newRows) if(!oldRows.has(key)||JSON.stringify(oldRows.get(key))!==JSON.stringify(row)) recordsStore.put(row);
    metaStore.put({key:'state',version:next.version,resetAt:next.resetAt,updatedAt:next.updatedAt??Date.now(),households:next.households});
    await transactionDone(transaction);
  }
  function readLocalState() {
    const raw=localStorage.getItem(KEY); if(!raw) return null;
    const value=normalizeState(JSON.parse(raw));
    if(value.version!==1||!Number.isFinite(value.resetAt)) throw Error('Dữ liệu localStorage không hợp lệ.');
    validateHouseholds(value.households); validateRecords(value.records); return value;
  }
  async function initializeStorage() {
    let localState=null, localError=null, migrated=false;
    try {localState=readLocalState();} catch(err) {localError=err;}
    try {
      database=await openDatabase();
      const databaseState=await readDatabaseState(database);
      if(databaseState) {
        if(localState?.updatedAt>databaseState.updatedAt) {
          await writeDatabaseState(database,databaseState,localState);
          const verified=await readDatabaseState(database);
          if(JSON.stringify(canonicalState(verified))!==JSON.stringify(canonicalState(localState))) throw Error('Xác minh dữ liệu dự phòng sau khi khôi phục không thành công.');
          state=verified;
        } else state=databaseState;
      }
      else {
        const source=localState??fresh();
        await writeDatabaseState(database,null,source);
        const verified=await readDatabaseState(database);
        if(JSON.stringify(canonicalState(verified))!==JSON.stringify(canonicalState(source))) throw Error('Xác minh dữ liệu sau khi chuyển đổi không thành công.');
        state=verified; migrated=Boolean(localState);
      }
      storageMode='indexeddb';
    } catch(err) {
      console.error('Không thể dùng IndexedDB:',err);
      database?.close(); database=null; storageMode='localstorage';
      state=localState??fresh();
      toast(localError?'Không đọc được dữ liệu đã lưu. Dữ liệu cũ chưa bị ghi đè.':'IndexedDB chưa hoạt động; ứng dụng đang dùng dữ liệu localStorage và chưa xóa dữ liệu nào.');
    }
    ready=true;
    document.querySelector('.local').textContent=storageMode==='indexeddb'?'● Đã lưu bằng IndexedDB trên thiết bị':'● Đang dùng localStorage dự phòng';
    render();
    if(migrated) toast('Đã chuyển và xác minh dữ liệu sang IndexedDB. Bản localStorage cũ vẫn được giữ nguyên để dự phòng.');
    else if(localError) toast('Dữ liệu localStorage cũ không đọc được và vẫn được giữ nguyên; IndexedDB đang hoạt động với dữ liệu an toàn hiện có.');
  }
  async function persist(next) {
    if(saving) return false;
    saving=true;
    try {
      const saved={...next,updatedAt:Date.now()};
      if(storageMode==='indexeddb') await writeDatabaseState(database,state,saved);
      else {
        const original=localStorage.getItem(KEY);
        if(original&&localStorage.getItem(PRE_IDB_BACKUP_KEY)===null) localStorage.setItem(PRE_IDB_BACKUP_KEY,original);
        localStorage.setItem(KEY,JSON.stringify(saved));
      }
      state=saved; return true;
    } catch(err) {
      console.error('Không lưu được dữ liệu:',err);
      toast('Không lưu được dữ liệu. Dữ liệu đang hiển thị chưa bị thay đổi; vui lòng xuất bản sao lưu và thử lại.'); return false;
    } finally {saving=false;}
  }
  clearCacheButton.addEventListener('click',()=>{
    if(!ready||saving) return;
    if(storageMode!=='indexeddb') {toast('Không thể xóa localStorage vì hệ thống đang dùng nó làm nơi lưu dự phòng.');return;}
    try {
      const hasOldData=localStorage.getItem(KEY)!==null||localStorage.getItem(PRE_IDB_BACKUP_KEY)!==null;
      if(!hasOldData) {toast('localStorage hiện không có bản dữ liệu cũ cần xóa.');return;}
      if(!confirm('Chỉ xóa các bản dữ liệu cũ trong localStorage. Dữ liệu chính trong IndexedDB vẫn được giữ nguyên. Hãy chắc chắn bạn đã xuất sao lưu nếu cần. Tiếp tục?')) return;
      localStorage.removeItem(KEY); localStorage.removeItem(PRE_IDB_BACKUP_KEY);
      if(localStorage.getItem(KEY)!==null||localStorage.getItem(PRE_IDB_BACKUP_KEY)!==null) throw Error('Không xác minh được thao tác xóa.');
      toast('Đã xóa cache localStorage. Dữ liệu chính trong IndexedDB vẫn an toàn.');
    } catch(err) {console.error('Không xóa được localStorage:',err);toast('Không xóa được cache localStorage. Dữ liệu hiện tại không bị thay đổi.');}
  });
  const now=new Date(); $('month').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  function checkExpiry() { return false; }
  function householdName(id) { return state.households[id]?.name??`Hộ dân ${String(id).padStart(3,'0')}`; }
  function openHouseholdEditor(mode,id=null) {
    if(!ready||saving) return;
    if(mode==='add') {
      const ids=Object.keys(state.households).map(Number);
      id=String((ids.length?Math.max(...ids):0)+1);
    }
    householdEditing={mode,id};
    $('household-mode').textContent=mode==='add'?'THÊM HỘ DÂN MỚI':'CHỈNH SỬA HỘ DÂN';
    $('household-dialog-title').textContent=mode==='add'?'Thêm hộ dân':'Đổi tên hộ dân';
    $('household-code').textContent=`Mã hộ ${id.padStart(3,'0')}`;
    $('household-name').value=mode==='add'?'':householdName(id);
    $('household-error').textContent='';
    householdDialog.showModal(); setTimeout(()=>$('household-name').focus(),0);
  }
  $('household-dialog-close').onclick=$('household-cancel').onclick=()=>householdDialog.close();
  householdDialog.addEventListener('close',()=>{householdEditing=null;});
  $('household-name').addEventListener('input',()=>{$('household-error').textContent='';});
  $('household-form').onsubmit=async e=>{
    e.preventDefault(); if(!householdEditing||saving) return;
    const name=$('household-name').value.trim();
    if(!name||name.length>100) {$('household-error').textContent='Tên hộ dân phải có từ 1 đến 100 ký tự.';return;}
    const {mode,id}=householdEditing, next=JSON.parse(JSON.stringify(state));
    if(mode==='add') next.households[id]={name,active:true}; else next.households[id].name=name;
    if(await persist(next)) {
      householdDialog.close(); render();
      toast(mode==='add'?`Đã thêm ${name} với mã hộ ${id.padStart(3,'0')}.`:`Đã đổi tên mã hộ ${id.padStart(3,'0')} thành ${name}.`);
    }
  };
  function render() {
    const month=$('month').value, records=state.records[month] || {};
    const activeIds=Object.keys(state.households).filter(id=>state.households[id].active).sort((a,b)=>a-b);
    const ids=activeIds.filter(id=>coveredRecord(state.records,month,id)); let total=0;
    Object.keys(records).forEach(id=>total+=records[id].current-baseline(state.records,month,id));
    document.querySelector('.stats article:first-child strong').innerHTML=`${activeIds.length} <small>hộ</small>`;
    document.querySelector('.stats article:first-child p').textContent='Danh sách hộ dân đang quản lý';
    $('recorded').innerHTML=`${ids.length} <small>/ ${activeIds.length} hộ</small>`;
    $('progress').style.width=`${activeIds.length?ids.length/activeIds.length*100:0}%`; $('total').innerHTML=`${fmt(total)} <small>m³</small>`;
    $('total-note').textContent=`Tổng các kỳ kết thúc tháng ${month.split('-').reverse().join('/')}`;

    const query=$('search').value.trim().replace(/^hộ\s*/i,''); let shown=0, html='';
    const displayIds=Object.keys(state.households).filter(id=>state.households[id].active||coveredRecord(state.records,month,id)).sort((a,b)=>a-b);
    for(const id of displayIds) {
      const label=String(id).padStart(3,'0'), household=state.households[id], name=householdName(id), found=coveredRecord(state.records,month,id), r=found?.record, end=found?.end ?? month, filter=$('filter').value;
      if(query && !label.includes(query)&&!name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))) continue;
      if(filter==='done'&&!r || filter==='pending'&&r || filter==='debt'&&!(r?.debt>0)) continue;
      shown++; const prev=baseline(state.records,end,id);
      const customName=name!==`Hộ dân ${label}`, archived=!household.active;
      html+=`<tr><td><span class="house">⌂</span><span>${escape(name)}${customName?`<small class="house-code">Mã hộ ${label}</small>`:''}${archived?'<small class="archived">Đã xóa khỏi danh sách nhập mới</small>':''}</span></td><td>${r?periodLabel(r.startMonth ?? end,end):month}</td><td>${prev===undefined?'—':fmt(prev)}</td><td>${r?fmt(r.current):'—'}</td><td>${r?fmt(r.current-prev):'—'}</td><td class="debt-cell">${r?.debt>0?fmt(r.debt)+' đ':'—'}<small>${escape(r?.note || '')}</small></td><td><span class="badge ${r?.debt>0?'owing':r?'done':''}">${r?.debt>0?'Đang nợ':r?'Đã ghi chỉ số':'Chưa ghi'}</span></td><td><div class="row-actions"><button class="edit" data-id="${id}">${r?'Sửa chỉ số':'＋ Ghi chỉ số'}</button>${r?`<button class="delete" data-delete-id="${id}">Xóa chỉ số</button>`:''}<button class="rename" data-rename-id="${id}">Đổi tên</button><button class="${archived?'restore':'archive'}" data-${archived?'restore':'archive'}-id="${id}">${archived?'Khôi phục hộ':'Xóa hộ'}</button></div></td></tr>`;
    }
    $('rows').innerHTML=html; $('count').textContent=`Hiển thị ${shown} / ${displayIds.length} hộ`; $('empty').hidden=shown!==0;
  }
  ['month','search','filter'].forEach(id=>$(id).addEventListener('input',()=>{ if(!ready||id==='month'&&!monthValid($('month').value)) return; checkExpiry(); render(); }));
  addHouseholdButton.addEventListener('click',()=>openHouseholdEditor('add'));
  $('rows').addEventListener('click',async e=>{
    if(!ready||saving||checkExpiry()) return;
    const renameButton=e.target.closest('button[data-rename-id]');
    if(renameButton) {
      openHouseholdEditor('rename',renameButton.dataset.renameId);
      return;
    }
    const archiveButton=e.target.closest('button[data-archive-id]');
    if(archiveButton) {
      const id=archiveButton.dataset.archiveId, name=householdName(id);
      if(!confirm(`Xóa ${name} (mã hộ ${id.padStart(3,'0')}) khỏi danh sách nhập mới? Toàn bộ lịch sử chỉ số vẫn được giữ lại và có thể khôi phục hộ sau này.`)) return;
      const next=JSON.parse(JSON.stringify(state)); next.households[id].active=false;
      if(await persist(next)) {render();toast(`Đã xóa ${name} khỏi danh sách nhập mới; lịch sử vẫn được giữ nguyên.`);}
      return;
    }
    const restoreButton=e.target.closest('button[data-restore-id]');
    if(restoreButton) {
      const id=restoreButton.dataset.restoreId, next=JSON.parse(JSON.stringify(state)); next.households[id].active=true;
      if(await persist(next)) {render();toast(`Đã khôi phục ${householdName(id)} vào danh sách nhập.`);}
      return;
    }
    const deleteButton=e.target.closest('button[data-delete-id]');
    if(deleteButton) {
      const selectedMonth=$('month').value, id=deleteButton.dataset.deleteId, found=coveredRecord(state.records,selectedMonth,id);
      if(!found) return;
      const start=found.record.startMonth??found.end, period=periodLabel(start,found.end);
      if(!confirm(`Xóa chỉ số hộ dân ${String(id).padStart(3,'0')} của kỳ ${period}? Thao tác này không thể hoàn tác nếu chưa xuất sao lưu.`)) return;
      const next=JSON.parse(JSON.stringify(state)); delete next.records[found.end][id];
      if(Object.keys(next.records[found.end]).length===0) delete next.records[found.end];
      if(await persist(next)) {render();toast(`Đã xóa chỉ số hộ dân ${String(id).padStart(3,'0')} của kỳ ${period}.`);}
      return;
    }
    const button=e.target.closest('button[data-id]'); if(!button) return;
    const month=$('month').value; if(!monthValid(month)) { toast('Vui lòng chọn tháng hợp lệ.'); return; }
    const found=coveredRecord(state.records,month,button.dataset.id);
    editing={id:button.dataset.id,month:found?.end ?? month,originalEnd:found?.end,originalStart:found?.record?.startMonth}; const r=found?.record;
    multiEntry=Boolean(r?.startMonth && r.startMonth!==editing.month);
    $('period-start').value=r?.startMonth ?? editing.month; $('period-start').max=editing.month;
    $('period-end').value=editing.month;
    const inherited=state.records[previousMonth($('period-start').value)]?.[editing.id]?.current;
    $('edit-title').textContent=`${householdName(editing.id)} · Mã hộ ${String(editing.id).padStart(3,'0')}`;
    $('edit-month').textContent=`GHI CHỈ SỐ • THÁNG ${editing.month.split('-').reverse().join('/')}`;
    $('previous').value=inherited??r?.previous??''; $('previous').readOnly=inherited!==undefined;
    $('previous-hint').textContent=inherited!==undefined?'Tự lấy từ chỉ số đã ghi trước kỳ ghi.':'Chưa có chỉ số trước kỳ ghi. Nhập chỉ số ban đầu để làm mốc tính.';
    $('debt').value=r?.debt??0; $('debt-note').value=r?.note??'';
    $('current').value=r?.current??''; $('error').textContent=''; updateEntryMode(); rebuildMonthlyReadings(); preview(); $('editor').showModal();
  });
  multiToggle.addEventListener('click',()=>{
    if(!editing) return;
    multiEntry=!multiEntry;
    if(multiEntry) $('period-start').value=previousMonth($('period-end').value); else {$('period-end').value=editing.month;$('period-start').value=editing.month;}
    updateEntryMode(); rebuildMonthlyReadings(); preview();
  });
  function updateEntryMode() {
    periodFields.hidden=!multiEntry; periodHint.hidden=!multiEntry;
    multiToggle.textContent=multiEntry?'Nhập một tháng':'＋ Nhập 2 hoặc 3 tháng';
    multiToggle.setAttribute('aria-pressed',String(multiEntry));
    $('period-end').readOnly=!multiEntry;
    if(multiEntry) {
      const end=$('period-end').value;
      $('period-start').min=previousMonth(previousMonth(end));
      $('period-start').max=previousMonth(end);
    } else {
      $('period-start').removeAttribute('min'); $('period-start').max=editing.month; $('period-start').value=editing.month;
    }
  }
  $('period-start').addEventListener('input',()=>{
    if(!editing) return;
    rebuildMonthlyReadings(); preview();
  });
  $('period-end').addEventListener('input',()=>{
    if(!editing||!multiEntry||!monthValid($('period-end').value)) return;
    const end=$('period-end').value, minStart=previousMonth(previousMonth(end)), maxStart=previousMonth(end);
    $('period-start').min=minStart; $('period-start').max=maxStart;
    if($('period-start').value<minStart||$('period-start').value>maxStart) $('period-start').value=maxStart;
    const endRecord=state.records[end]?.[editing.id];
    $('debt').value=endRecord?.debt??0; $('debt-note').value=endRecord?.note??'';
    $('edit-month').textContent=`GHI CHỈ SỐ • ĐẾN THÁNG ${monthDisplay(end)}`;
    rebuildMonthlyReadings(); preview();
  });
  function monthDisplay(month) { return month.split('-').reverse().join('/'); }
  function rebuildMonthlyReadings() {
    const saved=new Map([...monthlyReadings.querySelectorAll('.month-reading')].map(card=>[card.dataset.month,{previous:card.querySelector('[data-previous]').value,current:card.querySelector('[data-current]').value}]));
    const months=monthsInRange($('period-start').value,$('period-end').value);
    monthlyReadings.replaceChildren();
    months.forEach((month,index)=>{
      const card=document.createElement('fieldset'); card.className='month-reading'; card.dataset.month=month;
      const legend=document.createElement('legend'); legend.textContent=`Tháng ${monthDisplay(month)}`; card.append(legend);
      const existing=state.records[month]?.[editing.id];
      const exact=existing && (existing.startMonth??month)===month ? existing : null;
      const original=state.records[editing.month]?.[editing.id], originalStart=original?.startMonth??editing.month;
      const inherited=index===0?state.records[previousMonth(month)]?.[editing.id]?.current:undefined;
      const oldLabel=document.createElement('label'); oldLabel.textContent='Chỉ số cũ (m³)';
      const oldInput=document.createElement('input'); oldInput.type='number'; oldInput.min='0'; oldInput.max='1000000000000'; oldInput.step='0.001'; oldInput.required=true; oldInput.dataset.previous='';
      oldInput.value=inherited ?? saved.get(month)?.previous ?? exact?.previous ?? (index===0&&originalStart===month?original?.previous:'') ?? '';
      oldInput.readOnly=index>0||inherited!==undefined; oldLabel.append(oldInput);
      const newLabel=document.createElement('label'); newLabel.textContent='Chỉ số mới (m³)';
      const newInput=document.createElement('input'); newInput.type='number'; newInput.min='0'; newInput.max='1000000000000'; newInput.step='0.001'; newInput.required=true; newInput.dataset.current='';
      newInput.value=saved.get(month)?.current ?? exact?.current ?? (month===editing.month?original?.current:'') ?? '';
      newInput.addEventListener('input',()=>{syncMonthlyPrevious();preview();}); newLabel.append(newInput);
      card.append(oldLabel,newLabel); monthlyReadings.append(card);
    });
    syncMonthlyPrevious();
  }
  function syncMonthlyPrevious() {
    const cards=[...monthlyReadings.querySelectorAll('.month-reading')];
    cards.slice(1).forEach((card,index)=>card.querySelector('[data-previous]').value=cards[index].querySelector('[data-current]').value);
  }
  function currentValues() { return [...monthlyReadings.querySelectorAll('[data-current]')].map(input=>input.value); }
  function startingPrevious() { return monthlyReadings.querySelector('[data-previous]')?.value??''; }
  function preview() {
    const previous=startingPrevious(), values=currentValues(), complete=previous!==''&&values.length>0&&values.every(value=>value!=='');
    const monotonic=complete&&values.reduce((prior,value)=>prior!==false&&+value>=prior?+value:false,+previous)!==false;
    const count=monthsInRange($('period-start').value,$('period-end').value).length;
    $('preview').textContent=monotonic?`${fmt(+values.at(-1)- +previous)} m³ / ${count} tháng`:'— m³';
  }
  $('close').onclick=()=>$('editor').close();
  $('edit-form').onsubmit=async e=>{
    e.preventDefault(); if(checkExpiry()||!editing) return;
    const next=JSON.parse(JSON.stringify(state)), {id}=editing, start=$('period-start').value, end=$('period-end').value;
    const selectedMonths=monthsInRange(start,end);
    if((multiEntry && (selectedMonths.length<2||selectedMonths.length>3)) || (!multiEntry&&selectedMonths.length!==1)) {$('error').textContent='Chế độ nhập nhiều tháng chỉ cho phép chọn 2 hoặc 3 tháng.';return;}
    let entries;
    try { entries=buildMonthlyRecords(start,end,Number(startingPrevious()),currentValues().map(Number),Number($('debt').value),$('debt-note').value.trim()); }
    catch(err) {$('error').textContent=err.message;return;}
    const previousEntries={};
    for(const entryMonth of Object.keys(entries)) previousEntries[entryMonth]=next.records[entryMonth]?.[id];
    if(editing.originalEnd&&selectedMonths.includes(editing.originalEnd)) delete next.records[editing.originalEnd]?.[id];
    for(const [entryMonth,entry] of Object.entries(entries)) {
      const old=previousEntries[entryMonth];
      next.records[entryMonth]??={};
      next.records[entryMonth][id]={...entry,...(entryMonth===end?{}:{debt:old?.debt??0,note:old?.note??''})};
    }
    try {validateRecords(next.records);} catch(err) {$('error').textContent=err.message+' Hãy kiểm tra cả chỉ số tháng kế tiếp nếu đang sửa tháng cũ.';return;}
    if(await persist(next)) {$('editor').close();render();toast(Object.keys(entries).length>1?'Đã lưu chỉ số riêng cho từng tháng.':'Đã lưu chỉ số nước.');}
  };
  $('excel').onclick=()=>{
    if(!ready) return;
    const rows=[['Kỳ ghi (từ tháng → đến tháng)','Hộ dân','Chỉ số cũ (m³)','Chỉ số mới (m³)','Tiêu thụ (m³)','Số tiền đang nợ (đ)','Trạng thái','Ghi chú nợ']];
    for(const month of Object.keys(state.records).sort()) {
      for(const id of Object.keys(state.records[month]).sort((a,b)=>a-b)) {
        const r=state.records[month][id], prev=baseline(state.records,month,id);
        rows.push([periodLabel(r.startMonth ?? month,month),`${householdName(id)} (mã hộ ${String(id).padStart(3,'0')})`,prev,r.current,Math.round((r.current-prev)*1000)/1000,r.debt||0,r.debt>0?'Đang nợ':'Đã ghi chỉ số',r.note||'']);
      }
    }
    if(rows.length===1) {toast('Chưa có dữ liệu để xuất Excel.');return;}
    const url=URL.createObjectURL(excelWorkbook(rows)), a=document.createElement('a');
    a.href=url;a.download='so-nuoc-tat-ca-thang.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Đã xuất Excel tất cả tháng đã ghi.');
  };
  $('export').onclick=()=>{
    if(!ready) return;
    checkExpiry(); const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=`so-nuoc-${new Date().toISOString().slice(0,10)}.json`; a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('import').onclick=()=>{if(ready)$('file').click();};
  $('file').onchange=async e=>{
    if(!ready) return;
    const file=e.target.files[0];if(!file)return;
    try {
      if(file.size>5*1024*1024)throw Error('Tệp sao lưu quá lớn (tối đa 5 MB).');
      const data=normalizeState(JSON.parse(await file.text())); if(data.version!==1)throw Error('Không đúng định dạng sao lưu Sổ nước.');
      validateHouseholds(data.households); validateRecords(data.records); checkExpiry();
      if(!confirm('Nhập bản sao lưu sẽ thay thế toàn bộ chỉ số hiện tại . Tiếp tục?'))return;
      if(await persist({...fresh(),households:data.households,records:data.records})) {render();toast('Đã khôi phục dữ liệu.');}
    } catch(err){toast(err instanceof SyntaxError?'Tệp JSON không hợp lệ.':err.message);} finally {e.target.value='';}
  };

  initializeStorage();
}

// An uncompressed ZIP container keeps Excel export available offline.
function excelWorkbook(rows) {
  const enc = new TextEncoder();
  const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
  const sheet = rows.map(row => '<row>'+row.map(value => typeof value === 'number' ? `<c><v>${value}</v></c>` : `<c t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')+'</row>').join('');
  const files = {
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sổ nước" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="7" width="20" customWidth="1"/><col min="8" max="8" width="55" customWidth="1"/></cols><sheetData>${sheet}</sheetData></worksheet>`
  };
  const parts=[], central=[]; let offset=0, centralSize=0;
  for (const [path, content] of Object.entries(files)) {
    const name=enc.encode(path), data=enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+content);
    let crc=0xffffffff;
    for(const byte of data) {crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    crc=(crc^0xffffffff)>>>0;
    const header=new Uint8Array(30), h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
    const entry=new Uint8Array(46), c=new DataView(entry.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
    parts.push(header,name,data);central.push(entry,name);offset+=header.length+name.length+data.length;centralSize+=entry.length+name.length;
  }
  const end=new Uint8Array(22), e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length/2,true);e.setUint16(10,central.length/2,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
if(typeof module!=='undefined') module.exports.excelWorkbook=excelWorkbook;
