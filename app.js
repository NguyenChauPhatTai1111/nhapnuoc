'use strict';
if (typeof document !== 'undefined') {
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
let csrfToken = null;
async function apiRequest(action, options = {}) {
  const response = await fetch(`api.php?action=${encodeURIComponent(action)}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      window.soNuocApi.authenticated = false;
      setAuthenticated(false);
    }
    throw Error(result.error || `Máy chủ phản hồi lỗi ${response.status}.`);
  }
  if (result.csrfToken) csrfToken = result.csrfToken;
  return result;
}
window.soNuocApi = { request: apiRequest, onAuthenticated: null, authenticated: false };
function setAuthenticated(authenticated) {
  document.body.classList.toggle('auth-locked', !authenticated);
  loginScreen.hidden = authenticated;
  if (!authenticated) requestAnimationFrame(() => loginUsername.focus());
}
setAuthenticated(false);
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    await apiRequest('login', { method: 'POST', body: JSON.stringify({ username: loginUsername.value.trim(), password: loginPassword.value }) });
    window.soNuocApi.authenticated = true;
    loginError.hidden = true;
    loginPassword.value = '';
    setAuthenticated(true);
    await window.soNuocApi.onAuthenticated?.();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
    loginPassword.select();
  } finally {
    submitButton.disabled = false;
  }
});
document.getElementById('toggle-password').addEventListener('click', event => {
  const showing = loginPassword.type === 'text';
  loginPassword.type = showing ? 'password' : 'text';
  event.currentTarget.textContent = showing ? 'Hiện' : 'Ẩn';
  event.currentTarget.setAttribute('aria-label', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
});
document.getElementById('logout').addEventListener('click', async () => {
  await apiRequest('logout', { method: 'POST', body: '{}' }).catch(() => {});
  window.soNuocApi.authenticated = false;
  csrfToken = null;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  loginForm.reset();
  loginError.hidden = true;
  setAuthenticated(false);
});
apiRequest('session').then(async session => {
  window.soNuocApi.authenticated = session.authenticated;
  setAuthenticated(session.authenticated);
  if (session.authenticated) await window.soNuocApi.onAuthenticated?.();
}).catch(error => {
  loginError.textContent = error.message;
  loginError.hidden = false;
});
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const monthValid = m => typeof m === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(m);
function previousMonth(m) { const [y, n] = m.split('-').map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, '0')}`; }
function nextMonth(m) { const [y, n] = m.split('-').map(Number); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; }
function monthsInRange(start, end) {
  if (!monthValid(start) || !monthValid(end) || start > end) return [];
  const months = [];
  for (let month = start; month <= end; month = nextMonth(month)) months.push(month);
  return months;
}
const numberValid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e12;
function defaultHouseholds() { return Object.fromEntries(Array.from({ length: 200 }, (_, index) => [String(index + 1), { name: `Hộ dân ${String(index + 1).padStart(3, '0')}`, active: true }])); }
function nextAvailableHouseholdId(households, records = {}) {
  const historicalIds = new Set(Object.values(records).flatMap(houses => Object.keys(houses)));
  let id = 1;
  while (households[String(id)]?.active || historicalIds.has(String(id))) id++;
  return String(id);
}
function readingDefaults(previous, current) { const old = previous ?? 0; return { previous: old, current: current ?? old }; }
function stripLeadingZeros(value) { return String(value).replace(/^0+(?=\d)/, ''); }
function paginate(items, requestedPage, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, totalPages, start: items.length ? start + 1 : 0, end: Math.min(start + pageSize, items.length) };
}
function normalizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Dữ liệu sao lưu không hợp lệ.');
  const households = { ...(value.households ?? defaultHouseholds()) };
  for (const houses of Object.values(value.records ?? {})) for (const id of Object.keys(houses)) households[id] ??= { name: `Hộ dân ${String(id).padStart(3, '0')}`, active: true };
  return { ...value, households };
}
function validateHouseholds(households) {
  if (!households || typeof households !== 'object' || Array.isArray(households)) throw Error('Danh sách hộ dân không hợp lệ.');
  if (Object.keys(households).length > 5000) throw Error('Danh sách hộ dân vượt quá giới hạn an toàn 5.000 hộ.');
  for (const [id, household] of Object.entries(households)) {
    if (!/^[1-9]\d*$/.test(id) || !household || typeof household.name !== 'string' || !household.name.trim() || household.name.length > 100 || typeof household.active !== 'boolean') throw Error(`Thông tin hộ dân ${id} không hợp lệ.`);
  }
  return households;
}
function buildMonthlyRecords(start, end, previous, currents, debt = 0, note = '') {
  const months = monthsInRange(start, end);
  if (!numberValid(previous) || months.length === 0 || currents.length !== months.length) throw Error('Vui lòng nhập đủ chỉ số cho từng tháng.');
  const result = {}; let prior = previous;
  months.forEach((month, index) => {
    const current = currents[index];
    if (!numberValid(current) || current < prior) throw Error(`Chỉ số mới tháng ${month.split('-').reverse().join('/')} phải lớn hơn hoặc bằng chỉ số trước đó.`);
    result[month] = { previous: prior, current, debt: index === months.length - 1 ? debt : 0, note: index === months.length - 1 ? note : '' };
    prior = current;
  });
  return result;
}
function baseline(records, month, id) { return records[previousMonth(records[month]?.[id]?.startMonth ?? month)]?.[id]?.current ?? records[month]?.[id]?.previous; }
function coveredRecord(records, month, id) {
  for (const end of Object.keys(records).sort()) {
    const record = records[end]?.[id];
    if (record && (record.startMonth ?? end) <= month && month <= end) return { end, record };
  }
  return null;
}
function periodLabel(start, end) { return start === end ? end : `${start} → ${end}`; }
function buildPrintReport(state, month) {
  if (!state || !monthValid(month)) throw Error('Tháng in không hợp lệ.');
  const ids = Object.keys(state.households)
    .filter(id => Boolean(coveredRecord(state.records, month, id)))
    .sort((a, b) => a - b);
  let owing = 0, consumption = 0, debt = 0;
  const rows = ids.map((id, index) => {
    const found = coveredRecord(state.records, month, id), record = found.record, end = found.end;
    const previous = baseline(state.records, end, id), used = record.current - previous;
    consumption += used; debt += record.debt || 0;
    if (record.debt > 0) owing++;
    return {
      number: index + 1,
      id: String(id).padStart(3, '0'),
      name: state.households[id]?.name ?? `Hộ dân ${String(id).padStart(3, '0')}`,
      period: record ? periodLabel(record.startMonth ?? end, end) : month,
      previous,
      current: record.current,
      consumption: used,
      debt: record.debt || 0,
      note: record.note || '',
      status: record.debt > 0 ? 'Đang nợ' : 'Đã ghi chỉ số'
    };
  });
  return { rows, total: rows.length, recorded: rows.length, owing, paid: rows.length - owing, consumption, debt };
}
function stateMutations(before, next) {
  const mutations = [];
  const oldHouseholds = before?.households ?? {}, newHouseholds = next.households ?? {};
  for (const [id, household] of Object.entries(newHouseholds)) {
    if (JSON.stringify(oldHouseholds[id]) !== JSON.stringify(household)) mutations.push({ type: 'household_upsert', id, name: household.name, active: household.active });
  }
  const oldRecords = before?.records ?? {}, newRecords = next.records ?? {};
  const periods = new Set([...Object.keys(oldRecords), ...Object.keys(newRecords)]);
  for (const period of periods) {
    const ids = new Set([...Object.keys(oldRecords[period] ?? {}), ...Object.keys(newRecords[period] ?? {})]);
    for (const householdId of ids) {
      const oldRecord = oldRecords[period]?.[householdId], record = newRecords[period]?.[householdId];
      if (!record && oldRecord) mutations.push({ type: 'reading_delete', householdId, period });
      else if (record && JSON.stringify(oldRecord) !== JSON.stringify(record)) mutations.push({
        type: 'reading_upsert', householdId, period,
        previous: record.previous, current: record.current,
        startMonth: record.startMonth ?? null, debt: record.debt || 0, note: record.note || ''
      });
    }
  }
  for (const id of Object.keys(oldHouseholds)) if (!newHouseholds[id]) mutations.push({ type: 'household_delete', id });
  return mutations;
}
function validateRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw Error('Dữ liệu sao lưu không hợp lệ.');
  if (Object.keys(records).length > 1200) throw Error('Dữ liệu vượt quá giới hạn an toàn 1.200 tháng.');
  let recordCount = 0;
  for (const [month, houses] of Object.entries(records)) {
    if (!monthValid(month) || !houses || typeof houses !== 'object' || Array.isArray(houses)) throw Error('Tháng trong dữ liệu không hợp lệ.');
    recordCount += Object.keys(houses).length;
    if (recordCount > 250000) throw Error('Dữ liệu vượt quá giới hạn an toàn 250.000 bản ghi.');
    for (const [id, r] of Object.entries(houses)) {
      if (!/^[1-9]\d*$/.test(id) || !r || !numberValid(r.previous) || !numberValid(r.current)) throw Error('Chỉ số hoặc số hộ trong dữ liệu không hợp lệ.');
      if (r.startMonth !== undefined && (!monthValid(r.startMonth) || r.startMonth > month)) throw Error('Tháng bắt đầu phải nhỏ hơn hoặc bằng tháng kết thúc.');
      if (r.debt !== undefined && (!numberValid(r.debt) || !Number.isInteger(r.debt))) throw Error('Số tiền nợ không hợp lệ.');
      if (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > 1000)) throw Error('Ghi chú tối đa 1000 ký tự.');
      if (r.current < baseline(records, month, id)) throw Error(`Hộ ${id}, tháng ${month}: chỉ số mới nhỏ hơn chỉ số tháng trước.`);
    }
  }
  const householdIds = new Set(Object.values(records).flatMap(houses => Object.keys(houses)));
  for (const id of householdIds) {
    let lastEnd = null;
    for (const end of Object.keys(records).sort()) {
      const r = records[end][id]; if (!r) continue;
      if (lastEnd && (r.startMonth ?? end) <= lastEnd) throw Error(`Hộ ${id}: kỳ ghi bị trùng với kỳ kết thúc tháng ${lastEnd}.`);
      lastEnd = end;
    }
  }
  return records;
}
if (typeof module !== 'undefined') module.exports = { previousMonth, nextMonth, monthsInRange, buildMonthlyRecords, defaultHouseholds, nextAvailableHouseholdId, readingDefaults, stripLeadingZeros, paginate, normalizeState, validateHouseholds, baseline, validateRecords, coveredRecord, buildPrintReport, stateMutations, WEEK };
if (typeof document !== 'undefined') {
  document.querySelector('thead th:last-child').textContent = 'THAO TÁC';
  document.querySelector('.heading > div > p:last-child').textContent = 'Quản lý danh sách hộ dân, chỉ số đồng hồ và lượng nước sử dụng theo từng tháng.';
  const $ = id => document.getElementById(id);
  const api = window.soNuocApi;
  const isEditorNumber = element => element instanceof HTMLInputElement && element.type === 'number' && $('editor').contains(element);
  document.addEventListener('focusin', event => {
    if (isEditorNumber(event.target) && event.target.value === '0') event.target.select();
  });
  document.addEventListener('input', event => {
    if (!isEditorNumber(event.target)) return;
    const normalized = stripLeadingZeros(event.target.value);
    if (normalized !== event.target.value) event.target.value = normalized;
  });
  document.addEventListener('wheel', event => {
    if (isEditorNumber(event.target)) event.target.blur();
  }, { capture: true, passive: true });
  const fmt = n => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
  const append = (parent, tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    parent.append(element); return element;
  };
  const makeButton = (text, className) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = className; button.textContent = text;
    return button;
  };
  const currentLabel = $('current').closest('label'), previousLabel = $('previous').closest('label'), previousHint = $('previous-hint');
  const periodFields = document.querySelector('.period-fields'), periodHint = document.querySelector('.period-fields + .hint');
  const monthlyReadings = document.createElement('div'), multiToggle = document.createElement('button');
  monthlyReadings.id = 'monthly-readings'; previousLabel.before(monthlyReadings);
  multiToggle.type = 'button'; multiToggle.className = 'multi-toggle'; periodFields.before(multiToggle);
  const clearCacheButton = makeButton('↻ Tải lại dữ liệu', 'clear-cache');
  const clearCacheHost = document.querySelector('.notice') ?? document.querySelector('.actions');
  clearCacheHost?.append(clearCacheButton);
  const addHouseholdButton = makeButton('＋ Thêm hộ dân', 'add-household');
  $('count').before(addHouseholdButton);
  const actionToggleButton = makeButton('Quản lý hộ', 'action-toggle');
  actionToggleButton.setAttribute('aria-pressed', 'false');
  actionToggleButton.setAttribute('aria-controls', 'rows');
  addHouseholdButton.before(actionToggleButton);
  const panel = document.querySelector('.panel'); panel.classList.add('actions-hidden');
  const pagination = document.createElement('nav'); pagination.className = 'pagination'; pagination.setAttribute('aria-label', 'Phân trang danh sách hộ dân');
  const previousPageButton = makeButton('← Trước', 'page-button');
  const pageInfo = document.createElement('span'); pageInfo.className = 'page-info'; pageInfo.setAttribute('aria-live', 'polite');
  const nextPageButton = makeButton('Sau →', 'page-button');
  pagination.append(previousPageButton, pageInfo, nextPageButton); document.querySelector('.panel-footer').before(pagination);
  const householdDialog = $('household-dialog');
  previousLabel.hidden = true; previousHint.hidden = true; currentLabel.hidden = true; $('previous').required = false; $('current').required = false;
  periodHint.textContent = 'Chọn 2 hoặc 3 tháng. Mỗi tháng có chỉ số cũ và chỉ số mới riêng; chỉ số cũ của tháng sau tự lấy từ chỉ số mới tháng trước.';
  let state, ready = false, saving = false, loading = false, editing = null, householdEditing = null, toastTimer, multiEntry = false, currentPage = 1, actionsVisible = false;
  const mobileList = matchMedia('(max-width:700px)');
  const fresh = () => ({ version: 1, resetAt: Date.now() + WEEK, households: defaultHouseholds(), records: {} });
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5500); }
  async function initializeStorage() {
    if (loading) return;
    loading = true;
    try {
      const loaded = normalizeState(await api.request('state'));
      validateHouseholds(loaded.households); validateRecords(loaded.records);
      if (!Object.keys(loaded.households).length) {
        const initial = fresh();
        await api.request('mutations', { method: 'POST', body: JSON.stringify({ mutations: stateMutations(null, initial) }) });
        state = initial;
      } else state = loaded;
      ready = true;
      document.querySelector('.local').textContent = '● Đã kết nối MySQL';
      render();
    } catch (error) {
      ready = false;
      console.error('Không tải được dữ liệu MySQL:', error);
      toast(error.message || 'Không tải được dữ liệu từ MySQL.');
    } finally { loading = false; }
  }
  async function persist(next) {
    if (saving) return false;
    saving = true;
    try {
      const mutations = stateMutations(state, next);
      if (mutations.length) await api.request('mutations', { method: 'POST', body: JSON.stringify({ mutations }) });
      state = next;
      document.querySelector('.local').textContent = '● Đã lưu vào MySQL';
      return true;
    } catch (err) {
      console.error('Không lưu được dữ liệu:', err);
      toast(err.message || 'Không lưu được dữ liệu vào MySQL.'); return false;
    } finally { saving = false; }
  }
  api.onAuthenticated = initializeStorage;
  const reloadFromMySql = () => { if (api.authenticated && !saving && !loading) initializeStorage(); };
  window.addEventListener('focus', reloadFromMySql);
  window.addEventListener('pageshow', reloadFromMySql);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reloadFromMySql(); });
  clearCacheButton.addEventListener('click', async () => { await initializeStorage(); if (ready) toast('Đã tải dữ liệu mới nhất từ MySQL.'); });
  const moreActions = document.querySelector('.more-actions');
  $('excel-mobile').addEventListener('click', () => $('excel').click());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && moreActions?.open) {
      moreActions.open = false;
      moreActions.querySelector('summary').focus();
    }
  });
  document.addEventListener('click', event => {
    if (moreActions?.open && !moreActions.contains(event.target)) moreActions.open = false;
  });
  moreActions?.querySelector('.action-menu')?.addEventListener('click', event => {
    if (event.target.closest('button')) moreActions.open = false;
  });
  const now = new Date(); $('month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let pickerYear = now.getFullYear();
  const monthNames = Array.from({ length: 12 }, (_, index) => `Tháng ${index + 1}`);
  function updateMonthDisplay() {
    const [year, month] = $('month').value.split('-');
    $('month-display').textContent = `Tháng ${month} / ${year}`;
  }
  function renderMonthPicker() {
    $('picker-year').textContent = pickerYear;
    const currentValue = $('month').value;
    const todayValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    $('month-grid').replaceChildren(...monthNames.map((name, index) => {
      const button = document.createElement('button');
      const value = `${pickerYear}-${String(index + 1).padStart(2, '0')}`;
      button.type = 'button'; button.textContent = name; button.dataset.monthValue = value;
      button.classList.toggle('is-selected', value === currentValue);
      button.classList.toggle('is-current', value === todayValue);
      button.setAttribute('aria-pressed', String(value === currentValue));
      return button;
    }));
  }
  function closeMonthPicker() {
    $('month-picker').hidden = true;
    $('month-trigger').setAttribute('aria-expanded', 'false');
  }
  function selectMonth(value) {
    if (!monthValid(value)) return;
    $('month').value = value; updateMonthDisplay(); closeMonthPicker();
    $('month').dispatchEvent(new Event('input', { bubbles: true }));
  }
  function shiftSelectedMonth(offset) {
    selectMonth(offset < 0 ? previousMonth($('month').value) : nextMonth($('month').value));
  }
  updateMonthDisplay();
  $('month-trigger').addEventListener('click', () => {
    const opening = $('month-picker').hidden;
    if (!opening) { closeMonthPicker(); return; }
    pickerYear = Number($('month').value.slice(0, 4)); renderMonthPicker();
    $('month-picker').hidden = false; $('month-trigger').setAttribute('aria-expanded', 'true');
  });
  $('month-previous').addEventListener('click', () => shiftSelectedMonth(-1));
  $('month-next').addEventListener('click', () => shiftSelectedMonth(1));
  $('year-previous').addEventListener('click', () => { pickerYear--; renderMonthPicker(); });
  $('year-next').addEventListener('click', () => { pickerYear++; renderMonthPicker(); });
  $('month-grid').addEventListener('click', event => { const button = event.target.closest('[data-month-value]'); if (button) selectMonth(button.dataset.monthValue); });
  $('month-today').addEventListener('click', () => selectMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`));
  document.addEventListener('click', event => { if (!$('month-picker').hidden && !event.target.closest('.month-label')) closeMonthPicker(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('month-picker').hidden) { closeMonthPicker(); $('month-trigger').focus(); } });
  function checkExpiry() { return false; }
  function householdName(id) { return state.households[id]?.name ?? `Hộ dân ${String(id).padStart(3, '0')}`; }
  function openHouseholdEditor(mode, id = null) {
    if (!ready || saving) return;
    if (mode === 'add') {
      id = nextAvailableHouseholdId(state.households, state.records);
    }
    householdEditing = { mode, id };
    $('household-mode').textContent = mode === 'add' ? 'THÊM HỘ DÂN MỚI' : 'CHỈNH SỬA HỘ DÂN';
    $('household-dialog-title').textContent = mode === 'add' ? 'Thêm hộ dân' : 'Đổi tên hộ dân';
    $('household-code').textContent = `Mã hộ ${id.padStart(3, '0')}`;
    $('household-name').value = mode === 'add' ? '' : householdName(id);
    $('household-error').textContent = '';
    householdDialog.showModal(); setTimeout(() => $('household-name').focus(), 0);
  }
  $('household-dialog-close').onclick = $('household-cancel').onclick = () => householdDialog.close();
  householdDialog.addEventListener('close', () => { householdEditing = null; });
  $('household-name').addEventListener('input', () => { $('household-error').textContent = ''; });
  $('household-form').onsubmit = async e => {
    e.preventDefault(); if (!householdEditing || saving) return;
    const name = $('household-name').value.trim();
    if (!name || name.length > 100) { $('household-error').textContent = 'Tên hộ dân phải có từ 1 đến 100 ký tự.'; return; }
    const { mode, id } = householdEditing, next = JSON.parse(JSON.stringify(state));
    if (mode === 'add') next.households[id] = { name, active: true }; else next.households[id].name = name;
    if (await persist(next)) {
      householdDialog.close(); render();
      toast(mode === 'add' ? `Đã thêm ${name} với mã hộ ${id.padStart(3, '0')}.` : `Đã đổi tên mã hộ ${id.padStart(3, '0')} thành ${name}.`);
    }
  };
  function render() {
    const month = $('month').value, records = state.records[month] || {};
    const activeIds = Object.keys(state.households).filter(id => state.households[id].active).sort((a, b) => a - b);
    const ids = activeIds.filter(id => coveredRecord(state.records, month, id)); let total = 0;
    Object.keys(records).forEach(id => total += records[id].current - baseline(state.records, month, id));
    const householdTotal = document.querySelector('.stats article:first-child strong');
    householdTotal.replaceChildren(document.createTextNode(`${activeIds.length} `)); append(householdTotal, 'small', 'hộ');
    document.querySelector('.stats article:first-child p').textContent = 'Danh sách hộ dân đang quản lý';
    $('recorded').replaceChildren(document.createTextNode(`${ids.length} `)); append($('recorded'), 'small', `/ ${activeIds.length} hộ`);
    $('progress').style.width = `${activeIds.length ? ids.length / activeIds.length * 100 : 0}%`;
    $('total').replaceChildren(document.createTextNode(`${fmt(total)} `)); append($('total'), 'small', 'm³');
    $('total-note').textContent = `Tổng các kỳ kết thúc tháng ${month.split('-').reverse().join('/')}`;

    const query = $('search').value.trim().replace(/^hộ\s*/i, '');
    const fragment = document.createDocumentFragment();
    const displayIds = Object.keys(state.households).filter(id => state.households[id].active || coveredRecord(state.records, month, id)).sort((a, b) => a - b);
    const matchingIds = displayIds.filter(id => {
      const label = String(id).padStart(3, '0'), name = householdName(id), record = coveredRecord(state.records, month, id)?.record, filter = $('filter').value;
      if (query && !label.includes(query) && !name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))) return false;
      if (filter === 'done' && !record || filter === 'pending' && record || filter === 'debt' && !(record?.debt > 0)) return false;
      return true;
    });
    const pageResult = paginate(matchingIds, currentPage, mobileList.matches ? 10 : 25);
    currentPage = pageResult.page;
    for (const id of pageResult.items) {
      const label = String(id).padStart(3, '0'), household = state.households[id], name = householdName(id), found = coveredRecord(state.records, month, id), r = found?.record, end = found?.end ?? month;
      const prev = baseline(state.records, end, id);
      const customName = name !== `Hộ dân ${label}`, archived = !household.active;
      const row = document.createElement('tr'), identity = append(row, 'td'), icon = append(identity, 'span', '⌂', 'house'), identityText = append(identity, 'span', name);
      icon.setAttribute('aria-hidden', 'true');
      if (customName) append(identityText, 'small', `Mã hộ ${label}`, 'house-code');
      if (archived) append(identityText, 'small', 'Đã xóa khỏi danh sách nhập mới', 'archived');
      append(row, 'td', r ? periodLabel(r.startMonth ?? end, end) : month);
      append(row, 'td', prev === undefined ? '—' : fmt(prev)); append(row, 'td', r ? fmt(r.current) : '—'); append(row, 'td', r ? fmt(r.current - prev) : '—');
      const debtCell = append(row, 'td', r?.debt > 0 ? `${fmt(r.debt)} đ` : '—', 'debt-cell'); append(debtCell, 'small', r?.note || '');
      const status = append(row, 'td'); append(status, 'span', r?.debt > 0 ? 'Đang nợ' : r ? 'Đã ghi chỉ số' : 'Chưa ghi', `badge ${r?.debt > 0 ? 'owing' : r ? 'done' : ''}`);
      const actionCell = append(row, 'td'), actions = append(actionCell, 'div', undefined, 'row-actions');
      const edit = append(actions, 'button', r ? 'Sửa chỉ số' : '＋ Ghi chỉ số', 'edit'); edit.type = 'button'; edit.dataset.id = id;
      if (r) { const remove = append(actions, 'button', 'Xóa chỉ số', 'delete'); remove.type = 'button'; remove.dataset.deleteId = id; }
      const rename = append(actions, 'button', 'Đổi tên', 'rename'); rename.type = 'button'; rename.dataset.renameId = id;
      const archive = append(actions, 'button', archived ? 'Khôi phục hộ' : 'Xóa hộ', archived ? 'restore' : 'archive'); archive.type = 'button'; archive.dataset[archived ? 'restoreId' : 'archiveId'] = id;
      fragment.append(row);
    }
    $('rows').replaceChildren(fragment);
    $('count').textContent = matchingIds.length ? `Hộ ${pageResult.start}–${pageResult.end} / ${matchingIds.length}` : 'Không có hộ phù hợp';
    $('empty').hidden = matchingIds.length !== 0;
    pagination.hidden = matchingIds.length <= (mobileList.matches ? 10 : 25);
    pageInfo.textContent = `Trang ${pageResult.page} / ${pageResult.totalPages}`;
    previousPageButton.disabled = pageResult.page === 1;
    nextPageButton.disabled = pageResult.page === pageResult.totalPages;
  }
  ['month', 'search', 'filter'].forEach(id => $(id).addEventListener('input', () => { if (!ready || id === 'month' && !monthValid($('month').value)) return; currentPage = 1; checkExpiry(); render(); }));
  actionToggleButton.addEventListener('click', () => {
    actionsVisible = !actionsVisible;
    panel.classList.toggle('actions-hidden', !actionsVisible);
    panel.classList.toggle('actions-visible', actionsVisible);
    actionToggleButton.textContent = actionsVisible ? 'Đóng quản lý' : 'Quản lý hộ';
    actionToggleButton.setAttribute('aria-pressed', String(actionsVisible));
  });
  previousPageButton.addEventListener('click', () => { if (currentPage > 1) { currentPage--; render(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  nextPageButton.addEventListener('click', () => { currentPage++; render(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  mobileList.addEventListener('change', () => { currentPage = 1; if (ready) render(); });
  addHouseholdButton.addEventListener('click', () => openHouseholdEditor('add'));
  $('rows').addEventListener('click', async e => {
    if (!ready || saving || checkExpiry()) return;
    const renameButton = e.target.closest('button[data-rename-id]');
    if (renameButton) {
      openHouseholdEditor('rename', renameButton.dataset.renameId);
      return;
    }
    const archiveButton = e.target.closest('button[data-archive-id]');
    if (archiveButton) {
      const id = archiveButton.dataset.archiveId, name = householdName(id);
      const hasHistory = Object.values(state.records).some(records => Object.hasOwn(records, id));
      const message = hasHistory
        ? `Xóa ${name} (mã hộ ${id.padStart(3, '0')}) khỏi danh sách nhập mới? Lịch sử chỉ số vẫn được giữ lại và mã hộ này chưa thể cấp cho hộ khác.`
        : `Xóa ${name} (mã hộ ${id.padStart(3, '0')})? Mã hộ này sẽ có thể dùng lại khi thêm hộ mới.`;
      if (!confirm(message)) return;
      const next = JSON.parse(JSON.stringify(state));
      if (hasHistory) next.households[id].active = false; else delete next.households[id];
      if (await persist(next)) {
        render();
        toast(hasHistory ? `Đã lưu trữ ${name}; lịch sử vẫn được giữ nguyên.` : `Đã xóa ${name}; mã hộ ${id.padStart(3, '0')} có thể dùng lại.`);
      }
      return;
    }
    const restoreButton = e.target.closest('button[data-restore-id]');
    if (restoreButton) {
      const id = restoreButton.dataset.restoreId, next = JSON.parse(JSON.stringify(state)); next.households[id].active = true;
      if (await persist(next)) { render(); toast(`Đã khôi phục ${householdName(id)} vào danh sách nhập.`); }
      return;
    }
    const deleteButton = e.target.closest('button[data-delete-id]');
    if (deleteButton) {
      const selectedMonth = $('month').value, id = deleteButton.dataset.deleteId, found = coveredRecord(state.records, selectedMonth, id);
      if (!found) return;
      const start = found.record.startMonth ?? found.end, period = periodLabel(start, found.end);
      if (!confirm(`Xóa chỉ số hộ dân ${String(id).padStart(3, '0')} của kỳ ${period}? Thao tác này không thể hoàn tác nếu chưa xuất sao lưu.`)) return;
      const next = JSON.parse(JSON.stringify(state)); delete next.records[found.end][id];
      if (Object.keys(next.records[found.end]).length === 0) delete next.records[found.end];
      if (await persist(next)) { render(); toast(`Đã xóa chỉ số hộ dân ${String(id).padStart(3, '0')} của kỳ ${period}.`); }
      return;
    }
    const button = e.target.closest('button[data-id]'); if (!button) return;
    const month = $('month').value; if (!monthValid(month)) { toast('Vui lòng chọn tháng hợp lệ.'); return; }
    const found = coveredRecord(state.records, month, button.dataset.id);
    editing = { id: button.dataset.id, month: found?.end ?? month, originalEnd: found?.end, originalStart: found?.record?.startMonth }; const r = found?.record;
    multiEntry = Boolean(r?.startMonth && r.startMonth !== editing.month);
    $('period-start').value = r?.startMonth ?? editing.month; $('period-start').max = editing.month;
    $('period-end').value = editing.month;
    const inherited = state.records[previousMonth($('period-start').value)]?.[editing.id]?.current;
    $('edit-title').textContent = `${householdName(editing.id)} · Mã hộ ${String(editing.id).padStart(3, '0')}`;
    $('edit-month').textContent = `GHI CHỈ SỐ • THÁNG ${editing.month.split('-').reverse().join('/')}`;
    $('previous').value = inherited ?? r?.previous ?? ''; $('previous').readOnly = inherited !== undefined;
    $('previous-hint').textContent = inherited !== undefined ? 'Tự lấy từ chỉ số đã ghi trước kỳ ghi.' : 'Chưa có chỉ số trước kỳ ghi. Nhập chỉ số ban đầu để làm mốc tính.';
    $('debt').value = r?.debt ?? 0; $('debt-note').value = r?.note ?? '';
    $('current').value = r?.current ?? ''; $('error').textContent = ''; updateEntryMode(); rebuildMonthlyReadings(false); preview(); $('editor').showModal();
  });
  multiToggle.addEventListener('click', () => {
    if (!editing) return;
    multiEntry = !multiEntry;
    if (multiEntry) $('period-start').value = previousMonth($('period-end').value); else { $('period-end').value = editing.month; $('period-start').value = editing.month; }
    updateEntryMode(); rebuildMonthlyReadings(); preview();
  });
  function updateEntryMode() {
    periodFields.hidden = !multiEntry; periodHint.hidden = !multiEntry;
    multiToggle.textContent = multiEntry ? 'Nhập một tháng' : '＋ Nhập 2 hoặc 3 tháng';
    multiToggle.setAttribute('aria-pressed', String(multiEntry));
    $('period-end').readOnly = !multiEntry;
    if (multiEntry) {
      const end = $('period-end').value;
      $('period-start').min = previousMonth(previousMonth(end));
      $('period-start').max = previousMonth(end);
    } else {
      $('period-start').removeAttribute('min'); $('period-start').max = editing.month; $('period-start').value = editing.month;
    }
  }
  $('period-start').addEventListener('input', () => {
    if (!editing) return;
    rebuildMonthlyReadings(); preview();
  });
  $('period-end').addEventListener('input', () => {
    if (!editing || !multiEntry || !monthValid($('period-end').value)) return;
    const end = $('period-end').value, minStart = previousMonth(previousMonth(end)), maxStart = previousMonth(end);
    $('period-start').min = minStart; $('period-start').max = maxStart;
    if ($('period-start').value < minStart || $('period-start').value > maxStart) $('period-start').value = maxStart;
    const endRecord = state.records[end]?.[editing.id];
    $('debt').value = endRecord?.debt ?? 0; $('debt-note').value = endRecord?.note ?? '';
    $('edit-month').textContent = `GHI CHỈ SỐ • ĐẾN THÁNG ${monthDisplay(end)}`;
    rebuildMonthlyReadings(); preview();
  });
  function monthDisplay(month) { return month.split('-').reverse().join('/'); }
  function rebuildMonthlyReadings(preserveDraft = true) {
    const saved = preserveDraft ? new Map([...monthlyReadings.querySelectorAll('.month-reading')].map(card => [card.dataset.month, { previous: card.querySelector('[data-previous]').value, current: card.querySelector('[data-current]').value }])) : new Map();
    const months = monthsInRange($('period-start').value, $('period-end').value);
    monthlyReadings.replaceChildren();
    months.forEach((month, index) => {
      const card = document.createElement('fieldset'); card.className = 'month-reading'; card.dataset.month = month;
      const legend = document.createElement('legend'); legend.textContent = `Tháng ${monthDisplay(month)}`; card.append(legend);
      const existing = state.records[month]?.[editing.id];
      const exact = existing && (existing.startMonth ?? month) === month ? existing : null;
      const original = state.records[editing.month]?.[editing.id], originalStart = original?.startMonth ?? editing.month;
      const inherited = index === 0 ? state.records[previousMonth(month)]?.[editing.id]?.current : undefined;
      const oldLabel = document.createElement('label'); oldLabel.textContent = 'Chỉ số cũ (m³)';
      const oldInput = document.createElement('input'); oldInput.type = 'number'; oldInput.min = '0'; oldInput.max = '1000000000000'; oldInput.step = '0.001'; oldInput.required = true; oldInput.dataset.previous = '';
      const previousValue = inherited ?? saved.get(month)?.previous ?? exact?.previous ?? (index === 0 && originalStart === month ? original?.previous : undefined);
      const currentValue = saved.get(month)?.current ?? exact?.current ?? (month === editing.month ? original?.current : undefined);
      const defaults = readingDefaults(previousValue, currentValue);
      oldInput.value = defaults.previous;
      oldInput.readOnly = index > 0 || inherited !== undefined; oldLabel.append(oldInput);
      const newLabel = document.createElement('label'); newLabel.textContent = 'Chỉ số mới (m³)';
      const newInput = document.createElement('input'); newInput.type = 'number'; newInput.min = '0'; newInput.max = '1000000000000'; newInput.step = '0.001'; newInput.required = true; newInput.dataset.current = '';
      newInput.value = defaults.current;
      newInput.addEventListener('input', () => { syncMonthlyPrevious(); preview(); }); newLabel.append(newInput);
      card.append(oldLabel, newLabel); monthlyReadings.append(card);
    });
    syncMonthlyPrevious();
  }
  function syncMonthlyPrevious() {
    const cards = [...monthlyReadings.querySelectorAll('.month-reading')];
    cards.slice(1).forEach((card, index) => card.querySelector('[data-previous]').value = cards[index].querySelector('[data-current]').value);
  }
  function currentValues() { return [...monthlyReadings.querySelectorAll('[data-current]')].map(input => input.value); }
  function startingPrevious() { return monthlyReadings.querySelector('[data-previous]')?.value ?? ''; }
  function preview() {
    const previous = startingPrevious(), values = currentValues(), complete = previous !== '' && values.length > 0 && values.every(value => value !== '');
    const monotonic = complete && values.reduce((prior, value) => prior !== false && +value >= prior ? +value : false, +previous) !== false;
    const count = monthsInRange($('period-start').value, $('period-end').value).length;
    $('preview').textContent = monotonic ? `${fmt(+values.at(-1) - +previous)} m³ / ${count} tháng` : '— m³';
  }
  $('close').onclick = () => $('editor').close();
  $('edit-form').onsubmit = async e => {
    e.preventDefault(); if (checkExpiry() || !editing) return;
    const next = JSON.parse(JSON.stringify(state)), { id } = editing, start = $('period-start').value, end = $('period-end').value;
    const selectedMonths = monthsInRange(start, end);
    if ((multiEntry && (selectedMonths.length < 2 || selectedMonths.length > 3)) || (!multiEntry && selectedMonths.length !== 1)) { $('error').textContent = 'Chế độ nhập nhiều tháng chỉ cho phép chọn 2 hoặc 3 tháng.'; return; }
    let entries;
    try { entries = buildMonthlyRecords(start, end, Number(startingPrevious()), currentValues().map(Number), Number($('debt').value), $('debt-note').value.trim()); }
    catch (err) { $('error').textContent = err.message; return; }
    const previousEntries = {};
    for (const entryMonth of Object.keys(entries)) previousEntries[entryMonth] = next.records[entryMonth]?.[id];
    if (editing.originalEnd && selectedMonths.includes(editing.originalEnd)) delete next.records[editing.originalEnd]?.[id];
    for (const [entryMonth, entry] of Object.entries(entries)) {
      const old = previousEntries[entryMonth];
      next.records[entryMonth] ??= {};
      next.records[entryMonth][id] = { ...entry, ...(entryMonth === end ? {} : { debt: old?.debt ?? 0, note: old?.note ?? '' }) };
    }
    try { validateRecords(next.records); } catch (err) { $('error').textContent = err.message + ' Hãy kiểm tra cả chỉ số tháng kế tiếp nếu đang sửa tháng cũ.'; return; }
    if (await persist(next)) { $('editor').close(); render(); toast(Object.keys(entries).length > 1 ? 'Đã lưu chỉ số riêng cho từng tháng.' : 'Đã lưu chỉ số nước.'); }
  };
  $('excel').onclick = () => {
    if (!ready) return;
    const rows = [['Kỳ ghi (từ tháng → đến tháng)', 'Hộ dân', 'Chỉ số cũ (m³)', 'Chỉ số mới (m³)', 'Tiêu thụ (m³)', 'Số tiền đang nợ (đ)', 'Trạng thái', 'Ghi chú nợ']];
    for (const month of Object.keys(state.records).sort()) {
      for (const id of Object.keys(state.records[month]).sort((a, b) => a - b)) {
        const r = state.records[month][id], prev = baseline(state.records, month, id);
        rows.push([periodLabel(r.startMonth ?? month, month), `${householdName(id)} (mã hộ ${String(id).padStart(3, '0')})`, prev, r.current, Math.round((r.current - prev) * 1000) / 1000, r.debt || 0, r.debt > 0 ? 'Đang nợ' : 'Đã ghi chỉ số', r.note || '']);
      }
    }
    if (rows.length === 1) { toast('Chưa có dữ liệu để xuất Excel.'); return; }
    const url = URL.createObjectURL(excelWorkbook(rows)), a = document.createElement('a');
    a.href = url; a.download = 'so-nuoc-tat-ca-thang.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Đã xuất Excel tất cả tháng đã ghi.');
  };
  $('print').onclick = () => {
    if (!ready) return;
    const month = $('month').value;
    if (!monthValid(month)) { toast('Vui lòng chọn tháng hợp lệ trước khi in.'); return; }
    const report = buildPrintReport(state, month), fragment = document.createDocumentFragment();
    if (report.total === 0) { toast(`Tháng ${monthDisplay(month)} chưa có hộ nào đã ghi chỉ số để in.`); return; }
    for (const row of report.rows) {
      const tr = document.createElement('tr');
      append(tr, 'td', row.number); append(tr, 'td', row.id); append(tr, 'td', row.name);
      append(tr, 'td', row.period.split(' → ').map(monthDisplay).join(' → '));
      append(tr, 'td', row.previous === null ? '—' : fmt(row.previous));
      append(tr, 'td', row.current === null ? '—' : fmt(row.current));
      append(tr, 'td', row.consumption === null ? '—' : fmt(row.consumption));
      const debtText = row.debt > 0 ? `${fmt(row.debt)} đ${row.note ? ` · ${row.note}` : ''}` : row.note || '—';
      append(tr, 'td', debtText); append(tr, 'td', row.status);
      fragment.append(tr);
    }
    $('print-rows').replaceChildren(fragment);
    $('print-title').textContent = `BẢNG CHỈ SỐ NƯỚC THÁNG ${monthDisplay(month)}`;
    $('print-period').textContent = `Tháng đối chiếu: ${monthDisplay(month)}`;
    $('print-created').textContent = `In lúc: ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`;
    const summary = [
      ['Số hộ được in', report.total], ['Đã ghi / không nợ', report.paid], ['Đang nợ', report.owing],
      ['Tổng tiêu thụ', `${fmt(report.consumption)} m³`], ['Tổng công nợ', `${fmt(report.debt)} đ`]
    ];
    $('print-summary').replaceChildren(...summary.map(([label, value]) => {
      const item = document.createElement('div'); append(item, 'span', label); append(item, 'strong', value); return item;
    }));
    document.title = `Sổ nước tháng ${monthDisplay(month)}`;
    window.print();
  };
  window.addEventListener('afterprint', () => { document.title = 'Sổ nước • Quản lý nước sinh hoạt'; });
  $('export').onclick = () => {
    if (!ready) return;
    checkExpiry(); const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `so-nuoc-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('import').onclick = () => { if (ready) $('file').click(); };
  $('file').onchange = async e => {
    if (!ready) return;
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error('Tệp sao lưu quá lớn (tối đa 5 MB).');
      const data = normalizeState(JSON.parse(await file.text())); if (data.version !== 1) throw Error('Không đúng định dạng sao lưu Sổ nước.');
      validateHouseholds(data.households); validateRecords(data.records); checkExpiry();
      if (!confirm('Nhập bản sao lưu sẽ thay thế toàn bộ chỉ số hiện tại . Tiếp tục?')) return;
      if (await persist({ ...fresh(), households: data.households, records: data.records })) { render(); toast('Đã khôi phục dữ liệu.'); }
    } catch (err) { toast(err instanceof SyntaxError ? 'Tệp JSON không hợp lệ.' : err.message); } finally { e.target.value = ''; }
  };

}

// An uncompressed ZIP container keeps Excel export available offline.
function excelWorkbook(rows) {
  const enc = new TextEncoder();
  const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const sheet = rows.map(row => '<row>' + row.map(value => typeof value === 'number' ? `<c><v>${value}</v></c>` : `<c t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('') + '</row>').join('');
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sổ nước" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="7" width="20" customWidth="1"/><col min="8" max="8" width="55" customWidth="1"/></cols><sheetData>${sheet}</sheetData></worksheet>`
  };
  const parts = [], central = []; let offset = 0, centralSize = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = enc.encode(path), data = enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + content);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++)crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 33, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    const entry = new Uint8Array(46), c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    parts.push(header, name, data); central.push(entry, name); offset += header.length + name.length + data.length; centralSize += entry.length + name.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length / 2, true); e.setUint16(10, central.length / 2, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
if (typeof module !== 'undefined') module.exports.excelWorkbook = excelWorkbook;
