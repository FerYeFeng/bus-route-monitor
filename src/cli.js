import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { candidateArticleLinks, containsMessageTime, diffLines, firstPublishedTime, isWeibo, loginRequired, mergeEntries, messageEntry, readJson, relevantEntriesFromBlocks, withinLookback, writeJson } from './monitor.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROFILE = path.join(ROOT, 'work', 'browser-profile');
const STATE_FILE = path.join(ROOT, 'work', 'state', 'snapshots.json');
const REPORT_JSON = path.join(ROOT, 'outputs', 'latest.json');
const REPORT_MD = path.join(ROOT, 'outputs', 'latest.md');
const HISTORY_FILE = path.join(ROOT, 'work', 'state', 'history.json');
const DEFAULT_INTERVAL = 10;
const DEFAULT_LOOKBACK_DAYS = 5;

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

async function loadWeiboWindow(page, days) {
  const cutoff = Date.now() - days * 86_400_000;
  const allPosts = page.getByText('全部微博', { exact: true }).first();
  if (await allPosts.count()) {
    await allPosts.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  let stablePasses = 0;
  let previousSignature = '';
  const collected = new Map();
  for (let pass = 0; pass < 18; pass += 1) {
    const blocks = await extractWeiboBlocks(page);
    for (const block of blocks) collected.set(block.id || block.text, block);
    const currentTimes = blocks
      .map((block) => firstPublishedTime(block.text.split(/\n+/), new Date()))
      .filter(Boolean)
      .map((value) => new Date(value).getTime());
    const oldMessages = currentTimes.filter((value) => value <= cutoff).length;
    if (oldMessages >= 2) break;
    const signature = blocks.map((block) => block.id || block.text.slice(0, 120)).join('|');
    stablePasses = signature === previousSignature ? stablePasses + 1 : 0;
    if (stablePasses >= 4) break;
    previousSignature = signature;
    await page.mouse.wheel(0, Math.max(500, Math.floor((await page.evaluate(() => window.innerHeight)) * 0.85)));
    await page.waitForTimeout(900);
  }
  return [...collected.values()];
}

async function extractWeiboBlocks(page) {
  return page.locator('article, [role="article"], [class*="Feed_wrap"], [class*="card-wrap"]').evaluateAll((nodes) => nodes.map((node) => {
    const hasMessageTime = (value) => /20\d{2}|\d{1,2}\s*月\s*\d{1,2}\s*日|今天|昨天|前天|\d{1,3}\s*小时前|\d{1,3}\s*分钟前|刚刚/u.test(String(value || ''));
    const timeValues = [...node.querySelectorAll('time, [datetime], [title]')]
      .flatMap((element) => [element.getAttribute('datetime'), element.getAttribute('title')])
      .filter((value) => value && hasMessageTime(value));
    const statusLink = [...node.querySelectorAll('a[href]')].map((anchor) => anchor.href).find((href) => /weibo\.com\/\d+\/[A-Za-z0-9]+/.test(href));
    return {
      id: statusLink || null,
      url: statusLink || null,
      text: `${timeValues.join('\n')}\n${node.querySelector('.wbpro-feed-content')?.innerText || node.innerText || node.textContent || ''}`
    };
  }).filter((block) => block.id || block.text.trim())).catch(() => []);
}

async function extractPagePublishedAt(page, now) {
  const metadata = await page.locator([
    'meta[property="article:published_time"]',
    'meta[name="publishdate" i]',
    'meta[name="PubDate" i]',
    'meta[name="publish-time" i]',
    'meta[name="date" i]'
  ].join(',')).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content'))).catch(() => []);
  const visible = await page.locator('time, .publish-time, .pub-time, .article-time, .news-time, .date, .time').allInnerTexts().catch(() => []);
  const dateTimes = await page.locator('time[datetime]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime'))).catch(() => []);
  const body = await page.locator('body').innerText().catch(() => '');
  return firstPublishedTime([...metadata, ...dateTimes, ...visible, body], now);
}

async function loadText(page, source, lookbackDays) {
  const response = await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const weibo = isWeibo(source.url);
  let weiboBlocks = [];
  if (!weibo) await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  else {
    await page.waitForTimeout(2500);
    weiboBlocks = await loadWeiboWindow(page, lookbackDays);
  }
  const title = await page.title();
  const text = await page.locator('body').innerText({ timeout: 15000 });
  if (loginRequired(page.url(), text)) {
    const error = new Error('微博需要登录，请运行 npm run login');
    error.code = 'LOGIN_REQUIRED';
    throw error;
  }
  if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
  const now = new Date();
  const blocks = weibo ? weiboBlocks : [];
  let entries = blocks.length ? relevantEntriesFromBlocks(blocks, now) : [];
  entries = entries.filter((entry) => !entry.publishedAt || withinLookback(entry.publishedAt, now, lookbackDays));
  if (!weibo) {
    entries = [];
    const rawLinks = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({
      text: anchor.innerText || anchor.textContent || '',
      href: anchor.href
    }))).catch(() => []);
    const maxArticles = Math.max(0, Math.min(30, Number(source.maxArticles ?? 30) || 0));
    const links = candidateArticleLinks(rawLinks, page.url(), maxArticles);
    for (const link of links) {
      const detail = await page.context().newPage();
      try {
        const detailResponse = await detail.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (detailResponse && detailResponse.status() >= 400) continue;
        await detail.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        const detailTitle = await detail.title();
        const pagePublishedAt = await extractPagePublishedAt(detail, now);
        const articleTexts = await detail.locator('article, .article-content, .news-content, .detail-content, .article_detail, .TRS_Editor, #zoom, #article-content, #content-detail').allInnerTexts().catch(() => []);
        const detailText = articleTexts
          .map((value) => value.trim())
          .filter((value) => value.length >= 20)
          .sort((a, b) => b.length - a.length)[0]
          || await detail.locator('body').innerText({ timeout: 10000 });
        const detailEntry = messageEntry(`${link.text}\n${detailText}`, now, pagePublishedAt);
        if (detailEntry) entries = mergeEntries(entries, [{
          ...detailEntry,
          id: detail.url(),
          url: detail.url(),
          title: link.text
        }]);
      } catch {
        // A broken detail link should not fail the source's listing-page check.
      } finally {
        await detail.close().catch(() => {});
      }
    }
  }
  return { title, finalUrl: page.url(), lines: entries.map((item) => item.text), entries };
}

async function check() {
  const sources = (await readJson(path.join(ROOT, 'sources.json'), [])).filter((item) => item.enabled !== false && item.url).map((item, sourceIndex) => ({ ...item, sourceIndex }));
  const prior = await readJson(STATE_FILE, {});
  const next = { ...prior };
  const results = [];
  const context = await launch(true);
  const concurrency = Math.max(1, Math.min(4, Number(arg('--concurrency', '1')) || 1));
  const sourceDelayMs = Math.max(0, Math.min(10000, Number(arg('--source-delay-ms', '1000')) || 0));
  const lookbackDays = Math.max(1, Math.min(30, Number(arg('--days', String(DEFAULT_LOOKBACK_DAYS))) || DEFAULT_LOOKBACK_DAYS));
  let cursor = 0;

  async function worker() {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      const started = Date.now();
      const page = await context.newPage();
      try {
        const data = await loadText(page, source, lookbackDays);
        const hasPrevious = Object.hasOwn(prior, source.url);
        const previous = prior[source.url]?.lines ?? [];
        const addedLines = hasPrevious ? diffLines(previous, data.lines) : [];
        const addedEntries = data.entries.filter((entry) => addedLines.includes(entry.text) && entry.publishedAt && withinLookback(entry.publishedAt, new Date(), lookbackDays));
        const added = addedEntries.map((entry) => entry.text);
        const changed = hasPrevious && added.length > 0;
        next[source.url] = { name: source.name, checkedAt: new Date().toISOString(), ...data };
        results.push({ sourceIndex: source.sourceIndex, name: source.name, url: source.url, status: 'ok', initial: !hasPrevious, changed, added, matches: data.lines.length, ms: Date.now() - started });
        console.log(`[${changed ? '更新' : hasPrevious ? '无变化' : '建档'}] ${source.name} (${data.lines.length} 条相关文本)`);
      } catch (error) {
        results.push({ sourceIndex: source.sourceIndex, name: source.name, url: source.url, status: error.code === 'LOGIN_REQUIRED' ? 'login_required' : 'error', error: error.message, ms: Date.now() - started });
        console.error(`[失败] ${source.name}: ${error.message}`);
      } finally {
        await page.close().catch(() => {});
        if (sourceDelayMs > 0 && cursor < sources.length) await new Promise((resolve) => setTimeout(resolve, sourceDelayMs));
      }
    }
  }

  try { await Promise.all(Array.from({ length: concurrency }, worker)); } finally { await context.close(); }
  results.sort((a, b) => a.sourceIndex - b.sourceIndex);
  await writeJson(STATE_FILE, next);
  const report = { checkedAt: new Date().toISOString(), lookbackDays, total: sources.length, updates: results.filter((r) => r.changed).length, results };
  await writeJson(REPORT_JSON, report);
  const changed = results.filter((r) => r.changed && r.added.length);
  const history = await readJson(HISTORY_FILE, []);
  const detectedAt = report.checkedAt;
  const priorDetections = new Map(history.map((item) => [`${item.name}\n${item.text}`, item.detectedAt]));
  const recentByKey = new Map();
  for (const [sourceUrl, source] of Object.entries(next)) {
    for (const entry of source.entries || []) {
      if (!entry.id || !entry.publishedAt || !withinLookback(entry.publishedAt, new Date(detectedAt), lookbackDays)) continue;
      const key = `${source.name}\n${entry.id}`;
      recentByKey.set(key, {
        detectedAt: priorDetections.get(`${source.name}\n${entry.text}`) || detectedAt,
        publishedAt: entry.publishedAt,
        id: entry.id,
        sourceIndex: results.find((item) => item.url === sourceUrl)?.sourceIndex ?? null,
        name: source.name,
        url: entry.url || sourceUrl,
        text: entry.text
      });
    }
  }
  const recentHistory = [...recentByKey.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await writeJson(HISTORY_FILE, recentHistory.slice(0, 2000));
  const failures = results.filter((r) => r.status !== 'ok');
  const md = [`# 微博公交监控`, '', `检查时间：${new Date().toLocaleString('zh-CN')}`, `监测窗口：近 ${lookbackDays} 天`, `来源：${sources.length}；更新：${changed.length}；失败：${failures.length}`, ''];
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
  console.error('用法：node src/cli.js <login|check|watch> [--minutes 10] [--concurrency 1] [--source-delay-ms 1000]');
  process.exitCode = 2;
}
