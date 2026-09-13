'use strict';
const KEY = 'so-nuoc-v1';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const monthValid = m => typeof m === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(m);
function previousMonth(m) { const [y,n] = m.split('-').map(Number); return n === 1 ? `${y-1}-12` : `${y}-${String(n-1).padStart(2,'0')}`; }
const numberValid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e12;
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
      if (!/^[1-9]\d*$/.test(id) || +id > 200 || !r || !numberValid(r.previous) || !numberValid(r.current)) throw Error('Chỉ số hoặc số hộ trong dữ liệu không hợp lệ.');
      if (r.startMonth !== undefined && (!monthValid(r.startMonth) || r.startMonth > month)) throw Error('Tháng bắt đầu phải nhỏ hơn hoặc bằng tháng kết thúc.');
      if (r.debt !== undefined && (!numberValid(r.debt) || !Number.isInteger(r.debt))) throw Error('Số tiền nợ không hợp lệ.');
      if (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > 1000)) throw Error('Ghi chú tối đa 1000 ký tự.');
      if (r.current < baseline(records, month, id)) throw Error(`Hộ ${id}, tháng ${month}: chỉ số mới nhỏ hơn chỉ số tháng trước.`);
    }
  }
  for(let id=1;id<=200;id++) {
    let lastEnd=null;
    for(const end of Object.keys(records).sort()) {
      const r=records[end][id]; if(!r) continue;
      if(lastEnd && (r.startMonth ?? end)<=lastEnd) throw Error(`Hộ ${id}: kỳ ghi bị trùng với kỳ kết thúc tháng ${lastEnd}.`);
      lastEnd=end;
    }
  }
  return records;
}
if (typeof module !== 'undefined') module.exports = {previousMonth, baseline, validateRecords, coveredRecord, WEEK};
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const fmt = n => new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(n);
  let state, editing = null, toastTimer;
  const fresh = () => ({version:1, resetAt:Date.now()+WEEK, records:{}});
  function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,5500); }
  function persist(next) { try { localStorage.setItem(KEY,JSON.stringify(next)); state=next; return true; } catch { toast('Không lưu được dữ liệu. Hãy kiểm tra quyền lưu trữ hoặc dung lượng trình duyệt.'); return false; } }
  try {
    const raw=localStorage.getItem(KEY);
    state=raw ? JSON.parse(raw) : fresh();
    if(state.version!==1 || !Number.isFinite(state.resetAt)) throw Error();
    validateRecords(state.records);

    persist(state);
  } catch { state=fresh(); toast('Không đọc được dữ liệu đã lưu. Bạn có thể nhập lại bản sao lưu; dữ liệu cũ chưa bị ghi đè.'); }
  const now=new Date(); $('month').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  function checkExpiry() { return false; }
  function render() {
    const month=$('month').value, records=state.records[month] || {};
    const ids=Array.from({length:200},(_,i)=>i+1).filter(id=>coveredRecord(state.records,month,id)); let total=0;
    Object.keys(records).forEach(id=>total+=records[id].current-baseline(state.records,month,id));
    $('recorded').innerHTML=`${ids.length} <small>/ 200 hộ</small>`;
    $('progress').style.width=`${ids.length/2}%`; $('total').innerHTML=`${fmt(total)} <small>m³</small>`;
    $('total-note').textContent=`Tổng các kỳ kết thúc tháng ${month.split('-').reverse().join('/')}`;

    const query=$('search').value.trim().replace(/^hộ\s*/i,''); let shown=0, html='';
    for(let id=1;id<=200;id++) {
      const label=String(id).padStart(3,'0'), found=coveredRecord(state.records,month,id), r=found?.record, end=found?.end ?? month, filter=$('filter').value;
      if(query && !label.includes(query)) continue;
      if(filter==='done'&&!r || filter==='pending'&&r || filter==='debt'&&!(r?.debt>0)) continue;
      shown++; const prev=baseline(state.records,end,id);
      html+=`<tr><td><span class="house">⌂</span>Hộ dân ${label}</td><td>${r?periodLabel(r.startMonth ?? end,end):month}</td><td>${prev===undefined?'—':fmt(prev)}</td><td>${r?fmt(r.current):'—'}</td><td>${r?fmt(r.current-prev):'—'}</td><td class="debt-cell">${r?.debt>0?fmt(r.debt)+' đ':'—'}<small>${escape(r?.note || '')}</small></td><td><span class="badge ${r?.debt>0?'owing':r?'done':''}">${r?.debt>0?'Đang nợ':r?'Đã ghi chỉ số':'Chưa ghi'}</span></td><td><button class="edit" data-id="${id}">${r?'Sửa chỉ số':'＋ Ghi chỉ số'}</button></td></tr>`;
    }
    $('rows').innerHTML=html; $('count').textContent=`Hiển thị ${shown} / 200 hộ`; $('empty').hidden=shown!==0;
  }
  ['month','search','filter'].forEach(id=>$(id).addEventListener('input',()=>{ if(id==='month'&&!monthValid($('month').value)) return; checkExpiry(); render(); }));
  $('rows').addEventListener('click',e=>{
    const button=e.target.closest('button[data-id]'); if(!button||checkExpiry()) return;
    const month=$('month').value; if(!monthValid(month)) { toast('Vui lòng chọn tháng hợp lệ.'); return; }
    const found=coveredRecord(state.records,month,button.dataset.id);
    editing={id:button.dataset.id,month:found?.end ?? month}; const r=found?.record;
    $('period-start').value=r?.startMonth ?? editing.month; $('period-start').max=editing.month;
    $('period-end').value=editing.month;
    const inherited=state.records[previousMonth($('period-start').value)]?.[editing.id]?.current;
    $('edit-title').textContent=`Hộ dân ${String(editing.id).padStart(3,'0')}`;
    $('edit-month').textContent=`GHI CHỈ SỐ • THÁNG ${editing.month.split('-').reverse().join('/')}`;
    $('previous').value=inherited??r?.previous??''; $('previous').readOnly=inherited!==undefined;
    $('previous-hint').textContent=inherited!==undefined?'Tự lấy từ chỉ số đã ghi trước kỳ ghi.':'Chưa có chỉ số trước kỳ ghi. Nhập chỉ số ban đầu để làm mốc tính.';
    $('debt').value=r?.debt??0; $('debt-note').value=r?.note??'';
    $('current').value=r?.current??''; $('error').textContent=''; preview(); $('editor').showModal();
  });
  $('period-start').addEventListener('input',()=>{
    if(!editing) return;
    const start=$('period-start').value;
    const inherited=state.records[previousMonth(start)]?.[editing.id]?.current;
    $('previous').readOnly=inherited!==undefined;
    $('previous').value=inherited ?? state.records[editing.month]?.[editing.id]?.previous ?? '';
    $('previous-hint').textContent=inherited!==undefined?'Tự lấy chỉ số cuối tháng trước kỳ ghi.':'Nhập chỉ số cuối tháng trước kỳ ghi làm mốc.';
    preview();
  });
  function preview() { const a=$('previous').value,b=$('current').value; $('preview').textContent=a!==''&&b!==''&&+b>=+a?`${fmt(+b- +a)} m³ / kỳ`:'— m³'; }
  ['previous','current'].forEach(id=>$(id).addEventListener('input',preview));
  $('close').onclick=()=>$('editor').close();
  $('edit-form').onsubmit=e=>{
    e.preventDefault(); if(checkExpiry()||!editing) return;
    const next=JSON.parse(JSON.stringify(state)), {id,month}=editing;
    next.records[month]??={}; next.records[month][id]={startMonth:$('period-start').value,previous:Number($('previous').value),current:Number($('current').value),debt:Number($('debt').value),note:$('debt-note').value.trim()};
    try {validateRecords(next.records);} catch(err) {$('error').textContent=err.message+' Hãy kiểm tra cả chỉ số tháng kế tiếp nếu đang sửa tháng cũ.';return;}
    if(persist(next)) {$('editor').close();render();toast('Đã lưu chỉ số nước.');}
  };
  $('excel').onclick=()=>{
    const rows=[['Kỳ ghi (từ tháng → đến tháng)','Hộ dân','Chỉ số cũ (m³)','Chỉ số mới (m³)','Tiêu thụ (m³)','Số tiền đang nợ (đ)','Trạng thái','Ghi chú nợ']];
    for(const month of Object.keys(state.records).sort()) {
      for(const id of Object.keys(state.records[month]).sort((a,b)=>a-b)) {
        const r=state.records[month][id], prev=baseline(state.records,month,id);
        rows.push([periodLabel(r.startMonth ?? month,month),`Hộ dân ${String(id).padStart(3,'0')}`,prev,r.current,Math.round((r.current-prev)*1000)/1000,r.debt||0,r.debt>0?'Đang nợ':'Đã ghi chỉ số',r.note||'']);
      }
    }
    if(rows.length===1) {toast('Chưa có dữ liệu để xuất Excel.');return;}
    const url=URL.createObjectURL(excelWorkbook(rows)), a=document.createElement('a');
    a.href=url;a.download='so-nuoc-tat-ca-thang.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Đã xuất Excel tất cả tháng đã ghi.');
  };
  $('export').onclick=()=>{
    checkExpiry(); const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=`so-nuoc-${new Date().toISOString().slice(0,10)}.json`; a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('import').onclick=()=>$('file').click();
  $('file').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try {
      if(file.size>5*1024*1024)throw Error('Tệp sao lưu quá lớn (tối đa 5 MB).');
      const data=JSON.parse(await file.text()); if(data.version!==1)throw Error('Không đúng định dạng sao lưu Sổ nước.');
      validateRecords(data.records); checkExpiry();
      if(!confirm('Nhập bản sao lưu sẽ thay thế toàn bộ chỉ số hiện tại . Tiếp tục?'))return;
      if(persist({...fresh(),records:data.records})) {render();toast('Đã khôi phục dữ liệu.');}
    } catch(err){toast(err instanceof SyntaxError?'Tệp JSON không hợp lệ.':err.message);} finally {e.target.value='';}
  };

  render();
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
