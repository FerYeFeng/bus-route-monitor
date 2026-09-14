const state = { view: 'sources', filter: 'all', sort: 'desc', query: '', data: null, expanded: new Set() };
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value = '') {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function formatTime(value) {
  if (!value) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(new Date(value));
}

function dayKey(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function recentDay(item) {
  if (!item.publishedAt) return null;
  const today = new Date();
  const todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const age = Math.round((todayKey - dayKey(item.publishedAt)) / 86_400_000);
  if (age === 0) return { age, label: '今天', className: 'today' };
  if (age === 1) return { age, label: '昨天', className: 'yesterday' };
  if (age === 2) return { age, label: '前天', className: 'day-before' };
  if (age >= 3 && age <= 4) return { age, label: `${age} 天前`, className: 'earlier' };
  return null;
}

function statusInfo(item) {
  if (item.status === 'login_required') return ['login_required', '需要登录'];
  if (item.status !== 'ok') return ['error', '抓取异常'];
  if (item.changed) return ['changed', '发现更新'];
  if (item.initial) return ['ok', '完成建档'];
  return ['ok', '运行正常'];
}

function render(data) {
  const report = data.report;
  const results = report?.results || [];
  const failures = results.filter((item) => item.status !== 'ok');
  const changed = results.filter((item) => item.changed);
  $('#total').textContent = report?.total ?? '--';
  $('#updates').textContent = changed.length;
  $('#healthy').textContent = results.length - failures.length;
  $('#failed').textContent = failures.length;
  $('#count-all').textContent = results.length;
  $('#count-changed').textContent = changed.length;
  $('#count-error').textContent = failures.length;
  const recentHistory = (data.history || []).filter(recentDay);
  $('#count-content').textContent = recentHistory.length;
  $('#checked-at').textContent = report ? `最近完成：${formatTime(report.checkedAt)}` : '等待第一次检查';
  $('#interval').textContent = data.intervalMinutes;
  $('#running-bar').hidden = !data.running;
  $('#check').disabled = data.running;
  $('#check').lastChild.textContent = data.running ? '检查中' : '立即检查';
  $('#login').disabled = data.running || data.loginRunning;
  $('#login').lastChild.textContent = data.loginRunning ? '登录窗口已打开' : '微博登录';
  $('#state-dot').className = data.running ? '' : 'ok';
  $('#service-label').textContent = data.running ? '正在检查' : '监控在线';

  const filtered = results.filter((item) => {
    const matchFilter = state.filter === 'all' || (state.filter === 'changed' && item.changed) || (state.filter === 'error' && item.status !== 'ok');
    return matchFilter && item.name.toLowerCase().includes(state.query.toLowerCase());
  });
  $('#empty').hidden = filtered.length > 0;
  $('#source-list').hidden = state.view !== 'sources';
  $('#content-list').hidden = state.view !== 'content';
  $('#sort').hidden = state.view !== 'content';
  $('#source-list').innerHTML = filtered.map((item, index) => {
    const [statusClass, statusText] = statusInfo(item);
    const key = `${item.url}-${index}`;
    const expanded = state.expanded.has(key);
    const hasDetail = item.error || item.added?.length;
    const detail = expanded && hasDetail ? `<div class="detail">${item.error ? `<p>${escapeHtml(item.error)}</p>` : ''}${item.added?.length ? `<ul>${item.added.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}</div>` : '';
    return `<article class="source-row" data-key="${escapeHtml(key)}">
      <div class="source-main"><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a><span>${item.initial ? '首次收录' : '持续监控'}</span></div>
      <span class="status ${statusClass}">${statusText}</span>
      <span class="matches">命中 ${item.matches ?? 0} 条</span>
      <span class="duration">耗时 ${((item.ms || 0) / 1000).toFixed(1)} 秒</span>
      ${hasDetail ? `<button class="expand" type="button" title="${expanded ? '收起详情' : '展开详情'}" aria-label="${expanded ? '收起详情' : '展开详情'}">${expanded ? '−' : '+'}</button>` : '<span></span>'}
      ${detail}
    </article>`;
  }).join('');
  const content = [...recentHistory]
    .filter((item) => `${item.name} ${item.text}`.toLowerCase().includes(state.query.toLowerCase()))
    .sort((a, b) => state.sort === 'desc' ? new Date(b.publishedAt) - new Date(a.publishedAt) : new Date(a.publishedAt) - new Date(b.publishedAt));
  let lastDay = null;
  $('#content-list').innerHTML = content.map((item) => {
    const day = recentDay(item);
    const heading = day.age !== lastDay ? `<div class="day-heading ${day.className}"><strong>${day.label}</strong><span>${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(item.publishedAt))}</span></div>` : '';
    lastDay = day.age;
    return `${heading}<article class="content-item ${day.className}"><div class="content-meta"><time>${formatTime(item.publishedAt)}</time><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a></div><p>${escapeHtml(item.text)}</p></article>`;
  }).join('');
  $('#empty-title').textContent = state.view === 'content' ? '暂时没有新增动态' : '没有符合条件的来源';
  $('#empty-copy').textContent = state.view === 'content' ? '这里只显示发布时间处于近 5 天的线路内容' : '更换筛选条件或搜索词';
  $('#empty').hidden = state.view === 'sources' ? filtered.length > 0 : content.length > 0;
}

async function load() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    render(state.data);
  } catch {
    $('#state-dot').className = 'bad';
    $('#service-label').textContent = '连接中断';
  }
}

$('#check').addEventListener('click', async () => {
  $('#check').disabled = true;
  await fetch('/api/check', { method: 'POST' }).catch(() => {});
  await load();
});
$('#refresh').addEventListener('click', load);
$('#login').addEventListener('click', async () => {
  $('#login').disabled = true;
  await fetch('/api/login', { method: 'POST' }).catch(() => {});
  await load();
});
$('#sort').addEventListener('change', (event) => { state.sort = event.target.value; if (state.data) render(state.data); });
$('#search').addEventListener('input', (event) => { state.query = event.target.value.trim(); if (state.data) render(state.data); });
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
  state.view = tab.dataset.view || (tab.dataset.filter ? 'sources' : state.view);
  if (tab.dataset.filter) state.filter = tab.dataset.filter;
  if (state.data) render(state.data);
}));
$('#source-list').addEventListener('click', (event) => {
  const button = event.target.closest('.expand');
  if (!button) return;
  const key = button.closest('.source-row').dataset.key;
  state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
  render(state.data);
});

load();
setInterval(load, 5000);
