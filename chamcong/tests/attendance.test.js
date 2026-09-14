'use strict';
const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {mkdtempSync,rmSync}=require('node:fs');
const {pbkdf2Sync}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {createAttendanceServer,duration,vietnamDay,parseSubnet,isNetworkAllowed,monthBounds}=require('../attendance_server');

let directory,server,base;
const ADMIN_TEST_KEY='test-admin-key-with-at-least-32-characters';
const OFFICE_IP='192.168.1.55';
function request(path,data,session={},options={}){
  return new Promise((resolve,reject)=>{
    const body=data===undefined?null:JSON.stringify(data),headers={Origin:options.origin??base,'Sec-Fetch-Site':options.site??'same-origin','X-Forwarded-For':options.ip??OFFICE_IP};
    if(body){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(body);}
    if(session.cookie)headers.Cookie=session.cookie;if(session.csrf)headers['X-CSRF-Token']=session.csrf;
    const req=http.request(`${base}${path}`,{method:body?'POST':'GET',headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const payload=Buffer.concat(chunks),type=response.headers['content-type']||'';resolve({status:response.statusCode,body:type.includes('application/json')?JSON.parse(payload):payload,cookie:response.headers['set-cookie']?.[0]?.split(';')[0],setCookie:response.headers['set-cookie']?.[0],headers:response.headers});});});
    req.on('error',reject);if(body)req.write(body);req.end();
  });
}
async function adminLogin(){const response=await request('/api/login',{role:'admin',key:ADMIN_TEST_KEY});assert.equal(response.status,200);return{cookie:response.cookie,csrf:response.body.csrf};}
async function createEmployee(code='NV001',pin='12345678'){
  const admin=await adminLogin();assert.equal((await request('/api/admin/employees',{code,name:'Nguyễn An',pin},admin)).status,201);
  const login=await request('/api/login',{role:'employee',code,pin});assert.equal(login.status,200);return{admin,employee:{cookie:login.cookie,csrf:login.body.csrf}};
}
beforeEach(async()=>{directory=mkdtempSync(join(tmpdir(),'attendance-secure-'));server=createAttendanceServer({database:join(directory,'test.sqlite3'),subnet:'192.168.1.0/24',trustedProxy:'127.0.0.1/32',adminKey:ADMIN_TEST_KEY,secureCookie:false});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;});
afterEach(async()=>{await new Promise(resolve=>server.close(resolve));server.closeDatabase();rmSync(directory,{recursive:true,force:true});});

test('cookie, CSRF, phân quyền và cô lập lịch sử',async()=>{
  const {admin,employee}=await createEmployee();
  const login=await request('/api/login',{role:'admin',key:ADMIN_TEST_KEY});assert.match(login.setCookie,/HttpOnly/);assert.match(login.setCookie,/SameSite=Strict/);
  assert.equal((await request('/api/checkin',{},employee)).status,200);
  assert.equal((await request('/api/checkin',{}, {cookie:employee.cookie})).status,403);
  assert.equal((await request('/api/admin/employees',{code:'NV002',name:'Bình',pin:'87654321'},employee)).status,403);
  const month=new Date().toISOString().slice(0,7);assert.equal((await request(`/api/shifts?month=${month}`,undefined,employee)).body.shifts.length,1);
  assert.equal((await request(`/api/shifts?month=${month}`,undefined,admin)).body.shifts.length,1);
});

test('logic check-in/check-out nguyên tử và dùng giờ máy chủ',async()=>{
  const {employee}=await createEmployee();
  assert.equal((await request('/api/checkout',{},employee)).status,409);assert.equal((await request('/api/checkin',{now:'1900'},employee)).status,200);assert.equal((await request('/api/checkin',{},employee)).status,409);assert.equal((await request('/api/checkout',{},employee)).status,200);assert.equal((await request('/api/checkout',{},employee)).status,409);
  const stored=server.database.prepare('SELECT pin_hash,hash_algo,checkout FROM employees JOIN shifts ON employee=code').get();assert.notEqual(stored.pin_hash,'12345678');assert.equal(stored.hash_algo,'scrypt-v1');assert.notEqual(stored.checkout,null);
});

test('chặn sai mạng, loopback nhân viên và header proxy giả',async()=>{
  const admin=await adminLogin();await request('/api/admin/employees',{code:'NV001',name:'An',pin:'12345678'},admin);
  assert.equal((await request('/api/login',{role:'employee',code:'NV001',pin:'12345678'},{},{ip:'10.0.0.8'})).status,403);
  assert.equal(isNetworkAllowed('127.0.0.1',parseSubnet('192.168.1.0/24')),false);
  const other=createAttendanceServer({database:join(directory,'other.sqlite3'),subnet:'192.168.1.0/24',adminKey:ADMIN_TEST_KEY});await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  const oldBase=base;base=`http://127.0.0.1:${other.address().port}`;assert.equal((await request('/api/status')).status,400);base=oldBase;await new Promise(resolve=>other.close(resolve));other.closeDatabase();
});

test('khóa brute force sau 5 lần và khóa tài khoản hủy phiên',async()=>{
  for(let i=0;i<5;i++)assert.equal((await request('/api/login',{role:'admin',key:'wrong'})).status,401);
  assert.equal((await request('/api/login',{role:'admin',key:ADMIN_TEST_KEY})).status,429);
});

test('quản trị sửa, khóa, đổi PIN và có audit log',async()=>{
  const {admin,employee}=await createEmployee();
  assert.equal((await request('/api/admin/employees/update',{code:'NV001',name:'Nguyễn Bình',active:false},admin)).status,200);
  assert.equal((await request('/api/me',undefined,employee)).status,401);
  assert.equal((await request('/api/admin/employees/pin',{code:'NV001',pin:'99999999'},admin)).status,200);
  assert.ok((await request('/api/audit',undefined,admin)).body.events.length>=3);
});

test('header bảo mật, lọc tháng và hàm thời gian UTC+7',async()=>{
  const page=await request('/index2.html');assert.equal(page.status,200);assert.equal(page.headers['x-frame-options'],'DENY');assert.equal(page.headers['cross-origin-opener-policy'],'same-origin');assert.match(page.headers['content-security-policy'],/object-src 'none'/);
  assert.equal(monthBounds('bad'),null);assert.equal(monthBounds('2026-12').length,2);
  const start=Date.parse('2026-09-30T16:30:00Z')/1000,end=Date.parse('2026-09-30T18:15:00Z')/1000;assert.equal(vietnamDay(start),'2026-09-30');assert.equal(vietnamDay(end),'2026-10-01');assert.equal(duration(start,end),6300);
});

test('nâng cấp cơ sở dữ liệu cũ mà không mất nhân viên hoặc lịch sử',async()=>{
  const legacyPath=join(directory,'legacy.sqlite3'),legacy=new DatabaseSync(legacyPath);
  legacy.exec('CREATE TABLE employees(code TEXT PRIMARY KEY,name TEXT NOT NULL,salt TEXT NOT NULL,pin_hash TEXT NOT NULL); CREATE TABLE shifts(id INTEGER PRIMARY KEY,employee TEXT NOT NULL REFERENCES employees(code),checkin REAL NOT NULL,checkout REAL,checkin_ip TEXT NOT NULL,checkout_ip TEXT)');
  const salt='00112233445566778899aabbccddeeff',hash=pbkdf2Sync('123456',Buffer.from(salt,'hex'),200000,32,'sha256').toString('hex');
  legacy.prepare('INSERT INTO employees VALUES(?,?,?,?)').run('CU001','Dữ liệu cũ',salt,hash);
  legacy.prepare('INSERT INTO shifts(employee,checkin,checkout,checkin_ip,checkout_ip) VALUES(?,?,?,?,?)').run('CU001',1700000000,1700003600,'192.168.1.9','192.168.1.9');
  legacy.close();
  const migrated=createAttendanceServer({database:legacyPath,subnet:'192.168.1.0/24',trustedProxy:'127.0.0.1/32',adminKey:ADMIN_TEST_KEY});
  await new Promise(resolve=>migrated.listen(0,'127.0.0.1',resolve));
  const oldBase=base;base=`http://127.0.0.1:${migrated.address().port}`;
  const login=await request('/api/login',{role:'employee',code:'CU001',pin:'123456'});
  assert.equal(login.status,200);assert.equal(migrated.database.prepare('SELECT count(*) AS total FROM shifts').get().total,1);
  assert.equal(migrated.database.prepare('SELECT hash_algo FROM employees WHERE code=?').get('CU001').hash_algo,'scrypt-v1');
  base=oldBase;await new Promise(resolve=>migrated.close(resolve));migrated.closeDatabase();
});
