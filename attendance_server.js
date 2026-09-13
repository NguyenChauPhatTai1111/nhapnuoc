'use strict';

const http = require('node:http');
const { readFileSync, chmodSync } = require('node:fs');
const { resolve, extname } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pbkdf2Sync, randomBytes, timingSafeEqual } = require('node:crypto');

const ROOT = __dirname;
const SESSION_COOKIE = 'attendance_session';
const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_LIMIT = 10;
const PIN_ITERATIONS = 200_000;
const STATIC_FILES = new Map([
  ['/', 'index2.html'],
  ['/index2.html', 'index2.html'],
  ['/appjs2.js', 'appjs2.js'],
  ['/css2.css', 'css2.css'],
]);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function isoStamp(seconds = Date.now() / 1000) {
  return new Date(seconds * 1000).toISOString();
}

function duration(start, end) {
  return Math.max(0, end - start);
}

function vietnamDay(seconds) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(seconds * 1000));
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function normalizeIp(address = '') {
  if (address.startsWith('::ffff:')) return address.slice(7);
  if (address === '::1') return '127.0.0.1';
  return address;
}

function ipv4Number(address) {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function parseSubnet(value) {
  const [address, prefixText] = String(value).split('/');
  const ip = ipv4Number(address);
  const prefix = Number(prefixText);
  if (ip === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('Dải mạng phải có dạng IPv4/CIDR, ví dụ 192.168.1.0/24.');
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { value: `${address}/${prefix}`, network: (ip & mask) >>> 0, mask };
}

function isNetworkAllowed(address, subnet) {
  const ip = normalizeIp(address);
  if (ip === '127.0.0.1') return true;
  const number = ipv4Number(ip);
  return number !== null && ((number & subnet.mask) >>> 0) === subnet.network;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
}

function sendJson(res, status, data, cookie) {
  const payload = Buffer.from(JSON.stringify(data));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', payload.length);
  securityHeaders(res);
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    const contentType = String(req.headers['content-type'] || '').split(';')[0];
    const declared = Number(req.headers['content-length']);
    if (contentType !== 'application/json' || !Number.isInteger(declared) || declared < 1 || declared > 8192) {
      reject(new Error('invalid body'));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 8192) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid body');
        resolveBody(value);
      } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function createAttendanceServer(options = {}) {
  process.umask(0o077);
  const databasePath = resolve(options.database || resolve(ROOT, 'attendance.sqlite3'));
  const subnet = parseSubnet(options.subnet || '192.168.1.0/24');
  const configuredAdminKey = options.adminKey || process.env.ATTENDANCE_ADMIN_KEY;
  if (configuredAdminKey && String(configuredAdminKey).length < 24) {
    throw new Error('ATTENDANCE_ADMIN_KEY phải có ít nhất 24 ký tự.');
  }
  const adminKey = String(configuredAdminKey || randomBytes(24).toString('base64url'));
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=10000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, pin_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY, employee TEXT NOT NULL REFERENCES employees(code),
      checkin REAL NOT NULL, checkout REAL, checkin_ip TEXT NOT NULL, checkout_ip TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift ON shifts(employee) WHERE checkout IS NULL;
  `);
  try { chmodSync(databasePath, 0o600); } catch {}

  const sessions = new Map();
  const failures = new Map();
  const statements = {
    employee: db.prepare('SELECT code,name,salt,pin_hash FROM employees WHERE code=?'),
    employees: db.prepare('SELECT code,name FROM employees ORDER BY code'),
    addEmployee: db.prepare('INSERT INTO employees(code,name,salt,pin_hash) VALUES (?,?,?,?)'),
    shiftsAll: db.prepare(`SELECT s.*,e.name FROM shifts s JOIN employees e ON s.employee=e.code ORDER BY checkin DESC`),
    shiftsEmployee: db.prepare(`SELECT s.*,e.name FROM shifts s JOIN employees e ON s.employee=e.code WHERE employee=? ORDER BY checkin DESC`),
    openShift: db.prepare('SELECT id,checkin FROM shifts WHERE employee=? AND checkout IS NULL'),
    checkin: db.prepare('INSERT INTO shifts(employee,checkin,checkin_ip) VALUES (?,?,?)'),
    checkout: db.prepare('UPDATE shifts SET checkout=?,checkout_ip=? WHERE id=? AND checkout IS NULL'),
  };

  function sessionFor(req, res, adminOnly = false) {
    const token = parseCookies(req)[SESSION_COOKIE] || '';
    const session = sessions.get(token);
    if (!session || session.expires <= Date.now() || (adminOnly && session.role !== 'admin')) {
      if (session) sessions.delete(token);
      sendJson(res, 401, { error: 'Vui lòng đăng nhập bằng tài khoản phù hợp.' });
      return null;
    }
    return session;
  }

  function shiftRows(employee) {
    const rows = employee ? statements.shiftsEmployee.all(employee) : statements.shiftsAll.all();
    const current = Date.now() / 1000;
    return rows.map(row => ({
      id: row.id,
      employee: row.employee,
      name: row.name,
      checkin: isoStamp(row.checkin),
      checkout: row.checkout === null ? null : isoStamp(row.checkout),
      seconds: duration(row.checkin, row.checkout === null ? current : row.checkout),
      day: vietnamDay(row.checkin),
    }));
  }

  function requestAllowed(req, res) {
    const ip = normalizeIp(req.socket.remoteAddress);
    if (!isNetworkAllowed(ip, subnet)) {
      sendJson(res, 403, { error: 'Cần kết nối cùng mạng nội bộ của nơi chấm công.' });
      return false;
    }
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host || ''}` && origin !== `https://${req.headers.host || ''}`) {
      sendJson(res, 403, { error: 'Nguồn truy cập không hợp lệ.' });
      return false;
    }
    return true;
  }

  async function handle(req, res) {
    if (!requestAllowed(req, res)) return;
    let path;
    try { path = new URL(req.url, 'http://local.invalid').pathname; }
    catch { return sendJson(res, 400, { error: 'Yêu cầu không hợp lệ.' }); }

    if (req.method === 'GET') {
      if (path === '/api/status') {
        return sendJson(res, 200, { now: isoStamp(), timezone: 'Asia/Ho_Chi_Minh', network: subnet.value });
      }
      if (path === '/api/me' || path === '/api/shifts' || path === '/api/employees') {
        const session = sessionFor(req, res, path === '/api/employees');
        if (!session) return;
        if (path === '/api/me') {
          const { expires, ...account } = session;
          return sendJson(res, 200, account);
        }
        if (path === '/api/employees') return sendJson(res, 200, { employees: statements.employees.all() });
        return sendJson(res, 200, {
          shifts: shiftRows(session.role === 'admin' ? null : session.code), now: isoStamp(),
        });
      }
      const filename = STATIC_FILES.get(path);
      if (!filename) return sendJson(res, 404, { error: 'Không tìm thấy.' });
      const payload = readFileSync(resolve(ROOT, filename));
      res.statusCode = 200;
      res.setHeader('Content-Type', CONTENT_TYPES[extname(filename)]);
      res.setHeader('Content-Length', payload.length);
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      securityHeaders(res);
      return res.end(payload);
    }

    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
    let data;
    try { data = await readJson(req); }
    catch { return sendJson(res, 400, { error: 'Dữ liệu gửi lên không hợp lệ.' }); }

    const ip = normalizeIp(req.socket.remoteAddress);
    if (path === '/api/login') {
      const current = Date.now();
      const role = data.role;
      const code = role === 'admin' ? '' : String(data.code || '').trim().toUpperCase();
      const failureKeys = [`ip:${ip}`, role === 'admin' ? 'account:admin' : `employee:${code}`];
      const recentByKey = failureKeys.map(key => (failures.get(key) || []).filter(value => value > current - LOGIN_WINDOW_MS));
      if (recentByKey.some(recent => recent.length >= LOGIN_LIMIT)) {
        return sendJson(res, 429, { error: 'Thử sai quá nhiều lần. Vui lòng đợi 5 phút.' });
      }
      let valid = false;
      let account;
      if (role === 'admin') {
        valid = safeEqual(data.key || '', adminKey);
        account = { role: 'admin', name: 'Quản lý' };
      } else {
        const pin = String(data.pin || '');
        const row = statements.employee.get(code);
        const salt = row ? Buffer.from(row.salt, 'hex') : Buffer.alloc(16);
        const digest = pbkdf2Sync(pin.slice(0, 64), salt, PIN_ITERATIONS, 32, 'sha256').toString('hex');
        valid = Boolean(row && /^\d{6,12}$/.test(pin) && safeEqual(digest, row.pin_hash));
        account = { role: 'employee', code, name: row ? row.name : '' };
      }
      if (!valid) {
        failureKeys.forEach((key, index) => failures.set(key, [...recentByKey[index], current]));
        return sendJson(res, 401, { error: 'Mã đăng nhập hoặc PIN không đúng.' });
      }
      failureKeys.forEach(key => failures.delete(key));
      for (const [token, value] of sessions) if (value.expires <= current) sessions.delete(token);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { ...account, expires: current + SESSION_SECONDS * 1000 });
      return sendJson(res, 200, account, `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`);
    }

    if (path === '/api/logout') {
      sessions.delete(parseCookies(req)[SESSION_COOKIE]);
      return sendJson(res, 200, { ok: true }, `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    }

    const session = sessionFor(req, res, path === '/api/employees');
    if (!session) return;
    if (path === '/api/employees') {
      const code = String(data.code || '').trim().toUpperCase();
      const name = String(data.name || '').trim();
      const pin = String(data.pin || '');
      if (!/^[A-Z0-9_-]{1,24}$/.test(code) || name.length < 1 || name.length > 100 || !/^\d{6,12}$/.test(pin)) {
        return sendJson(res, 400, { error: 'Mã: 1–24 ký tự A–Z, số, _ hoặc -. Tên: tối đa 100 ký tự. PIN: 6–12 chữ số.' });
      }
      const salt = randomBytes(16);
      const hash = pbkdf2Sync(pin, salt, PIN_ITERATIONS, 32, 'sha256').toString('hex');
      try { statements.addEmployee.run(code, name, salt.toString('hex'), hash); }
      catch (error) {
        if (String(error.code).includes('CONSTRAINT')) return sendJson(res, 409, { error: 'Mã nhân viên đã tồn tại.' });
        throw error;
      }
      return sendJson(res, 201, { ok: true });
    }

    if (path === '/api/checkin' || path === '/api/checkout') {
      if (session.role !== 'employee') return sendJson(res, 403, { error: 'Dùng tài khoản nhân viên để chấm công.' });
      let result;
      db.exec('BEGIN IMMEDIATE');
      try {
        const open = statements.openShift.get(session.code);
        const current = Date.now() / 1000;
        if (path === '/api/checkin') {
          if (open) result = { status: 409, data: { error: 'Bạn đang có ca làm chưa check-out.' } };
          else {
            statements.checkin.run(session.code, current, ip);
            result = { status: 200, data: { ok: true, now: isoStamp(current) } };
          }
        } else if (!open) result = { status: 409, data: { error: 'Bạn chưa check-in.' } };
        else if (current < open.checkin) result = { status: 409, data: { error: 'Đồng hồ máy chủ bị lùi. Báo quản lý kiểm tra giờ hệ thống.' } };
        else {
          statements.checkout.run(current, ip, open.id);
          result = { status: 200, data: { ok: true, now: isoStamp(current) } };
        }
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      return sendJson(res, result.status, result.data);
    }
    return sendJson(res, 404, { error: 'Không tìm thấy.' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      console.error('Lỗi máy chủ:', error.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'Máy chủ gặp lỗi. Dữ liệu chấm công chưa được thay đổi.' });
      else res.destroy();
    });
  });
  server.adminKey = adminKey;
  server.database = db;
  server.subnet = subnet;
  server.closeDatabase = () => db.close();
  return server;
}

function parseArguments(argv) {
  const options = { host: '0.0.0.0', port: 8002, subnet: '192.168.1.0/24', database: resolve(ROOT, 'attendance.sqlite3') };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--host', '--port', '--subnet', '--database'].includes(key) || value === undefined) {
      throw new Error(`Tham số không hợp lệ: ${key}`);
    }
    options[key.slice(2)] = key === '--port' ? Number(value) : value;
    index += 1;
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Cổng phải từ 1 đến 65535.');
  return options;
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const server = createAttendanceServer(options);
    server.on('error', error => {
      console.error(`Không mở được máy chủ: ${error.message}`);
      server.closeDatabase();
      process.exitCode = 1;
    });
    server.listen(options.port, options.host, () => {
      console.log(`Chấm công: http://localhost:${options.port}/index2.html`);
      console.log(`Mạng cho phép: ${server.subnet.value} | Múi giờ: Asia/Ho_Chi_Minh (UTC+7)`);
      console.log(`Mã quản lý (giữ riêng, đổi khi khởi động lại): ${server.adminKey}`);
      console.log('Nhấn Ctrl+C để dừng. Giữ máy bật và đồng hồ hệ thống đúng giờ.');
    });
    const stop = () => server.close(() => { server.closeDatabase(); process.exit(0); });
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createAttendanceServer, duration, vietnamDay, parseSubnet, isNetworkAllowed };
