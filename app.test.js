'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultHouseholds, nextAvailableHouseholdId, readingDefaults } = require('./app');

test('form của hộ mới bắt đầu từ 0, không dùng chỉ số hộ trước', () => {
  assert.deepEqual(readingDefaults(undefined, undefined), { previous: 0, current: 0 });
  assert.deepEqual(readingDefaults(25, undefined), { previous: 25, current: 25 });
  assert.deepEqual(readingDefaults(25, 30), { previous: 25, current: 30 });
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
