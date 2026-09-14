'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultHouseholds, nextAvailableHouseholdId, readingDefaults, stripLeadingZeros, paginate, buildPrintReport, stateToSupabaseRows, supabaseRowsToState } = require('./app');

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

test('báo cáo in chỉ lấy hộ đã ghi chỉ số và tách rõ hộ đang nợ', () => {
  const state = {
    households: {
      '1': { name: 'Nguyễn Văn An', active: true },
      '2': { name: 'Trần Thị Bình', active: true },
      '3': { name: 'Hộ đã lưu trữ', active: false }
    },
    records: {
      '2026-08': { '1': { previous: 10, current: 15, debt: 0, note: '' } },
      '2026-09': {
        '1': { previous: 15, current: 21.5, debt: 120000, note: 'Nợ tháng trước' },
        '3': { previous: 4, current: 7, debt: 0, note: '' }
      }
    }
  };
  const report = buildPrintReport(state, '2026-09');
  assert.equal(report.total, 2);
  assert.equal(report.recorded, 2);
  assert.equal(report.paid, 1);
  assert.equal(report.owing, 1);
  assert.equal(report.consumption, 9.5);
  assert.equal(report.debt, 120000);
  assert.deepEqual(report.rows.map(row => row.id), ['001', '003']);
  assert.equal(report.rows[0].previous, 15);
  assert.equal(report.rows[0].status, 'Đang nợ');
  assert.equal(report.rows[1].status, 'Đã ghi chỉ số');
  assert.equal(buildPrintReport(state, '2026-10').total, 0);
});

test('Supabase lưu mỗi hộ và chỉ số từng tháng thành dòng riêng', () => {
  const source = {
    households: { '1': { name: 'Nguyễn Văn An', active: true }, '2': { name: 'Trần Thị Bình', active: false } },
    records: {
      '2026-08': { '1': { previous: 10, current: 14, debt: 0, note: '' } },
      '2026-09': { '1': { previous: 14, current: 20.5, debt: 150000, note: 'Còn nợ' } }
    }
  };
  const rows = stateToSupabaseRows(source);
  assert.equal(rows.households.length, 2);
  assert.equal(rows.readings.length, 2);
  assert.deepEqual(rows.readings[1], {
    household_id: '1', reading_year: 2026, reading_month: 9,
    previous_reading: 14, current_reading: 20.5, start_period: '',
    debt_amount: 150000, note: 'Còn nợ'
  });
  const restored = supabaseRowsToState(rows.households, rows.readings.map(row => ({ ...row, consumption: row.current_reading - row.previous_reading })), 123);
  assert.equal(restored.records['2026-09']['1'].previous, 14);
  assert.equal(restored.records['2026-09']['1'].current, 20.5);
  assert.equal(restored.records['2026-09']['1'].current - restored.records['2026-09']['1'].previous, 6.5);
  assert.equal(restored.updatedAt, 123);
});
