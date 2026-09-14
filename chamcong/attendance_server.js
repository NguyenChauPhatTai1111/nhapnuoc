'use strict';

const http = require('node:http');
const { readFileSync, chmodSync } = require('node:fs');
const { resolve, extname } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

const ROOT = __dirname;
const SESSION_COOKIE = 'attendance_session';
const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const REQUEST_WINDOW_MS = 60 * 1000;
const REQUEST_LIMIT = 180;
const PIN_ITERATIONS = 200_000;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// The fixed admin secret is stored only as a memory-hard scrypt verifier.
const ADMIN_SALT = 'c000186fa617c106bff31e71d0e0be28';
const ADMIN_HASH = 'ce6eb70c16d490f25a660180a3fecf0f65acb9f7f8964f4d77311694b60cd3d9';

const STATIC_FILES = new Map([
  ['/', 'index2.html'], ['/index2.html', 'index2.html'],
  ['/appjs2.js', 'appjs2.js'], ['/css2.css', 'css2.css'],
]);
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const isoStamp = (seconds = Date.now() / 1000) => new Date(seconds * 1000).toISOString();
const duration = (start, end) => Math.max(0, end - start);
function vietnamDay(seconds) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(seconds * 1000));
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function normalizeIp(address = '') {
  if (address.startsWith('::ffff:')) return address.slice(7);
  if (address === '::1') return '127.0.0.1';
  return address;
}
function ipv4Number(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}
function parseSubnet(value) {
  const [address, prefixText] = String(value).split('/'), ip = ipv4Number(address), prefix = Number(prefixText);
  if (ip === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error('Dải mạng phải có dạng IPv4/CIDR, ví dụ 192.168.1.0/24.');
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { value: `${address}/${prefix}`, network: (ip & mask) >>> 0, mask };
}
function isNetworkAllowed(address, subnet) {
  const number = ipv4Number(normalizeIp(address));
  return number !== null && ((number & subnet.mask) >>> 0) === subnet.network;
}
const isLoopback = address => normalizeIp(address) === '127.0.0.1';
function safeEqual(left, right) {
  const a = Buffer.from(String(left)), b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
function scryptHash(secret, salt) {
  return scryptSync(String(secret).normalize('NFKC'), Buffer.from(salt, 'hex'), 32, SCRYPT_OPTIONS).toString('hex');
}
function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}
function securityHeaders(res, secure = false) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function sendJson(res, status, data, secure = false, cookie) {
  const payload = Buffer.from(JSON.stringify(data));
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', payload.length);
  securityHeaders(res, secure); if (cookie) res.setHeader('Set-Cookie', cookie); res.end(payload);
}
function readJson(req) {
  return new Promise((resolveBody, reject) => {
    const contentType = String(req.headers['content-type'] || '').split(';')[0], declared = Number(req.headers['content-length']);
    if (contentType !== 'application/json' || !Number.isInteger(declared) || declared < 2 || declared > 8192) return reject(new Error('invalid body'));
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > 8192) req.destroy(); else chunks.push(chunk); });
    req.on('end', () => { try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); resolveBody(value); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}
function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) return null;
  const [year, number] = month.split('-').map(Number), nextYear = number === 12 ? year + 1 : year, nextNumber = number === 12 ? 1 : number + 1;
  return [Date.parse(`${month}-01T00:00:00+07:00`) / 1000, Date.parse(`${nextYear}-${String(nextNumber).padStart(2, '0')}-01T00:00:00+07:00`) / 1000];
}

function createAttendanceServer(options = {}) {
  process.umask(0o077);
  const databasePath = resolve(options.database || resolve(ROOT, 'attendance.sqlite3'));
  const subnet = parseSubnet(options.subnet || '192.168.1.0/24');
  const trustedProxy = options.trustedProxy ? parseSubnet(options.trustedProxy) : null;
  const secureCookie = options.secureCookie ?? process.env.NODE_ENV === 'production';
  const allowedOrigin = options.allowedOrigin || process.env.ATTENDANCE_ORIGIN || '';
  const testAdminKey = options.adminKey ? String(options.adminKey) : null;
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=10000; PRAGMA trusted_schema=OFF;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (code TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, pin_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY, employee TEXT NOT NULL REFERENCES employees(code), checkin REAL NOT NULL, checkout REAL, checkin_ip TEXT NOT NULL, checkout_ip TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift ON shifts(employee) WHERE checkout IS NULL;
    CREATE INDEX IF NOT EXISTS shifts_by_checkin ON shifts(checkin DESC);
    CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY, happened_at REAL NOT NULL, actor_role TEXT NOT NULL, actor_code TEXT, action TEXT NOT NULL, target TEXT, ip TEXT NOT NULL, details TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS audit_by_time ON audit_logs(happened_at DESC);
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(employees)').all().map(row => row.name));
  if (!columns.has('active')) db.exec('ALTER TABLE employees ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))');
  if (!columns.has('hash_algo')) db.exec("ALTER TABLE employees ADD COLUMN hash_algo TEXT NOT NULL DEFAULT 'pbkdf2-v1'");
  if (!columns.has('updated_at')) db.exec('ALTER TABLE employees ADD COLUMN updated_at REAL NOT NULL DEFAULT 0');
  try { chmodSync(databasePath, 0o600); } catch {}

  const sessions = new Map(), loginFailures = new Map(), requestRates = new Map();
  const statements = {
    employee: db.prepare('SELECT code,name,salt,pin_hash,hash_algo,active FROM employees WHERE code=?'),
    employees: db.prepare('SELECT code,name,active,updated_at FROM employees ORDER BY code'),
    addEmployee: db.prepare('INSERT INTO employees(code,name,salt,pin_hash,hash_algo,active,updated_at) VALUES (?,?,?,?,?,?,?)'),
    updateEmployee: db.prepare('UPDATE employees SET name=?,active=?,updated_at=? WHERE code=?'),
    updatePin: db.prepare('UPDATE employees SET salt=?,pin_hash=?,hash_algo=?,updated_at=? WHERE code=?'),
    openShift: db.prepare('SELECT id,checkin FROM shifts WHERE employee=? AND checkout IS NULL'),
    checkin: db.prepare('INSERT INTO shifts(employee,checkin,checkin_ip) VALUES (?,?,?)'),
    checkout: db.prepare('UPDATE shifts SET checkout=?,checkout_ip=? WHERE id=? AND checkout IS NULL'),
    audit: db.prepare('INSERT INTO audit_logs(happened_at,actor_role,actor_code,action,target,ip,details) VALUES (?,?,?,?,?,?,?)'),
    auditList: db.prepare('SELECT id,happened_at,actor_role,actor_code,action,target,ip,details FROM audit_logs ORDER BY happened_at DESC LIMIT 100'),
  };

  const audit = (role, code, action, target, ip, details = '') => statements.audit.run(Date.now() / 1000, role, code || null, action, target || null, ip, String(details).slice(0, 500));
  function clientIp(req) {
    const socketIp = normalizeIp(req.socket.remoteAddress), forwarded = req.headers['x-forwarded-for'];
    if (!forwarded) return socketIp;
    if (!trustedProxy || !isNetworkAllowed(socketIp, trustedProxy)) throw new Error('untrusted proxy');
    const first = String(forwarded).split(',')[0].trim();
    if (ipv4Number(first) === null) throw new Error('invalid forwarded ip');
    return first;
  }
  function consumeRate(map, key, limit, windowMs) {
    const current = Date.now(), values = (map.get(key) || []).filter(value => value > current - windowMs);
    if (values.length >= limit) { map.set(key, values); return false; }
    values.push(current); map.set(key, values);
    if (map.size > 5000) for (const [itemKey, itemValues] of map) if (!itemValues.some(value => value > current - windowMs)) map.delete(itemKey);
    return true;
  }
  function cookie(token, maxAge) { return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`; }
  function sessionFor(req, res, ip, { admin = false, csrf = false } = {}) {
    const token = parseCookies(req)[SESSION_COOKIE] || '', session = sessions.get(token), current = Date.now();
    if (!session || session.expires <= current || session.ip !== ip) {
      if (session) sessions.delete(token);
      sendJson(res, 401, { error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' }, secureCookie, cookie('', 0)); return null;
    }
    if (admin && session.role !== 'admin') { sendJson(res, 403, { error: 'Tài khoản không có quyền quản trị.' }, secureCookie); return null; }
    if (csrf && !safeEqual(req.headers['x-csrf-token'] || '', session.csrf)) { sendJson(res, 403, { error: 'Yêu cầu bảo mật không hợp lệ. Hãy tải lại trang.' }, secureCookie); return null; }
    return session;
  }
  function originAllowed(req) {
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    if (allowedOrigin) return origin === allowedOrigin;
    return origin === `${secureCookie ? 'https' : 'http'}://${req.headers.host || ''}`;
  }
  function verifyAdmin(key) {
    if (testAdminKey !== null) return safeEqual(key || '', testAdminKey);
    return safeEqual(scryptHash(String(key || '').slice(0, 256), ADMIN_SALT), ADMIN_HASH);
  }
  function verifyPin(row, pin) {
    const salt = row ? row.salt : '00000000000000000000000000000000';
    const digest = row?.hash_algo === 'scrypt-v1' ? scryptHash(pin.slice(0, 64), salt) : pbkdf2Sync(pin.slice(0, 64), Buffer.from(salt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex');
    return Boolean(row && /^\d{6,12}$/.test(pin) && safeEqual(digest, row.pin_hash));
  }
  function shiftRows(session, month, employeeFilter) {
    const bounds = monthBounds(month); if (!bounds) throw Error('invalid month');
    const params = [bounds[0], bounds[1]]; let where = 's.checkin>=? AND s.checkin<?';
    if (session.role === 'employee') { where += ' AND s.employee=?'; params.push(session.code); }
    else if (employeeFilter) { where += ' AND s.employee=?'; params.push(employeeFilter); }
    const rows = db.prepare(`SELECT s.*,e.name FROM shifts s JOIN employees e ON s.employee=e.code WHERE ${where} ORDER BY s.checkin DESC LIMIT 2000`).all(...params), current = Date.now() / 1000;
    return rows.map(row => ({ id: row.id, employee: row.employee, name: row.name, checkin: isoStamp(row.checkin), checkout: row.checkout === null ? null : isoStamp(row.checkout), seconds: duration(row.checkin, row.checkout === null ? current : row.checkout), day: vietnamDay(row.checkin), ...(session.role === 'admin' ? { checkinIp: row.checkin_ip, checkoutIp: row.checkout_ip } : {}) }));
  }

  async function handle(req, res) {
    let path, ip;
    try { path = new URL(req.url, 'http://local.invalid').pathname; ip = clientIp(req); }
    catch { return sendJson(res, 400, { error: 'Yêu cầu hoặc thông tin proxy không hợp lệ.' }, secureCookie); }
    if (!consumeRate(requestRates, ip, REQUEST_LIMIT, REQUEST_WINDOW_MS)) return sendJson(res, 429, { error: 'Thiết bị gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' }, secureCookie);
    const office = isNetworkAllowed(ip, subnet), local = isLoopback(ip);
    if (!office && !local) return sendJson(res, 403, { error: 'Thiết bị không thuộc mạng chấm công được phép.' }, secureCookie);
    if (!originAllowed(req)) return sendJson(res, 403, { error: 'Nguồn truy cập không hợp lệ.' }, secureCookie);

    if (req.method === 'GET') {
      if (path === '/api/status') return sendJson(res, 200, { now: isoStamp(), timezone: 'Asia/Ho_Chi_Minh', network: subnet.value, canPunch: office, secure: secureCookie }, secureCookie);
      if (path === '/api/me') {
        const session = sessionFor(req, res, ip); if (!session) return;
        return sendJson(res, 200, { role: session.role, code: session.code, name: session.name, csrf: session.csrf }, secureCookie);
      }
      if (path === '/api/employees') {
        const session = sessionFor(req, res, ip, { admin: true }); if (!session) return;
        return sendJson(res, 200, { employees: statements.employees.all().map(row => ({ ...row, active: Boolean(row.active) })) }, secureCookie);
      }
      if (path === '/api/shifts') {
        const session = sessionFor(req, res, ip); if (!session) return;
        const url = new URL(req.url, 'http://local.invalid'), month = url.searchParams.get('month'), employee = url.searchParams.get('employee') || '';
        if (!monthBounds(month) || employee.length > 24) return sendJson(res, 400, { error: 'Bộ lọc lịch sử không hợp lệ.' }, secureCookie);
        return sendJson(res, 200, { shifts: shiftRows(session, month, employee), now: isoStamp() }, secureCookie);
      }
      if (path === '/api/audit') {
        const session = sessionFor(req, res, ip, { admin: true }); if (!session) return;
        return sendJson(res, 200, { events: statements.auditList.all().map(row => ({ ...row, happenedAt: isoStamp(row.happened_at) })) }, secureCookie);
      }
      const filename = STATIC_FILES.get(path);
      if (!filename) return sendJson(res, 404, { error: 'Không tìm thấy.' }, secureCookie);
      const payload = readFileSync(resolve(ROOT, filename));
      res.statusCode = 200; res.setHeader('Content-Type', CONTENT_TYPES[extname(filename)]); res.setHeader('Content-Length', payload.length);
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
      securityHeaders(res, secureCookie); return res.end(payload);
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' }, secureCookie);
    let data; try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Dữ liệu gửi lên không hợp lệ.' }, secureCookie); }

    if (path === '/api/login') {
      const role = data.role, code = role === 'employee' ? String(data.code || '').trim().toUpperCase() : '', current = Date.now();
      if (!['admin', 'employee'].includes(role) || (role === 'employee' && !office)) return sendJson(res, 403, { error: role === 'employee' ? 'Nhân viên chỉ đăng nhập được từ mạng chấm công.' : 'Vai trò không hợp lệ.' }, secureCookie);
      const keys = [`ip:${ip}`, role === 'admin' ? 'admin' : `employee:${code.slice(0, 24)}`];
      if (keys.some(key => !consumeRate(loginFailures, key, LOGIN_LIMIT, LOGIN_WINDOW_MS))) return sendJson(res, 429, { error: 'Đăng nhập sai quá nhiều lần. Tài khoản/IP bị khóa 15 phút.' }, secureCookie);
      if (role === 'employee' && (!/^[A-Z0-9_-]{2,24}$/.test(code) || !/^\d{6,12}$/.test(String(data.pin || '')))) {
        audit('anonymous', '', 'login_failed', 'employee', ip);
        return sendJson(res, 401, { error: 'Thông tin đăng nhập không đúng hoặc tài khoản đã bị khóa.' }, secureCookie);
      }
      if (role === 'admin' && (typeof data.key !== 'string' || data.key.length < 20 || data.key.length > 256)) {
        audit('anonymous', '', 'login_failed', 'admin', ip);
        return sendJson(res, 401, { error: 'Thông tin đăng nhập không đúng hoặc tài khoản đã bị khóa.' }, secureCookie);
      }
      let valid = false, account, row;
      if (role === 'admin') { valid = verifyAdmin(data.key); account = { role: 'admin', name: 'Quản trị hệ thống' }; }
      else { row = statements.employee.get(code); valid = verifyPin(row, String(data.pin || '')) && Boolean(row.active); account = { role: 'employee', code, name: row?.name || '' }; }
      if (!valid) { audit('anonymous', code, 'login_failed', role, ip); return sendJson(res, 401, { error: 'Thông tin đăng nhập không đúng hoặc tài khoản đã bị khóa.' }, secureCookie); }
      keys.forEach(key => loginFailures.delete(key));
      if (row && row.hash_algo !== 'scrypt-v1') { const salt = randomBytes(16).toString('hex'); statements.updatePin.run(salt, scryptHash(String(data.pin), salt), 'scrypt-v1', Date.now() / 1000, code); }
      for (const [token, value] of sessions) if (value.expires <= current) sessions.delete(token);
      const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url');
      sessions.set(token, { ...account, csrf, ip, expires: current + SESSION_SECONDS * 1000 });
      audit(role, code, 'login_success', null, ip);
      return sendJson(res, 200, { ...account, csrf }, secureCookie, cookie(token, SESSION_SECONDS));
    }
    if (path === '/api/logout') {
      const token = parseCookies(req)[SESSION_COOKIE] || '', session = sessionFor(req, res, ip, { csrf: true }); if (!session) return;
      audit(session.role, session.code, 'logout', null, ip); sessions.delete(token);
      return sendJson(res, 200, { ok: true }, secureCookie, cookie('', 0));
    }
    const session = sessionFor(req, res, ip, { admin: path.startsWith('/api/admin/'), csrf: true }); if (!session) return;

    if (path === '/api/admin/employees') {
      const code = String(data.code || '').trim().toUpperCase(), name = String(data.name || '').trim(), pin = String(data.pin || '');
      if (!/^[A-Z0-9_-]{2,24}$/.test(code) || name.length < 2 || name.length > 100 || !/^\d{8,12}$/.test(pin)) return sendJson(res, 400, { error: 'Mã gồm 2–24 ký tự A–Z, số, _ hoặc -. Tên 2–100 ký tự. PIN phải có 8–12 chữ số.' }, secureCookie);
      const salt = randomBytes(16).toString('hex');
      try { statements.addEmployee.run(code, name, salt, scryptHash(pin, salt), 'scrypt-v1', 1, Date.now() / 1000); }
      catch (error) { if (String(error.code).includes('CONSTRAINT')) return sendJson(res, 409, { error: 'Mã nhân viên đã tồn tại.' }, secureCookie); throw error; }
      audit('admin', null, 'employee_created', code, ip, name); return sendJson(res, 201, { ok: true }, secureCookie);
    }
    if (path === '/api/admin/employees/update') {
      const code = String(data.code || '').trim().toUpperCase(), name = String(data.name || '').trim(), active = data.active, row = statements.employee.get(code);
      if (!row || name.length < 2 || name.length > 100 || typeof active !== 'boolean') return sendJson(res, 400, { error: 'Thông tin nhân viên không hợp lệ.' }, secureCookie);
      statements.updateEmployee.run(name, active ? 1 : 0, Date.now() / 1000, code);
      if (!active) for (const [token, value] of sessions) if (value.code === code) sessions.delete(token);
      audit('admin', null, active ? 'employee_enabled' : 'employee_disabled', code, ip, name); return sendJson(res, 200, { ok: true }, secureCookie);
    }
    if (path === '/api/admin/employees/pin') {
      const code = String(data.code || '').trim().toUpperCase(), pin = String(data.pin || ''), row = statements.employee.get(code);
      if (!row || !/^\d{8,12}$/.test(pin)) return sendJson(res, 400, { error: 'Nhân viên không tồn tại hoặc PIN không đủ 8–12 chữ số.' }, secureCookie);
      const salt = randomBytes(16).toString('hex'); statements.updatePin.run(salt, scryptHash(pin, salt), 'scrypt-v1', Date.now() / 1000, code);
      for (const [token, value] of sessions) if (value.code === code) sessions.delete(token);
      audit('admin', null, 'pin_reset', code, ip); return sendJson(res, 200, { ok: true }, secureCookie);
    }
    if (path === '/api/checkin' || path === '/api/checkout') {
      if (session.role !== 'employee' || !office) return sendJson(res, 403, { error: 'Chấm công chỉ được thực hiện bởi nhân viên trong mạng cho phép.' }, secureCookie);
      let result; db.exec('BEGIN IMMEDIATE');
      try {
        const open = statements.openShift.get(session.code), current = Date.now() / 1000;
        if (path === '/api/checkin') {
          if (open) result = { status: 409, data: { error: 'Bạn đang có một ca chưa check-out.' } };
          else { statements.checkin.run(session.code, current, ip); audit('employee', session.code, 'checkin', null, ip); result = { status: 200, data: { ok: true, now: isoStamp(current) } }; }
        } else if (!open) result = { status: 409, data: { error: 'Bạn chưa check-in.' } };
        else if (current < open.checkin) result = { status: 409, data: { error: 'Đồng hồ máy chủ bị lùi. Báo quản trị kiểm tra.' } };
        else { statements.checkout.run(current, ip, open.id); audit('employee', session.code, 'checkout', String(open.id), ip); result = { status: 200, data: { ok: true, now: isoStamp(current) } }; }
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
      return sendJson(res, result.status, result.data, secureCookie);
    }
    return sendJson(res, 404, { error: 'Không tìm thấy.' }, secureCookie);
  }

  const server = http.createServer((req, res) => handle(req, res).catch(error => { console.error('Lỗi máy chủ:', error.message); if (!res.headersSent) sendJson(res, 500, { error: 'Máy chủ gặp lỗi. Dữ liệu chưa bị thay đổi.' }, secureCookie); else res.destroy(); }));
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 64;
  server.adminKey = testAdminKey; server.database = db; server.subnet = subnet; server.closeDatabase = () => db.close();
  return server;
}

function parseArguments(argv) {
  const options = { host: '0.0.0.0', port: 8002, subnet: process.env.ATTENDANCE_SUBNET || '192.168.1.0/24', database: resolve(ROOT, 'attendance.sqlite3'), secureCookie: process.env.NODE_ENV === 'production' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index], value = argv[index + 1];
    if (!['--host', '--port', '--subnet', '--database', '--trusted-proxy', '--origin'].includes(key) || value === undefined) throw new Error(`Tham số không hợp lệ: ${key}`);
    const name = key === '--origin' ? 'allowedOrigin' : key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[name] = key === '--port' ? Number(value) : value; index += 1;
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Cổng phải từ 1 đến 65535.');
  return options;
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2)), server = createAttendanceServer(options);
    server.on('error', error => { console.error(`Không mở được máy chủ: ${error.message}`); server.closeDatabase(); process.exitCode = 1; });
    server.listen(options.port, options.host, () => {
      console.log(`Chấm công: http://localhost:${options.port}/index2.html`);
      console.log(`Mạng nhân viên được phép: ${server.subnet.value} | UTC+7`);
      console.log('Mã quản trị là mã cố định đã được cấp riêng; máy chủ không in mã ra Terminal.');
      if (options.secureCookie) console.log('Chế độ production: cookie Secure đang bật.');
    });
    const stop = () => server.close(() => { server.closeDatabase(); process.exit(0); });
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { createAttendanceServer, duration, vietnamDay, parseSubnet, isNetworkAllowed, monthBounds };
