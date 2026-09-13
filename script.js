// 金額以整數「0.1 元」儲存；每筆支出另外記錄每位分攤人的結清金額。
const STORAGE_KEY = 'friends-split-v2';
const LEGACY_KEY = 'friends-split-v1';
const CURRENCIES = { TWD: { label: 'TWD 新台幣', symbol: 'NT$' }, AUD: { label: 'AUD 澳幣', symbol: 'A$' }, USD: { label: 'USD 美金', symbol: '$' } };
const $ = id => document.getElementById(id);
let data;
let editingExpenseId = null;
let view = { filter: 'all', sort: 'new' };
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const currencyOf = book => CURRENCIES[book?.currency] ? book.currency : 'TWD';
const money = (tenths, currency = currencyOf(activeBook())) => `${CURRENCIES[currency].symbol}${(tenths / 10).toLocaleString('zh-TW', { minimumFractionDigits: tenths % 10 ? 1 : 0, maximumFractionDigits: 1 })}`;
const dateText = date => { const [year, month, day] = date.split('-'); return `${year}/${Number(month)}/${Number(day)}`; };
const shortDate = date => { const [, month, day] = date.split('-'); return `${Number(month)}/${Number(day)}`; };
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function notify(message) { $('notice').textContent = message; }
function newBook(name = '我的新帳本', currency = 'TWD') { return { id: uid(), name, currency, members: [], expenses: [], settlements: [], createdAt: new Date().toISOString() }; }
function activeBook() { return data.books.find(book => book.id === data.activeBookId) || data.books[0]; }
function nameOf(id, book = activeBook()) { return book.members.find(member => member.id === id)?.name || '未知成員'; }
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { notify('瀏覽器無法儲存資料；重新整理後可能遺失本次修改。'); } }

function shareOf(expense, memberId) { const index = expense.participants.indexOf(memberId); if (index < 0) return 0; const base = Math.floor(expense.amount / expense.participants.length); return base + (index < expense.amount % expense.participants.length ? 1 : 0); }
function initialSettledBy() { return {}; }
function isValidBook(book, needsCurrency, needsParticipantTracking = false) {
  if (!book || typeof book.id !== 'string' || typeof book.name !== 'string' || !Array.isArray(book.members) || !Array.isArray(book.expenses) || !Array.isArray(book.settlements) || (needsCurrency && !CURRENCIES[book.currency])) return false;
  const ids = new Set(book.members.map(member => member?.id));
  return ids.size === book.members.length && book.members.every(member => member && typeof member.id === 'string' && typeof member.name === 'string' && member.name.trim()) &&
    new Set(book.expenses.map(expense => expense?.id)).size === book.expenses.length && book.expenses.every(expense => expense && typeof expense.id === 'string' && typeof expense.name === 'string' && expense.name.trim() && Number.isSafeInteger(expense.amount) && expense.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(expense.date) && ids.has(expense.payer) && Array.isArray(expense.participants) && expense.participants.length && new Set(expense.participants).size === expense.participants.length && expense.participants.every(id => ids.has(id)) && (!needsParticipantTracking || expense.settledBy && typeof expense.settledBy === 'object' && !Array.isArray(expense.settledBy) && Object.entries(expense.settledBy).every(([id, amount]) => expense.participants.includes(id) && Number.isSafeInteger(amount) && amount >= 0 && amount <= shareOf(expense, id)))) &&
    new Set(book.settlements.map(item => item?.id)).size === book.settlements.length && book.settlements.every(item => item && typeof item.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isSafeInteger(item.amount) && item.amount > 0 && ids.has(item.from) && ids.has(item.to) && item.from !== item.to && item.status === 'settled' && (!needsParticipantTracking || Array.isArray(item.allocations)));
}
function isValidData(candidate, version) { return candidate && candidate.version === version && Array.isArray(candidate.books) && candidate.books.length && candidate.books.every(book => isValidBook(book, version >= 3, version >= 4)) && candidate.books.some(book => book.id === candidate.activeBookId); }
function upgradeV2(candidate) { return { version: 3, activeBookId: candidate.activeBookId, books: candidate.books.map(book => ({ ...book, currency: currencyOf(book) })) }; }
function expenseOrder(book) { return [...book.expenses].sort((a, b) => `${a.date}|${a.createdAt || ''}`.localeCompare(`${b.date}|${b.createdAt || ''}`)); }
function allocateSettlement(book, fromId, toId, amount) {
  let remaining = amount; const allocations = [];
  for (const expense of expenseOrder(book)) {
    if (expense.payer !== toId || !expense.participants.includes(fromId) || fromId === toId) continue;
    const outstanding = shareOf(expense, fromId) - (expense.settledBy[fromId] || 0); if (outstanding <= 0) continue;
    const applied = Math.min(remaining, outstanding); expense.settledBy[fromId] = (expense.settledBy[fromId] || 0) + applied; allocations.push({ expenseId: expense.id, from: fromId, to: toId, amount: applied }); remaining -= applied; if (!remaining) break;
  }
  return allocations;
}
function rebuildSettledDebts(book) { book.expenses.forEach(expense => { expense.settledBy = {}; }); for (const record of [...book.settlements].sort((a, b) => `${a.date}|${a.createdAt || ''}`.localeCompare(`${b.date}|${b.createdAt || ''}`))) record.allocations = allocateSettlement(book, record.from, record.to, record.amount); }
function upgradeV3(candidate) {
  const upgraded = { version: 4, activeBookId: candidate.activeBookId, books: candidate.books.map(book => ({ ...book, currency: currencyOf(book), expenses: book.expenses.map(expense => ({ ...expense, settledBy: initialSettledBy(expense) })), settlements: book.settlements.map(record => ({ ...record, allocations: [] })) })) };
  for (const book of upgraded.books) rebuildSettledDebts(book);
  return upgraded;
}
function upgradeV4(candidate) { const upgraded = { version: 5, activeBookId: candidate.activeBookId, books: candidate.books.map(book => ({ ...book, expenses: book.expenses.map(expense => ({ ...expense, settledBy: {} })), settlements: book.settlements.map(record => ({ ...record, allocations: [] })) })) }; upgraded.books.forEach(rebuildSettledDebts); return upgraded; }
function migrateLegacy(legacy) {
  // v1 的 amount 是分（0.01 元）；升級至 v3 時保留全部資料，舊金額四捨五入至 0.1 元。
  if (!legacy || !Array.isArray(legacy.members) || !Array.isArray(legacy.expenses)) return null;
  const book = newBook('我的新帳本', 'TWD');
  book.members = legacy.members.filter(member => member && typeof member.id === 'string' && typeof member.name === 'string' && member.name.trim()).map(member => ({ id: member.id, name: member.name.trim() }));
  const ids = new Set(book.members.map(member => member.id));
  book.expenses = legacy.expenses.filter(expense => expense && typeof expense.id === 'string' && typeof expense.name === 'string' && Number.isSafeInteger(expense.amount) && expense.amount > 0 && ids.has(expense.payer) && Array.isArray(expense.participants) && expense.participants.length && expense.participants.every(id => ids.has(id))).map(expense => ({ id: expense.id, name: expense.name.trim(), amount: Math.round(expense.amount / 10), payer: expense.payer, participants: [...new Set(expense.participants)], date: today(), createdAt: new Date().toISOString() }));
  return { version: 3, activeBookId: book.id, books: [book] };
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (raw) { const saved = JSON.parse(raw); if (isValidData(saved, 5)) return saved; if (isValidData(saved, 4)) { const upgraded = upgradeV4(saved); localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded)); notify('已保留既有資料，並依實際付款人與收款人重建結清狀態。'); return upgraded; } if (isValidData(saved, 3)) { const upgraded = upgradeV4(upgradeV3(saved)); localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded)); notify('已保留既有帳本資料，並升級為實際債務結清狀態。'); return upgraded; } if (isValidData(saved, 2)) { const upgraded = upgradeV4(upgradeV3(upgradeV2(saved))); localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded)); notify('已保留既有帳本資料，並升級結清狀態；幣別預設為 TWD。'); return upgraded; } }
  } catch { /* Try v1 next. */ }
  try { const old = localStorage.getItem(LEGACY_KEY); const migrated = old ? migrateLegacy(JSON.parse(old)) : null; if (migrated) { const upgraded = upgradeV4(upgradeV3(migrated)); localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded)); notify('已保留舊版資料並升級；舊金額四捨五入至 0.1 元，幣別預設為 TWD。'); return upgraded; } } catch { notify('無法讀取已儲存資料，已開啟空白帳本。'); }
  const book = newBook(); return { version: 5, activeBookId: book.id, books: [book] };
}

function calculate(book) {
  const rows = book.members.map(member => ({ ...member, paid: 0, share: 0, net: 0 })); const balances = new Map(rows.map(row => [row.id, row]));
  for (const expense of book.expenses) {
    balances.get(expense.payer).paid += expense.amount;
    const base = Math.floor(expense.amount / expense.participants.length); const remainder = expense.amount % expense.participants.length;
    expense.participants.forEach((id, index) => { balances.get(id).share += base + (index < remainder ? 1 : 0); });
  }
  const grouped = new Map();
  for (const expense of book.expenses) for (const from of expense.participants) {
    if (from === expense.payer) continue; const remaining = shareOf(expense, from) - (expense.settledBy?.[from] || 0); if (remaining <= 0) continue;
    const key = `${from}|${expense.payer}`; grouped.set(key, (grouped.get(key) || 0) + remaining); balances.get(from).net -= remaining; balances.get(expense.payer).net += remaining;
  }
  const transfers = [...grouped.entries()].map(([key, amount]) => { const [from, to] = key.split('|'); return { from, to, amount }; }).sort((a, b) => b.amount - a.amount);
  return { rows, transfers };
}
function participantIsSettled(expense, memberId) { return memberId !== expense.payer && (expense.settledBy?.[memberId] || 0) >= shareOf(expense, memberId); }
function debtorsOf(expense) { return expense.participants.filter(id => id !== expense.payer && shareOf(expense, id) > 0); }
function expenseStates(book) { return new Map(book.expenses.map(expense => [expense.id, debtorsOf(expense).every(id => participantIsSettled(expense, id)) ? 'settled' : 'open'])); }
function participantSummary(expense, book) { const debtors = debtorsOf(expense); return debtors.length ? debtors.map(id => `${nameOf(id, book)}${participantIsSettled(expense, id) ? ' ✓ 已結清' : ' 待結清'}`).join('、') : '無需轉帳'; }
function sortedExpenses(book, direction = view.sort) { return [...book.expenses].sort((a, b) => { const newest = `${b.date}|${b.createdAt || ''}`.localeCompare(`${a.date}|${a.createdAt || ''}`); return direction === 'new' ? newest : -newest; }); }

function renderBookControls() {
  const book = activeBook(); const currency = currencyOf(book); $('book-heading').textContent = book.name; $('currency-tag').textContent = currency; $('amount-label').textContent = `金額（${CURRENCIES[currency].symbol}）`; $('book-select').replaceChildren();
  for (const item of data.books) { const option = el('option', `${item.name} · ${currencyOf(item)}`); option.value = item.id; $('book-select').append(option); } $('book-select').value = book.id;
}
function renderMembers() {
  const book = activeBook(); const previousPayer = $('payer').value; const oldInputs = [...$('participants').querySelectorAll('input')]; const selected = new Set(oldInputs.filter(input => input.checked).map(input => input.value)); const present = new Set(oldInputs.map(input => input.value));
  $('members').replaceChildren(); $('payer').replaceChildren(); $('participants').replaceChildren();
  for (const member of book.members) {
    const item = el('li', undefined, 'member'); item.append(el('span', member.name)); const remove = el('button', '×', 'remove'); remove.type = 'button'; remove.setAttribute('aria-label', `移除 ${member.name}`);
    remove.onclick = () => { if (book.expenses.some(expense => expense.payer === member.id || expense.participants.includes(member.id)) || book.settlements.some(record => record.from === member.id || record.to === member.id)) return notify(`${member.name} 有既有紀錄，不能移除。`); book.members = book.members.filter(item => item.id !== member.id); save(); notify(`已移除 ${member.name}。`); render(); };
    item.append(remove); $('members').append(item); const option = el('option', member.name); option.value = member.id; $('payer').append(option);
    const label = el('label', undefined, 'participant'); const check = document.createElement('input'); check.type = 'checkbox'; check.value = member.id; check.checked = selected.has(member.id) || !present.has(member.id); label.append(check, el('span', member.name)); $('participants').append(label);
  }
  if (book.members.some(member => member.id === previousPayer)) $('payer').value = previousPayer;
  if (!book.members.length) { $('members').append(el('li', '先新增成員，再記錄支出。', 'hint')); $('participants').append(el('p', '新增成員後可選擇分攤對象。', 'hint')); }
  $('add-expense').disabled = !book.members.length; $('member-count').textContent = `${book.members.length} 人`;
}
function renderSettlements(result) {
  const book = activeBook(); const currency = currencyOf(book); $('settlement-list').replaceChildren();
  if (!result.transfers.length) $('settlement-list').append(el('div', book.expenses.length ? '目前帳本已全部結清。' : '新增支出後，這裡會出現結算建議。', 'empty'));
  for (const transfer of result.transfers) { const item = el('div', undefined, 'transfer'); const text = el('div'); text.append(el('div', `${nameOf(transfer.from, book)} → ${nameOf(transfer.to, book)}`, 'transfer-name'), el('div', money(transfer.amount, currency), 'transfer-detail')); const button = el('button', '結清', 'settle-button'); button.type = 'button'; button.onclick = () => settleTransfer(transfer); item.append(text, button); $('settlement-list').append(item); }
  $('balance-list').replaceChildren(); if (!result.rows.length) $('balance-list').append(el('div', '尚未新增成員。', 'empty'));
  for (const row of result.rows) { const item = el('div', undefined, 'balance'); const head = el('div', undefined, 'balance-head'); const status = row.net === 0 ? '已平衡' : `${row.net > 0 ? '應收' : '應付'} ${money(Math.abs(row.net), currency)}`; head.append(el('span', row.name, 'balance-name'), el('span', status, `balance-status ${row.net > 0 ? 'receive' : row.net < 0 ? 'owe' : ''}`)); item.append(head, el('div', `已支付 ${money(row.paid, currency)} · 應負擔 ${money(row.share, currency)}`, 'balance-detail')); $('balance-list').append(item); }
}
function renderExpenses() {
  const book = activeBook(); const currency = currencyOf(book); const states = expenseStates(book); let expenses = sortedExpenses(book);
  if (view.filter !== 'all') expenses = expenses.filter(expense => states.get(expense.id) === view.filter);
  $('expense-count').textContent = `${book.expenses.length} 筆`; $('expense-list').replaceChildren(); if (!expenses.length) $('expense-list').append(el('div', view.filter === 'all' ? '還沒有支出紀錄。' : '沒有符合這個篩選條件的支出。', 'empty'));
  for (const expense of expenses) {
    const state = states.get(expense.id); const item = el('article', undefined, 'expense'); const main = el('div', undefined, 'expense-main'); const side = el('div', undefined, 'expense-side');
    main.append(el('div', expense.name, 'expense-name'), el('div', `${dateText(expense.date)}　${nameOf(expense.payer, book)}付款 ｜ 分攤：${participantSummary(expense, book)}`, 'expense-meta'));
    side.append(el('div', money(expense.amount, currency), 'expense-amount'), el('span', state === 'settled' ? '已結清' : '未結清', `status ${state}`));
    const edit = el('button', '編輯', 'secondary delete-expense'); edit.type = 'button'; edit.onclick = () => startEditing(expense.id);
    const remove = el('button', '刪除', 'remove delete-expense'); remove.type = 'button'; remove.onclick = () => deleteExpense(expense.id);
    side.append(edit, remove); item.append(main, side); $('expense-list').append(item);
  }
  $('settlement-history').replaceChildren(); const records = [...book.settlements].sort((a, b) => `${b.date}|${b.createdAt || ''}`.localeCompare(`${a.date}|${a.createdAt || ''}`)); if (!records.length) $('settlement-history').append(el('div', '尚無結清紀錄。', 'empty'));
  for (const record of records) { const item = el('div', undefined, 'history-item'); const main = el('div'); main.append(el('strong', `${nameOf(record.from, book)} → ${nameOf(record.to, book)}`), el('div', `${dateText(record.date)} · 已結清`, 'history-date')); item.append(main, el('strong', money(record.amount, currency))); $('settlement-history').append(item); }
}
function render() { renderBookControls(); renderMembers(); const book = activeBook(); const result = calculate(book); const currency = currencyOf(book); $('total').textContent = money(book.expenses.reduce((sum, expense) => sum + expense.amount, 0), currency); $('open-total').textContent = money(result.rows.filter(row => row.net < 0).reduce((sum, row) => sum - row.net, 0), currency); renderSettlements(result); renderExpenses(); }
function settleTransfer(transfer) { const book = activeBook(); const currency = currencyOf(book); const from = nameOf(transfer.from, book); const to = nameOf(transfer.to, book); if (!confirm(`確認 ${from} 已轉帳 ${money(transfer.amount, currency)} 給 ${to}？\n確認後會新增一筆已結清紀錄。`)) return; const allocations = allocateSettlement(book, transfer.from, transfer.to, transfer.amount); book.settlements.push({ id: uid(), date: today(), from: transfer.from, to: transfer.to, amount: transfer.amount, allocations, status: 'settled', createdAt: new Date().toISOString() }); save(); notify(`已記錄：${from} → ${to} ${money(transfer.amount, currency)}。`); render(); }
function hasRelatedSettlement(book, expenseId) { return book.settlements.some(record => record.allocations?.some(allocation => allocation.expenseId === expenseId)); }
function startEditing(expenseId) {
  const expense = activeBook().expenses.find(item => item.id === expenseId); if (!expense) return; editingExpenseId = expenseId; $('expense-mode').textContent = '編輯支出'; $('add-expense-title').textContent = '修改這筆支出'; $('add-expense').textContent = '儲存修改'; $('cancel-edit').hidden = false; $('expense-name').value = expense.name; $('expense-date').value = expense.date; $('amount').value = expense.amount / 10; $('payer').value = expense.payer; $('participants').querySelectorAll('input').forEach(input => { input.checked = expense.participants.includes(input.value); }); $('expense-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function cancelEditing() { editingExpenseId = null; $('expense-form').reset(); $('expense-date').value = today(); $('expense-mode').textContent = '新增支出'; $('add-expense-title').textContent = '這次花了什麼？'; $('add-expense').textContent = '新增這筆支出'; $('cancel-edit').hidden = true; $('participants').querySelectorAll('input').forEach(input => { input.checked = true; }); }
function deleteExpense(expenseId) {
  const book = activeBook(); const expense = book.expenses.find(item => item.id === expenseId); if (!expense) return; const related = hasRelatedSettlement(book, expenseId); const currency = currencyOf(book);
  const message = related ? `這筆支出已有結清紀錄。刪除後，既有轉帳紀錄會保留，但會重新套用到仍有效的債務。\n\n確定要刪除「${expense.name} ${money(expense.amount, currency)}」嗎？` : `確定要刪除「${expense.name} ${money(expense.amount, currency)}」嗎？`;
  if (!confirm(message)) return; book.expenses = book.expenses.filter(item => item.id !== expenseId); rebuildSettledDebts(book); if (editingExpenseId === expenseId) cancelEditing(); save(); notify(`已刪除「${expense.name}」，餘額與結算已重新計算。`); render();
}
function lineText() {
  const book = activeBook(); const currency = currencyOf(book); const result = calculate(book); const states = expenseStates(book); const total = book.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const balances = result.rows.map(row => `${row.name}　${row.net === 0 ? '已平衡' : row.net > 0 ? `應收 ${money(row.net, currency)}` : `應付 ${money(-row.net, currency)}`}`); const transfers = result.transfers.length ? result.transfers.map(item => `${nameOf(item.from, book)} → ${nameOf(item.to, book)}　${money(item.amount, currency)}`) : ['目前已全部結清，無需轉帳。'];
  const settled = book.settlements.length ? [...book.settlements].sort((a, b) => `${a.date}|${a.createdAt || ''}`.localeCompare(`${b.date}|${b.createdAt || ''}`)).map(record => `✓ ${nameOf(record.from, book)} → ${nameOf(record.to, book)}　${money(record.amount, currency)}`) : ['尚無結清紀錄。'];
  const details = sortedExpenses(book, 'old').filter(expense => states.get(expense.id) === 'open').map(expense => `${shortDate(expense.date)}｜${expense.name}｜${money(expense.amount, currency)}\n${nameOf(expense.payer, book)}付款｜${participantSummary(expense, book)}`);
  return `【${book.name}｜結算】\n\n💰 總支出：${money(total, currency)}\n\n【目前餘額】\n${balances.join('\n')}\n\n【待轉帳】\n${transfers.join('\n')}\n\n【已結清】\n${settled.join('\n')}\n\n【未結清支出明細】\n\n${details.length ? details.join('\n\n') : '目前沒有未結清項目。'}\n\n──────────\n尚未結清金額請依系統實際計算結果顯示`;
}
async function copyLine() { const text = lineText(); try { await navigator.clipboard.writeText(text); notify('LINE 結算文字已複製，可直接貼到群組。'); } catch { const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); const copied = document.execCommand('copy'); area.remove(); notify(copied ? 'LINE 結算文字已複製，可直接貼到群組。' : '無法自動複製，請確認瀏覽器是否允許剪貼簿存取。'); } }

$('member-form').addEventListener('submit', event => { event.preventDefault(); const name = $('member-name').value.trim(); const book = activeBook(); if (!name) return; if (book.members.some(member => member.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return notify('已有同名成員，請加上暱稱以便辨識。'); book.members.push({ id: uid(), name }); $('member-form').reset(); save(); notify(`已新增 ${name}。`); render(); $('member-name').focus(); });
$('expense-form').addEventListener('submit', event => {
  event.preventDefault(); const book = activeBook(); const name = $('expense-name').value.trim(); const raw = $('amount').value; const amount = Number(raw) * 10; const payer = $('payer').value; const participants = [...$('participants').querySelectorAll('input:checked')].map(input => input.value); const date = $('expense-date').value || today();
  if (!name) return notify('請輸入支出項目。'); if (!/^\d+$/.test(raw) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 9999999990) return notify('支出金額必須是大於 0 的整數，不能輸入小數點。'); if (!book.members.some(member => member.id === payer) || !participants.length) return notify('請選擇付款人與至少一位分攤成員。');
  if (editingExpenseId) {
    const expense = book.expenses.find(item => item.id === editingExpenseId); if (!expense) { cancelEditing(); return notify('找不到要修改的支出，請重新操作。'); }
    const structureChanged = expense.amount !== amount || expense.payer !== payer || [...expense.participants].sort().join('|') !== [...participants].sort().join('|');
    if (structureChanged && hasRelatedSettlement(book, expense.id) && !confirm('這筆支出已有結清紀錄，修改金額、付款人或分攤成員可能影響既有結算。是否繼續？\n\n繼續後會保留轉帳歷史，並依修改後的實際債務重新套用結清款項。')) return;
    Object.assign(expense, { name, amount, payer, participants, date }); if (structureChanged) rebuildSettledDebts(book); cancelEditing(); save(); notify(`已更新「${name}」，餘額與結算已重新計算。`); render(); return;
  }
  const expense = { id: uid(), name, amount, payer, participants, date, createdAt: new Date().toISOString(), settledBy: initialSettledBy() }; book.expenses.push(expense); cancelEditing(); save(); notify(`已新增「${name}」。`); render(); $('expense-name').focus();
});
$('select-all').onclick = () => $('participants').querySelectorAll('input').forEach(input => { input.checked = true; });
$('select-none').onclick = () => $('participants').querySelectorAll('input').forEach(input => { input.checked = false; });
$('cancel-edit').onclick = () => { cancelEditing(); notify('已取消編輯。'); };
$('book-select').onchange = event => { cancelEditing(); data.activeBookId = event.target.value; save(); notify(`已切換到「${activeBook().name}」。`); render(); };
$('new-book').onclick = () => { const name = prompt('新帳本名稱，例如：2026 澳洲旅行'); if (name === null) return; if (!name.trim()) return notify('帳本名稱不能空白。'); const currency = $('new-book-currency').value; const book = newBook(name.trim(), currency); data.books.push(book); data.activeBookId = book.id; save(); notify(`已建立「${book.name}」（${currency}）。`); render(); };
$('rename-book').onclick = () => { const book = activeBook(); const name = prompt('帳本名稱', book.name); if (name === null) return; if (!name.trim()) return notify('帳本名稱不能空白。'); book.name = name.trim(); save(); notify('帳本名稱已更新。'); render(); };
document.querySelectorAll('.filter').forEach(button => { button.onclick = () => { view.filter = button.dataset.filter; document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button)); renderExpenses(); }; });
$('expense-sort').onchange = event => { view.sort = event.target.value; renderExpenses(); };
$('copy-line').onclick = copyLine;
data = load(); $('expense-date').value = today(); render();
