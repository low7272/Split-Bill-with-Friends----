// 所有金額都以整數「分」儲存，避免浮點數造成分帳誤差。
const STORAGE_KEY = 'friends-split-v1';
let state = { members: [], expenses: [] };
const $ = id => document.getElementById(id);
const money = cents => 'NT$' + (cents / 100).toLocaleString('zh-TW', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const nameOf = id => state.members.find(member => member.id === id)?.name || '未知成員';
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);

// 使用 textContent 放入使用者文字，姓名與支出名稱不會被當作 HTML 執行。
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notify(message) { $('notice').textContent = message; }
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { notify('瀏覽器無法儲存資料。目前仍可使用，但關閉或重新整理後可能遺失紀錄。'); }
}
function validState(data) {
  if (!data || !Array.isArray(data.members) || !Array.isArray(data.expenses)) return false;
  const ids = new Set(data.members.map(m => m?.id));
  return ids.size === data.members.length && data.members.every(m => m && typeof m.id === 'string' && typeof m.name === 'string' && m.name.trim()) &&
    new Set(data.expenses.map(e => e?.id)).size === data.expenses.length && data.expenses.every(e => e && typeof e.id === 'string' && typeof e.name === 'string' && e.name.trim() && Number.isSafeInteger(e.amount) && e.amount > 0 && ids.has(e.payer) && Array.isArray(e.participants) && e.participants.length > 0 && new Set(e.participants).size === e.participants.length && e.participants.every(id => ids.has(id))) && Number.isSafeInteger(data.expenses.reduce((sum, e) => sum + e.amount, 0));
}

function calculate(members, expenses) {
  const balances = new Map(members.map(m => [m.id, { ...m, paid: 0, share: 0, net: 0 }]));
  for (const expense of expenses) {
    balances.get(expense.payer).paid += expense.amount;
    const base = Math.floor(expense.amount / expense.participants.length);
    const remainder = expense.amount % expense.participants.length;
    expense.participants.forEach((id, index) => { balances.get(id).share += base + (index < remainder ? 1 : 0); });
  }
  const rows = [...balances.values()];
  rows.forEach(row => { row.net = row.paid - row.share; });
  const receivers = rows.filter(row => row.net > 0).map(row => ({ id: row.id, remaining: row.net }));
  const senders = rows.filter(row => row.net < 0).map(row => ({ id: row.id, remaining: -row.net }));
  const transfers = [];
  // 每次將最大應收與最大應付配對；減少轉帳，但不保證數學上的全域最少次數。
  while (receivers.length && senders.length) {
    receivers.sort((a, b) => b.remaining - a.remaining);
    senders.sort((a, b) => b.remaining - a.remaining);
    const amount = Math.min(receivers[0].remaining, senders[0].remaining);
    transfers.push({ from: senders[0].id, to: receivers[0].id, amount });
    receivers[0].remaining -= amount;
    senders[0].remaining -= amount;
    if (!receivers[0].remaining) receivers.shift();
    if (!senders[0].remaining) senders.shift();
  }
  return { rows, transfers };
}

function renderMembers() {
  const previousPayer = $('payer').value;
  const checks = [...$('participants').querySelectorAll('input')];
  const previouslySelected = new Set(checks.filter(input => input.checked).map(input => input.value));
  const previouslyPresent = new Set(checks.map(input => input.value));
  $('members').replaceChildren(); $('payer').replaceChildren(); $('participants').replaceChildren();
  for (const member of state.members) {
    const item = el('li', undefined, 'member');
    item.append(el('span', member.name));
    const remove = el('button', '×', 'remove');
    remove.type = 'button'; remove.setAttribute('aria-label', `刪除成員 ${member.name}`);
    remove.onclick = () => {
      if (state.expenses.some(e => e.payer === member.id || e.participants.includes(member.id))) {
        notify(`${member.name} 有相關支出，請先刪除相關支出再移除成員。`); return;
      }
      state.members = state.members.filter(m => m.id !== member.id);
      notify(`已移除 ${member.name}。`); save(); render();
    };
    item.append(remove); $('members').append(item);
    const option = el('option', member.name); option.value = member.id; $('payer').append(option);
    const label = el('label', undefined, 'participant');
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = member.id;
    input.checked = previouslySelected.has(member.id) || !previouslyPresent.has(member.id);
    label.append(input, el('span', member.name)); $('participants').append(label);
  }
  if (state.members.some(m => m.id === previousPayer)) $('payer').value = previousPayer;
  if (!state.members.length) {
    $('members').append(el('li', '先新增成員，開始這次的分帳。', 'hint'));
    $('participants').append(el('p', '新增成員後，就可以選擇分攤對象。', 'hint'));
  }
  $('add-expense').disabled = state.members.length === 0;
  $('member-count').textContent = `${state.members.length} 人`;
}
function render() {
  renderMembers();
  const { rows, transfers } = calculate(state.members, state.expenses);
  $('total').textContent = money(state.expenses.reduce((sum, e) => sum + e.amount, 0));
  $('expense-count').textContent = `${state.expenses.length} 筆`;
  $('settlements').replaceChildren();
  if (!transfers.length) $('settlements').append(el('div', state.expenses.length ? '已經平衡了！不需要互相轉帳。' : '新增支出後，這裡會顯示轉帳建議。', 'empty'));
  for (const transfer of transfers) {
    const item = el('div', undefined, 'transfer');
    item.append(el('span', `${nameOf(transfer.from)} → ${nameOf(transfer.to)}`), el('strong', money(transfer.amount)));
    $('settlements').append(item);
  }
  $('balances').replaceChildren();
  if (!rows.length) $('balances').append(el('div', '還沒有成員，邀請朋友一起加入吧。', 'empty'));
  for (const row of rows) {
    const item = el('div', undefined, 'balance'); const head = el('div', undefined, 'balance-head');
    head.append(el('strong', row.name), el('strong', row.net === 0 ? '已平衡' : `${row.net > 0 ? '應收' : '應付'} ${money(Math.abs(row.net))}`, row.net >= 0 ? 'receive' : 'owe'));
    item.append(head, el('div', `已支付 ${money(row.paid)} · 應負擔 ${money(row.share)}`, 'balance-detail'));
    $('balances').append(item);
  }
  $('expenses').replaceChildren();
  if (!state.expenses.length) $('expenses').append(el('div', '還沒有支出。從第一筆聚餐或旅程花費開始吧！', 'empty'));
  for (const expense of [...state.expenses].reverse()) {
    const item = el('div', undefined, 'expense'); const detail = el('div'); const actions = el('div', undefined, 'expense-actions');
    detail.append(el('strong', expense.name), el('p', `${nameOf(expense.payer)} 先付款`), el('p', `${expense.participants.map(nameOf).join('、')} · ${expense.participants.length} 人分攤`));
    const remove = el('button', '刪除', 'remove'); remove.type = 'button'; remove.setAttribute('aria-label', `刪除支出 ${expense.name}`);
    remove.onclick = () => {
      if (!confirm(`確定刪除「${expense.name}」${money(expense.amount)}？`)) return;
      state.expenses = state.expenses.filter(e => e.id !== expense.id);
      notify(`已刪除「${expense.name}」，結算已更新。`); save(); render();
    };
    actions.append(el('strong', money(expense.amount)), remove); item.append(detail, actions); $('expenses').append(item);
  }
}

$('member-form').addEventListener('submit', event => {
  event.preventDefault(); const name = $('member-name').value.trim();
  if (!name) { notify('請輸入成員姓名。'); return; }
  if (state.members.some(m => m.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { notify('已有同名成員，請加上暱稱以便辨識。'); return; }
  state.members.push({ id: uid(), name }); $('member-form').reset(); notify(`已新增 ${name}。`); save(); render(); $('member-name').focus();
});
$('expense-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('expense-name').value.trim(); const raw = $('amount').value;
  const amount = Math.round(Number(raw) * 100); const payer = $('payer').value;
  const participants = [...$('participants').querySelectorAll('input:checked')].map(input => input.value);
  if (!name) { notify('請輸入支出項目名稱。'); return; }
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999900) { notify('請輸入大於 0 的金額，最多小數點後 2 位，單筆上限 NT$999,999,999。'); return; }
  if (!state.members.some(m => m.id === payer) || !participants.length) { notify('請選擇付款人，以及至少一位分攤成員。'); return; }
  if (!Number.isSafeInteger(state.expenses.reduce((sum, e) => sum + e.amount, amount))) { notify('總金額已超過可精確計算的範圍，無法新增。'); return; }
  state.expenses.push({ id: uid(), name, amount, payer, participants });
  $('expense-name').value = ''; $('amount').value = ''; notify(`已新增「${name}」，分帳結果已更新。`); save(); render(); $('expense-name').focus();
});
$('select-all').onclick = () => { $('participants').querySelectorAll('input').forEach(input => { input.checked = true; }); };
$('select-none').onclick = () => { $('participants').querySelectorAll('input').forEach(input => { input.checked = false; }); };
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) { const parsed = JSON.parse(saved); if (!validState(parsed)) throw new Error('invalid data'); state = parsed; }
} catch { notify('無法讀取已儲存的資料，已開啟空白分帳。這個瀏覽器可能限制本機儲存。'); }
render();
