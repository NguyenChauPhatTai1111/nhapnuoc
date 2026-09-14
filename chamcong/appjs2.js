'use strict';
const $ = id => document.getElementById(id);
const timezone = 'Asia/Ho_Chi_Minh';
const timeFormat = new Intl.DateTimeFormat('vi-VN',{timeZone:timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const dateFormat = new Intl.DateTimeFormat('vi-VN',{timeZone:timezone,day:'2-digit',month:'2-digit',year:'numeric'});
const dateTimeFormat = new Intl.DateTimeFormat('vi-VN',{timeZone:timezone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
let account=null,csrf='',role='employee',shifts=[],employeeRows=[],serverEpoch=0,clockStart=0,online=false,canPunch=false,busy=false,editingCode='';
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hours = value => new Intl.NumberFormat('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/3600);
function elapsed(seconds){const n=Math.max(0,Math.floor(seconds));return `${Math.floor(n/3600)} giờ ${Math.floor(n%3600/60)} phút ${n%60} giây`;}
function notify(message,error=false){$('message').hidden=false;$('message').textContent=message;$('message').classList.toggle('error',error);window.clearTimeout(notify.timer);notify.timer=window.setTimeout(()=>$('message').hidden=true,7000);}
function now(){return serverEpoch+performance.now()-clockStart;}
function sync(value){serverEpoch=Date.parse(value);clockStart=performance.now();}
async function api(path,data){
  const headers={Accept:'application/json'};
  if(data!==undefined){headers['Content-Type']='application/json';if(csrf)headers['X-CSRF-Token']=csrf;}
  let response;
  try{response=await fetch(path,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});}
  catch{throw new Error('Không kết nối được máy chủ chấm công.');}
  const contentType=response.headers.get('content-type')||'';
  const body=contentType.includes('application/json')?await response.json():{};
  if(!response.ok){const error=new Error(body.error||'Không thực hiện được yêu cầu.');error.status=response.status;throw error;}
  return body;
}
function setNetwork(reachable,allowed=false){
  online=reachable;canPunch=allowed;
  $('network').classList.toggle('online',reachable&&allowed);$('network').classList.toggle('blocked',reachable&&!allowed);
  $('network').textContent=!reachable?'○ Không kết nối':allowed?'● Đúng mạng chấm công':'● Kết nối quản trị';
  $('network-detail').textContent=!reachable?'Máy chủ không phản hồi':allowed?'Thiết bị thuộc mạng được phép':'Thiết bị này không được phép chấm công';updateClock();
}
async function status(){try{const result=await api('/api/status');sync(result.now);setNetwork(true,result.canPunch);}catch{setNetwork(false,false);}}
function updateClock(){
  if(serverEpoch&&online){$('clock').textContent=timeFormat.format(now());$('today').textContent=dateFormat.format(now());}else $('clock').textContent='--:--:--';
  const open=shifts.find(shift=>!shift.checkout);
  if(account?.role==='employee'){
    $('checkin').disabled=busy||!online||!canPunch||Boolean(open);$('checkout').disabled=busy||!online||!canPunch||!open;
    $('shift-state').textContent=open?'Đang trong ca':'Chưa vào ca';$('shift-state').classList.toggle('active',Boolean(open));
    $('shift-title').textContent=open?(online?elapsed((now()-Date.parse(open.checkin))/1000):'Ca đang mở · mất kết nối'):'Sẵn sàng bắt đầu?';
    $('shift-detail').textContent=!canPunch?'Thiết bị chưa thuộc mạng chấm công.':open?`Vào ca lúc ${dateTimeFormat.format(new Date(open.checkin))}`:'Nhấn chấm công vào khi bắt đầu làm việc.';
  }
}
function renderHistory(){
  const closed=shifts.filter(shift=>shift.checkout),total=closed.reduce((sum,shift)=>sum+shift.seconds,0),admin=account?.role==='admin';
  $('closed-count').textContent=closed.length;$('total-hours').innerHTML=`${hours(total)} <small>giờ</small>`;$('total-exact').textContent=elapsed(total);$('open-count').textContent=shifts.filter(shift=>!shift.checkout).length;
  document.querySelectorAll('.admin-column').forEach(element=>element.hidden=!admin);
  $('history-rows').innerHTML=shifts.map(shift=>`<tr><td data-label="NHÂN VIÊN">${escape(shift.name)}<small>${escape(shift.employee)}</small></td><td data-label="GIỜ VÀO">${timeFormat.format(new Date(shift.checkin))}<small>${dateFormat.format(new Date(shift.checkin))}</small></td><td data-label="GIỜ RA">${shift.checkout?timeFormat.format(new Date(shift.checkout)):'—'}<small>${shift.checkout?dateFormat.format(new Date(shift.checkout)):'Chưa chấm công ra'}</small></td><td data-label="THỜI GIAN">${shift.checkout?hours(shift.seconds)+' giờ':'Đang tính'}<small>${shift.checkout?elapsed(shift.seconds):'Chưa cộng vào tổng'}</small></td><td data-label="TRẠNG THÁI"><span class="badge ${shift.checkout?'done':'active'}">${shift.checkout?'Đã kết thúc':'Đang làm'}</span></td><td data-label="IP THIẾT BỊ" class="admin-column" ${admin?'':'hidden'}>${escape(shift.checkinIp||'—')}<small>${shift.checkoutIp?'Ra: '+escape(shift.checkoutIp):''}</small></td></tr>`).join('');
  $('empty').hidden=shifts.length>0;updateClock();
}
async function refresh(){
  const month=$('history-month').value,employee=account?.role==='admin'?$('person-filter').value:'';
  try{const result=await api(`/api/shifts?month=${encodeURIComponent(month)}&employee=${encodeURIComponent(employee)}`);shifts=result.shifts;sync(result.now);setNetwork(true,canPunch);renderHistory();}
  catch(error){if(error.status===401){showLogin();notify('Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.',true);}else throw error;}
}
function renderEmployees(){
  const active=employeeRows.filter(employee=>employee.active).length;$('employee-count').textContent=`${active}/${employeeRows.length} đang hoạt động`;
  $('employee-list').innerHTML=employeeRows.map(employee=>`<article class="employee-item ${employee.active?'':'inactive'}"><div class="employee-identity"><strong>${escape(employee.name)}</strong><small><span class="status-dot">●</span> ${escape(employee.code)} · ${employee.active?'Được phép chấm công':'Đã khóa'}</small></div><div class="employee-tools"><button data-edit="${escape(employee.code)}">Sửa</button><button data-pin="${escape(employee.code)}">Đổi PIN</button></div></article>`).join('')||'<p class="empty">Chưa có nhân viên. Hãy tạo tài khoản đầu tiên.</p>';
  const selected=$('person-filter').value;$('person-filter').innerHTML='<option value="">Tất cả nhân viên</option>'+employeeRows.map(employee=>`<option value="${escape(employee.code)}">${escape(employee.name)} (${escape(employee.code)})</option>`).join('');$('person-filter').value=selected;
}
async function loadEmployees(){const result=await api('/api/employees');employeeRows=result.employees;renderEmployees();}
const auditLabels={login_success:'Đăng nhập thành công',login_failed:'Đăng nhập thất bại',logout:'Đăng xuất',employee_created:'Tạo nhân viên',employee_enabled:'Mở khóa nhân viên',employee_disabled:'Khóa nhân viên',pin_reset:'Đổi PIN',checkin:'Chấm công vào',checkout:'Chấm công ra'};
async function loadAudit(){
  const result=await api('/api/audit');
  $('audit-list').innerHTML=result.events.map(event=>`<article class="audit-item"><time>${dateTimeFormat.format(new Date(event.happenedAt))}</time><strong>${escape(auditLabels[event.action]||event.action)}${event.target?' · '+escape(event.target):''}</strong><small>${escape(event.actor_code||event.actor_role)} · ${escape(event.ip)}</small></article>`).join('')||'<p class="empty">Chưa có hoạt động.</p>';
}
function showLogin(){account=null;csrf='';shifts=[];$('workspace').hidden=true;$('login-panel').hidden=false;$('pin').value='';$('admin-key').value='';}
async function showAccount(value){
  account=value;csrf=value.csrf||'';const admin=value.role==='admin';$('login-panel').hidden=true;$('workspace').hidden=false;$('admin-panel').hidden=!admin;$('audit-panel').hidden=!admin;$('employee-actions').hidden=admin;$('person-filter-label').hidden=!admin;
  $('person-filter').value='';$('greeting').textContent=`Xin chào, ${value.name}`;$('role-label').textContent=admin?'QUẢN TRỊ CHẤM CÔNG':`NHÂN VIÊN · ${value.code}`;
  if(admin)await Promise.all([loadEmployees(),loadAudit()]);await refresh();
}
function chooseRole(value){
  role=value;const admin=role==='admin';$('employee-fields').hidden=admin;$('admin-fields').hidden=!admin;$('code').disabled=admin;$('pin').disabled=admin;$('admin-key').disabled=!admin;$('admin-key').required=admin;
  $('employee-tab').classList.toggle('selected',!admin);$('admin-tab').classList.toggle('selected',admin);$('employee-tab').setAttribute('aria-pressed',String(!admin));$('admin-tab').setAttribute('aria-pressed',String(admin));$('login-title').textContent=admin?'Đăng nhập quản trị':'Chấm công nhân viên';
}
$('employee-tab').onclick=()=>chooseRole('employee');$('admin-tab').onclick=()=>chooseRole('admin');
$('login-form').onsubmit=async event=>{event.preventDefault();const button=$('login-submit');button.disabled=true;try{const value=await api('/api/login',{role,code:$('code').value,pin:$('pin').value,key:$('admin-key').value});$('pin').value='';$('admin-key').value='';$('message').hidden=true;await showAccount(value);}catch(error){notify(error.message,true);}finally{button.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/api/logout',{});}catch{}showLogin();notify('Đã đăng xuất an toàn.');};
$('employee-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('/api/admin/employees',{code:$('new-code').value,name:$('new-name').value,pin:$('new-pin').value});event.target.reset();await Promise.all([loadEmployees(),loadAudit()]);notify('Đã tạo nhân viên. Hãy cấp mã và PIN bằng kênh riêng.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}};
$('employee-list').onclick=event=>{
  const edit=event.target.closest('button[data-edit]'),pin=event.target.closest('button[data-pin]');if(!edit&&!pin)return;editingCode=(edit||pin).dataset.edit||(edit||pin).dataset.pin;const employee=employeeRows.find(item=>item.code===editingCode);if(!employee)return;
  if(edit){$('employee-edit-title').textContent=employee.name;$('employee-edit-code').textContent=employee.code;$('employee-edit-name').value=employee.name;$('employee-edit-active').checked=employee.active;$('employee-editor').showModal();}
  else{$('pin-code').textContent=`${employee.name} · ${employee.code}`;$('reset-pin').value='';$('pin-editor').showModal();setTimeout(()=>$('reset-pin').focus(),0);}
};
$('employee-edit-close').onclick=$('employee-edit-cancel').onclick=()=>$('employee-editor').close();$('pin-close').onclick=$('pin-cancel').onclick=()=>$('pin-editor').close();
$('employee-edit-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('/api/admin/employees/update',{code:editingCode,name:$('employee-edit-name').value,active:$('employee-edit-active').checked});$('employee-editor').close();await Promise.all([loadEmployees(),loadAudit()]);notify('Đã lưu thay đổi nhân viên.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}};
$('pin-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('/api/admin/employees/pin',{code:editingCode,pin:$('reset-pin').value});$('pin-editor').close();await loadAudit();notify('Đã cập nhật PIN và đăng xuất các phiên cũ của nhân viên.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}};
async function punch(action){if(busy)return;busy=true;updateClock();try{await api(`/api/${action}`,{});notify(action==='checkin'?'Đã chấm công vào thành công. Chúc bạn làm việc hiệu quả!':'Đã chấm công ra và lưu trọn vẹn ca làm.');await refresh();}catch(error){notify(`${error.message} Hãy tải lại lịch sử trước khi thử lại.`,true);}finally{busy=false;updateClock();}}
$('checkin').onclick=()=>punch('checkin');$('checkout').onclick=()=>punch('checkout');$('refresh').onclick=()=>refresh().catch(error=>notify(error.message,true));$('history-month').onchange=()=>account&&refresh().catch(error=>notify(error.message,true));$('person-filter').onchange=()=>account?.role==='admin'&&refresh().catch(error=>notify(error.message,true));$('audit-refresh').onclick=()=>loadAudit().catch(error=>notify(error.message,true));
async function init(){
  const current=new Date(),year=new Intl.DateTimeFormat('en',{timeZone:timezone,year:'numeric'}).format(current),month=new Intl.DateTimeFormat('en',{timeZone:timezone,month:'2-digit'}).format(current);$('history-month').value=`${year}-${month}`;
  if(location.protocol==='file:'){notify('Không mở trực tiếp tệp HTML. Hãy chạy npm start và truy cập địa chỉ máy chủ.',true);$('login-submit').disabled=true;return;}
  await status();try{await showAccount(await api('/api/me'));}catch(error){if(error.status!==401&&online)notify(error.message,true);}
  setInterval(updateClock,1000);setInterval(async()=>{await status();if(account)try{await refresh();}catch{}},30000);
}
init();
