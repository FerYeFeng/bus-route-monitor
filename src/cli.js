import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { diffLines, digest, isWeibo, loginRequired, readJson, relevantEntries, writeJson } from './monitor.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROFILE = path.join(ROOT, 'work', 'browser-profile');
const STATE_FILE = path.join(ROOT, 'work', 'state', 'snapshots.json');
const REPORT_JSON = path.join(ROOT, 'outputs', 'latest.json');
const REPORT_MD = path.join(ROOT, 'outputs', 'latest.md');
const HISTORY_FILE = path.join(ROOT, 'work', 'state', 'history.json');
const DEFAULT_INTERVAL = 3;

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function launch(headless) {
  return chromium.launchPersistentContext(PROFILE, {
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless,
    locale: 'zh-CN',
    viewport: { width: 1365, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'
  });
}

async function login() {
  const context = await launch(false);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://weibo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const timeout = Number(arg('--timeout', '0'));
  if (timeout > 0) {
    console.log(`请在打开的窗口完成微博登录。窗口将在 ${timeout} 秒后自动关闭。`);
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, timeout * 1000)),
      new Promise((resolve) => context.on('close', resolve))
    ]);
  } else {
    console.log('请在打开的窗口完成微博登录。登录成功并看到首页后，回到这里按 Enter。');
    await new Promise((resolve) => process.stdin.once('data', resolve));
  }
  await context.close();
  console.log('登录状态已保存在 work/browser-profile。');
}

async function loadText(page, source) {
  const response = await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!isWeibo(source.url)) await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  else await page.waitForTimeout(3500);
  const title = await page.title();
  const text = await page.locator('body').innerText({ timeout: 15000 });
  if (loginRequired(page.url(), text)) {
    const error = new Error('微博需要登录，请运行 npm run login');
    error.code = 'LOGIN_REQUIRED';
    throw error;
  }
  if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
  const entries = relevantEntries(text);
  return { title, finalUrl: page.url(), lines: entries.map((item) => item.text), entries };
}

async function check() {
  const sources = (await readJson(path.join(ROOT, 'sources.json'), [])).filter((item) => item.enabled !== false && item.url).map((item, sourceIndex) => ({ ...item, sourceIndex }));
  const prior = await readJson(STATE_FILE, {});
  const next = { ...prior };
  const results = [];
  const context = await launch(true);
  const concurrency = Math.max(1, Math.min(8, Number(arg('--concurrency', '4')) || 4));
  let cursor = 0;

  async function worker() {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      const started = Date.now();
      const page = await context.newPage();
      try {
        const data = await loadText(page, source);
        const hasPrevious = Object.hasOwn(prior, source.url);
        const previous = prior[source.url]?.lines ?? [];
        const added = hasPrevious ? diffLines(previous, data.lines) : [];
        const changed = hasPrevious && digest(previous) !== digest(data.lines);
        next[source.url] = { name: source.name, checkedAt: new Date().toISOString(), ...data };
        results.push({ sourceIndex: source.sourceIndex, name: source.name, url: source.url, status: 'ok', initial: !hasPrevious, changed, added, matches: data.lines.length, ms: Date.now() - started });
        console.log(`[${changed ? '更新' : hasPrevious ? '无变化' : '建档'}] ${source.name} (${data.lines.length} 条相关文本)`);
      } catch (error) {
        results.push({ sourceIndex: source.sourceIndex, name: source.name, url: source.url, status: error.code === 'LOGIN_REQUIRED' ? 'login_required' : 'error', error: error.message, ms: Date.now() - started });
        console.error(`[失败] ${source.name}: ${error.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  try { await Promise.all(Array.from({ length: concurrency }, worker)); } finally { await context.close(); }
  results.sort((a, b) => a.sourceIndex - b.sourceIndex);
  await writeJson(STATE_FILE, next);
  const report = { checkedAt: new Date().toISOString(), total: sources.length, updates: results.filter((r) => r.changed).length, results };
  await writeJson(REPORT_JSON, report);
  const changed = results.filter((r) => r.changed && r.added.length);
  const history = await readJson(HISTORY_FILE, []);
  const detectedAt = report.checkedAt;
  const currentEntries = new Map(Object.values(next).flatMap((source) => (source.entries || []).map((entry) => [`${source.name}\n${entry.text}`, entry.publishedAt])));
  const additions = changed.flatMap((item) => item.added.map((text) => ({
    detectedAt,
    publishedAt: next[item.url]?.entries?.find((entry) => entry.text === text)?.publishedAt || null,
    sourceIndex: item.sourceIndex,
    name: item.name,
    url: item.url,
    text
  })));
  const enrichedHistory = history.map((item) => {
    const key = `${item.name}\n${item.text}`;
    return { ...item, publishedAt: currentEntries.has(key) ? currentEntries.get(key) : (item.publishedAt || null) };
  });
  await writeJson(HISTORY_FILE, [...additions, ...enrichedHistory].slice(0, 2000));
  const failures = results.filter((r) => r.status !== 'ok');
  const md = [`# 公交线路更新监测`, '', `检查时间：${new Date().toLocaleString('zh-CN')}`, `来源：${sources.length}；更新：${changed.length}；失败：${failures.length}`, ''];
  if (!changed.length) md.push('## 本次未发现新增的公交相关内容', '');
  for (const item of changed) md.push(`## [${item.name}](${item.url})`, '', ...item.added.map((line) => `- ${line.replace(/\n/g, ' ')}`), '');
  if (failures.length) md.push('## 抓取失败', '', ...failures.map((item) => `- ${item.name}：${item.error}`), '');
  await fs.mkdir(path.dirname(REPORT_MD), { recursive: true });
  await fs.writeFile(REPORT_MD, `${md.join('\n')}\n`, 'utf8');
  console.log(`报告：${REPORT_MD}`);
  return report;
}

async function watch() {
  const minutes = Math.max(1, Number(arg('--minutes', String(DEFAULT_INTERVAL))) || DEFAULT_INTERVAL);
  console.log(`每 ${minutes} 分钟检查一次，按 Ctrl+C 停止。`);
  while (true) {
    await check().catch((error) => console.error(error));
    await new Promise((resolve) => setTimeout(resolve, minutes * 60_000));
  }
}

const command = process.argv[2] ?? 'check';
if (command === 'login') await login();
else if (command === 'check') await check();
else if (command === 'watch') await watch();
else {
  console.error('用法：node src/cli.js <login|check|watch> [--minutes 30] [--concurrency 4]');
  process.exitCode = 2;
}
