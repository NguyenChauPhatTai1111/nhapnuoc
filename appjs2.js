'use strict';
const $ = id => document.getElementById(id);
const timezone = 'Asia/Ho_Chi_Minh';
const timeFormat = new Intl.DateTimeFormat('vi-VN',{timeZone:timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const dateFormat = new Intl.DateTimeFormat('vi-VN',{timeZone:timezone,day:'2-digit',month:'2-digit',year:'numeric'});
let account=null, role='employee', shifts=[], serverEpoch=0, clockStart=0, online=false, busy=false;
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hours = value => new Intl.NumberFormat('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/3600);
function elapsed(seconds) {const n=Math.max(0,Math.floor(seconds));return `${Math.floor(n/3600)} giờ ${Math.floor(n%3600/60)} phút ${n%60} giây`;}
function notify(message,error=false) {$('message').hidden=false;$('message').textContent=message;$('message').classList.toggle('error',error);}
function now() {return serverEpoch + performance.now()-clockStart;}
function sync(value) {serverEpoch=Date.parse(value);clockStart=performance.now();}
async function api(path,data) {
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(10000)});
  const body=await response.json();
  if(!response.ok) {const error=new Error(body.error || 'Không thực hiện được yêu cầu.');error.status=response.status;throw error;}
  return body;
}
function setNetwork(value) {online=value;$('network').classList.toggle('online',value);$('network').textContent=value?'● Đã kết nối mạng chấm công':'○ Mất kết nối máy chủ';updateClock();}
async function status() {try{const result=await api('/api/status');sync(result.now);setNetwork(true);}catch{setNetwork(false);}}
function updateClock() {
  if(serverEpoch && online){$('clock').textContent=timeFormat.format(now());$('today').textContent=dateFormat.format(now());}
  else {$('clock').textContent='--:--:--';}
  const open=shifts.find(s=>!s.checkout);
  if(account?.role==='employee') {
    $('checkin').disabled=busy||!online||!!open;
    $('checkout').disabled=busy||!online||!open;
    $('shift-state').textContent=open?'Đang trong ca':'Chưa vào ca';
    $('shift-state').classList.toggle('active',!!open);
    $('shift-title').textContent=open?(online?elapsed((now()-Date.parse(open.checkin))/1000):'Đang làm · mất kết nối'):'Sẵn sàng bắt đầu?';
    $('shift-detail').textContent=open?`Check-in lúc ${timeFormat.format(new Date(open.checkin))}, ${dateFormat.format(new Date(open.checkin))}`:'Nhấn Check-in khi bắt đầu làm việc.';
  }
}
function renderHistory() {
  const month=$('history-month').value, employee=$('person-filter').value;
  const visible=shifts.filter(s=>s.day.startsWith(month)&&(!employee||s.employee===employee));
  const closed=visible.filter(s=>s.checkout), total=closed.reduce((sum,s)=>sum+s.seconds,0);
  $('closed-count').textContent=closed.length;$('total-hours').innerHTML=`${hours(total)} <small>giờ</small>`;$('total-exact').textContent=elapsed(total);
  $('open-count').textContent=visible.filter(s=>!s.checkout).length;
  $('history-rows').innerHTML=visible.map(s=>`<tr><td>${escape(s.name)}<small>${escape(s.employee)}</small></td><td>${timeFormat.format(new Date(s.checkin))}<small>${dateFormat.format(new Date(s.checkin))}</small></td><td>${s.checkout?timeFormat.format(new Date(s.checkout)):'—'}<small>${s.checkout?dateFormat.format(new Date(s.checkout)):'Chưa check-out'}</small></td><td>${s.checkout?hours(s.seconds)+' giờ':'Đang tính'}<small>${s.checkout?elapsed(s.seconds):'Chưa cộng tổng giờ'}</small></td><td><span class="badge ${s.checkout?'done':'active'}">${s.checkout?'Đã kết thúc':'Đang làm'}</span></td></tr>`).join('');
  $('empty').hidden=visible.length>0;updateClock();
}
async function refresh() {
  try {
    const result=await api('/api/shifts');shifts=result.shifts;sync(result.now);setNetwork(true);renderHistory();
  } catch(error) {
    if(error.status===401){showLogin();notify('Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.',true);}
    else {setNetwork(false);throw error;}
  }
}
async function employees() {
  const result=await api('/api/employees');
  $('employee-count').textContent=`${result.employees.length} nhân viên`;
  $('employee-list').textContent=result.employees.map(e=>`${e.code} · ${e.name}`).join(' / ')||'Chưa có nhân viên. Thêm nhân viên đầu tiên ở trên.';
  const previous=$('person-filter').value;
  $('person-filter').innerHTML='<option value="">Tất cả nhân viên</option>'+result.employees.map(e=>`<option value="${escape(e.code)}">${escape(e.name)} (${escape(e.code)})</option>`).join('');
  $('person-filter').value=previous;
}
function showLogin() {account=null;shifts=[];$('workspace').hidden=true;$('login-panel').hidden=false;$('pin').value='';$('admin-key').value='';}
async function showAccount(value) {
  account=value;const admin=value.role==='admin';
  $('login-panel').hidden=true;$('workspace').hidden=false;$('admin-panel').hidden=!admin;$('employee-actions').hidden=admin;$('person-filter-label').hidden=!admin;
  $('person-filter').value='';$('greeting').textContent=`Xin chào, ${value.name}`;$('role-label').textContent=admin?'QUẢN LÝ CHẤM CÔNG':`NHÂN VIÊN · ${value.code}`;
  if(admin)await employees();await refresh();
}
function chooseRole(value) {
  role=value;const admin=role==='admin';
  $('employee-fields').hidden=admin;$('admin-fields').hidden=!admin;
  $('code').disabled=admin;$('pin').disabled=admin;$('admin-key').disabled=!admin;$('admin-key').required=admin;
  $('employee-tab').classList.toggle('selected',!admin);$('admin-tab').classList.toggle('selected',admin);
  $('employee-tab').setAttribute('aria-pressed',String(!admin));$('admin-tab').setAttribute('aria-pressed',String(admin));
  $('login-title').textContent=admin?'Đăng nhập quản lý':'Đăng nhập chấm công';
}
$('employee-tab').onclick=()=>chooseRole('employee');$('admin-tab').onclick=()=>chooseRole('admin');
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-submit').disabled=true;try{const value=await api('/api/login',{role,code:$('code').value,pin:$('pin').value,key:$('admin-key').value});$('pin').value='';$('admin-key').value='';$('message').hidden=true;await showAccount(value);}catch(error){notify(error.message,true);}finally{$('login-submit').disabled=false;}};
$('logout').onclick=async()=>{try{await api('/api/logout',{});showLogin();$('message').hidden=true;}catch(error){notify(error.message,true);}};
$('employee-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('/api/employees',{code:$('new-code').value,name:$('new-name').value,pin:$('new-pin').value});e.target.reset();await employees();notify('Đã thêm nhân viên. Cấp mã và PIN riêng cho nhân viên đó.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}};
async function punch(action) {
  if(busy)return;busy=true;updateClock();
  try{await api(`/api/${action}`,{});notify(action==='checkin'?'Đã check-in. Chúc bạn một ca làm thuận lợi!':'Đã check-out và lưu thời gian làm việc.');await refresh();}
  catch(error){notify(error.message+' Nếu kết nối bị ngắt, hãy tải lại lịch sử để kiểm tra trước khi thử lại.',true);try{await refresh();}catch{}}
  finally{busy=false;updateClock();}
}
$('checkin').onclick=()=>punch('checkin');$('checkout').onclick=()=>punch('checkout');
$('refresh').onclick=()=>refresh().catch(e=>notify(e.message,true));
$('history-month').oninput=renderHistory;$('person-filter').onchange=renderHistory;
async function init() {
  if(location.protocol==='file:'){notify('Hãy chạy npm start rồi mở http://localhost:8002/index2.html. Chấm công cần máy chủ; không mở trực tiếp file HTML.',true);$('login-submit').disabled=true;return;}
  await status();
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit'}).formatToParts(serverEpoch?now():Date.now());
  $('history-month').value=`${date.find(p=>p.type==='year').value}-${date.find(p=>p.type==='month').value}`;
  if(!online)notify('Không kết nối được máy chủ. Chạy npm start và truy cập đúng địa chỉ chấm công.',true);
  try{await showAccount(await api('/api/me'));}catch(error){if(error.status!==401&&online)notify(error.message,true);}
  setInterval(updateClock,1000);
  setInterval(async()=>{await status();if(account)try{await refresh();}catch{}},15000);
}
init();
