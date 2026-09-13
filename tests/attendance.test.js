'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createAttendanceServer, duration, vietnamDay, parseSubnet, isNetworkAllowed } = require('../attendance_server');

let directory;
let server;
let base;

function request(path, data, cookie, origin) {
  return new Promise((resolve, reject) => {
    const body = data === undefined ? null : JSON.stringify(data);
    const headers = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (cookie) headers.Cookie = cookie;
    if (origin) headers.Origin = origin;
    const req = http.request(`${base}${path}`, { method: body ? 'POST' : 'GET', headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const payload = Buffer.concat(chunks);
        const contentType = response.headers['content-type'] || '';
        resolve({
          status: response.statusCode,
          body: contentType.startsWith('application/json') ? JSON.parse(payload) : payload,
          cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
          headers: response.headers,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function createEmployee(code = 'NV001') {
  const login = await request('/api/login', { role: 'admin', key: server.adminKey });
  assert.equal(login.status, 200);
  const created = await request('/api/employees', { code, name: 'Nguyễn An', pin: '123456' }, login.cookie);
  assert.equal(created.status, 201);
  const employee = await request('/api/login', { role: 'employee', code, pin: '123456' });
  assert.equal(employee.status, 200);
  return employee.cookie;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'attendance-js-'));
  server = createAttendanceServer({ database: join(directory, 'test.sqlite3'), subnet: '192.168.1.0/24' });
  await new Promise((resolve, reject) => {
    const failed = error => reject(error);
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed);
      resolve();
    });
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  server.closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

test('check-in/check-out dùng giờ máy chủ và chỉ cho phép một ca đang mở', async () => {
  const cookie = await createEmployee();
  assert.equal((await request('/api/checkout', {}, cookie)).status, 409);
  assert.equal((await request('/api/checkin', { now: '1900-01-01' }, cookie)).status, 200);
  assert.equal((await request('/api/checkin', {}, cookie)).status, 409);

  let history = await request('/api/shifts', undefined, cookie);
  assert.equal(history.body.shifts.length, 1);
  assert.ok(new Date(history.body.shifts[0].checkin).getUTCFullYear() >= 2026);
  assert.equal(history.body.shifts[0].checkout, null);

  assert.equal((await request('/api/checkout', {}, cookie)).status, 200);
  assert.equal((await request('/api/checkout', {}, cookie)).status, 409);
  history = await request('/api/shifts', undefined, cookie);
  assert.ok(history.body.shifts[0].checkout);
  assert.ok(history.body.shifts[0].seconds >= 0);

  const stored = server.database.prepare('SELECT pin_hash,checkout FROM employees JOIN shifts ON employee=code').get();
  assert.notEqual(stored.pin_hash, '123456');
  assert.notEqual(stored.checkout, null);
});

test('phân quyền, cô lập lịch sử và chỉ phục vụ tệp cho phép', async () => {
  const first = await createEmployee();
  const second = await createEmployee('NV002');
  await request('/api/checkin', {}, first);
  assert.deepEqual((await request('/api/shifts', undefined, second)).body.shifts, []);
  assert.equal((await request('/api/employees', undefined, first)).status, 401);
  assert.equal((await request('/api/shifts')).status, 401);
  assert.equal((await request('/api/checkin', {}, first, 'http://untrusted.example')).status, 403);

  for (const path of ['/attendance.sqlite3', '/attendance_server.js', '/../attendance.sqlite3']) {
    assert.equal((await request(path)).status, 404);
  }
  for (const path of ['/index2.html', '/css2.css', '/appjs2.js']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-frame-options'], 'DENY');
  }
});

test('khóa đăng nhập tạm thời sau nhiều lần thử sai', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await request('/api/login', { role: 'admin', key: 'sai-ma-quan-ly' })).status, 401);
  }
  const blocked = await request('/api/login', { role: 'admin', key: server.adminKey });
  assert.equal(blocked.status, 429);
});

test('tính thời gian thực và xếp ngày theo Việt Nam UTC+7', async () => {
  const subnet = parseSubnet('192.168.1.0/24');
  assert.equal(isNetworkAllowed('192.168.1.25', subnet), true);
  assert.equal(isNetworkAllowed('192.168.2.25', subnet), false);
  assert.equal(isNetworkAllowed('8.8.8.8', subnet), false);
  assert.equal(isNetworkAllowed('::ffff:127.0.0.1', subnet), true);

  const start = Date.parse('2026-09-30T16:30:00Z') / 1000;
  const end = Date.parse('2026-09-30T18:15:00Z') / 1000;
  assert.equal(vietnamDay(start), '2026-09-30');
  assert.equal(vietnamDay(end), '2026-10-01');
  assert.equal(duration(start, end), 6300);
  assert.equal(duration(start, end) / 3600, 1.75);
});
