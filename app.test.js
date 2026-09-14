'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultHouseholds, nextAvailableHouseholdId, readingDefaults, stripLeadingZeros, paginate } = require('./app');

test('form của hộ mới bắt đầu từ 0, không dùng chỉ số hộ trước', () => {
  assert.deepEqual(readingDefaults(undefined, undefined), { previous: 0, current: 0 });
  assert.deepEqual(readingDefaults(25, undefined), { previous: 25, current: 25 });
  assert.deepEqual(readingDefaults(25, 30), { previous: 25, current: 30 });
});

test('ô chỉ số loại bỏ số 0 thừa ở đầu', () => {
  assert.equal(stripLeadingZeros('01'), '1');
  assert.equal(stripLeadingZeros('0100'), '100');
  assert.equal(stripLeadingZeros('0.5'), '0.5');
  assert.equal(stripLeadingZeros('0'), '0');
});

test('mã hộ mới dùng lại mã trống nhỏ nhất', () => {
  const households = defaultHouseholds();
  households['200'].active = false;
  assert.equal(nextAvailableHouseholdId(households), '200');
  delete households['18'];
  assert.equal(nextAvailableHouseholdId(households), '18');
  const records = { '2026-09': { '18': { previous: 0, current: 1 } } };
  assert.equal(nextAvailableHouseholdId(households, records), '200');
  records['2026-09']['200'] = { previous: 0, current: 1 };
  assert.equal(nextAvailableHouseholdId(households, records), '201');
});

test('phân trang giới hạn số hộ và tự giữ trang hợp lệ', () => {
  const ids = Array.from({ length: 27 }, (_, index) => String(index + 1));
  assert.deepEqual(paginate(ids, 1, 10).items, ids.slice(0, 10));
  assert.deepEqual(paginate(ids, 2, 10).items, ids.slice(10, 20));
  const last = paginate(ids, 99, 10);
  assert.equal(last.page, 3);
  assert.deepEqual(last.items, ids.slice(20));
});
