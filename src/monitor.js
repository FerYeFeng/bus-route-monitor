import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const ROUTE_RE = /公交|巴士|线路|路线|\d{1,4}\s*(?:路|线)|调整|改道|绕行|停运|恢复|开通|撤销|站点|首末班|运营|班次|接驳|临时|施工|迁移|更名|延伸|缩短/iu;
const ROUTE_SUBJECT_RE = /公交|巴士|线路|路线|\d{1,4}\s*(?:路|线)/iu;
const CHANGE_RE = /调整|改道|绕行|停运|恢复|开通|撤销|站点|首末班|班次|接驳|临时|施工|迁移|更名|延伸|缩短|优化|新增|取消|公告|通告|通知|出行提示/iu;
const NOISE_RE = /^(首页|登录|注册|消息|视频|发现|搜索|更多|微博|转发|评论|点赞|关注|粉丝|收藏|展开|收起)$/u;

export function normalizeLines(text) {
  return [...new Set(text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 4 && line.length <= 500 && !NOISE_RE.test(line))
  )];
}

export function relevantLines(text) {
  return normalizeLines(text).filter((line) => ROUTE_RE.test(line));
}

export function parseMessageTime(value, now = new Date()) {
  const text = value.replace(/\s+/g, ' ').trim();
  let match;
  const make = (year, month, day, hour = 0, minute = 0) => {
    const date = new Date(year, month - 1, day, hour, minute);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  if (/刚刚/u.test(text)) return now.toISOString();
  if ((match = text.match(/(\d{1,3})\s*小时前/u))) return new Date(now.getTime() - Number(match[1]) * 3_600_000).toISOString();
  if ((match = text.match(/(\d{1,3})\s*分钟前/u))) return new Date(now.getTime() - Number(match[1]) * 60_000).toISOString();
  if ((match = text.match(/(20\d{2})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})(?:\s*日)?(?:\s+(\d{1,2}):(\d{2}))?/u))) {
    return make(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
  }
  if ((match = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:\s+(\d{1,2}):(\d{2}))?/u))) {
    let year = now.getFullYear();
    const candidate = new Date(year, Number(match[1]) - 1, Number(match[2]));
    if (candidate.getTime() > now.getTime() + 7 * 86_400_000) year -= 1;
    return make(year, Number(match[1]), Number(match[2]), Number(match[3] || 0), Number(match[4] || 0));
  }
  if ((match = text.match(/(今天|昨天|前天)?\s*(\d{1,2}):(\d{2})/u))) {
    const offset = match[1] === '昨天' ? 1 : match[1] === '前天' ? 2 : 0;
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, Number(match[2]), Number(match[3]));
    return date.toISOString();
  }
  return null;
}

export function firstPublishedTime(values, now = new Date()) {
  for (const value of values) {
    const text = String(value || '').trim();
    const labeled = text.match(/(?:发布时间|发布日期|发布于|更新时间|日期)\s*[:：]?\s*((?:20\d{2})\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}(?:\s*日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/u);
    if (labeled) {
      const parsed = firstPublishedTime([labeled[1]], now);
      if (parsed) return parsed;
    }
    if (/^20\d{2}-\d{2}-\d{2}(?:T|\s)/u.test(text)) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    const parsed = parseMessageTime(text, now);
    if (parsed) return parsed;
  }
  return null;
}

export function isTimeLabel(value) {
  const text = value.replace(/\s+/g, ' ').trim();
  return /^(?:刚刚|\d{1,3}\s*小时前|\d{1,3}\s*分钟前)(?:\s+来自.*)?$/u.test(text)
    || /^(?:今天|昨天|前天)\s*\d{1,2}:\d{2}(?:\s+来自.*)?$/u.test(text)
    || /^\d{1,2}\s*月\s*\d{1,2}\s*日?(?:\s+\d{1,2}:\d{2})?(?:\s+来自.*)?$/u.test(text)
    || /^20\d{2}\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}(?:\s*日)?(?:\s+\d{1,2}:\d{2})?(?:\s+来自.*)?$/u.test(text);
}

export function containsMessageTime(value) {
  return /20\d{2}|\d{1,2}月\d{1,2}日|今天|昨天|前天|\d{1,3}\s*小时前|\d{1,3}\s*分钟前|刚刚/u.test(String(value || ''));
}

export function relevantEntries(text, now = new Date()) {
  const lines = normalizeLines(text);
  return lines.filter((line) => ROUTE_RE.test(line)).map((line) => {
    let publishedAt = null;
    const index = lines.indexOf(line);
    for (let distance = 1; distance <= 4 && !publishedAt; distance += 1) {
      const before = lines[index - distance] || '';
      const after = lines[index + distance] || '';
      publishedAt = (isTimeLabel(before) && parseMessageTime(before, now)) || (isTimeLabel(after) && parseMessageTime(after, now)) || null;
    }
    return { text: line, publishedAt };
  });
}

export function messageEntry(value, now = new Date(), publishedAt = null) {
  const lines = [...new Set(String(value || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && line.length <= 5000 && !NOISE_RE.test(line) && !isTimeLabel(line) && !/^20\d{2}-\d{2}-\d{2}(?:T|\s)/u.test(line))
  )];
  const text = lines.join('\n').slice(0, 20_000);
  if (!text || !ROUTE_RE.test(text)) return null;
  return { text, publishedAt: publishedAt || firstPublishedTime(normalizeLines(value), now) };
}

export function relevantEntriesFromBlocks(blocks, now = new Date()) {
  return mergeEntries(blocks.map((block) => {
    const value = typeof block === 'string' ? { text: block } : block;
    const lines = normalizeLines(value.text);
    const publishedAt = firstPublishedTime(lines.filter((line) => isTimeLabel(line) || /^20\d{2}-\d{2}-\d{2}T/u.test(line)), now);
    const entry = messageEntry(value.text, now, publishedAt);
    return entry ? {
      ...entry,
      ...(value.id ? { id: value.id } : {}),
      ...(value.url ? { url: value.url } : {})
    } : null;
  }).filter(Boolean));
}

export function oldestMessageTime(text, now = new Date()) {
  const times = normalizeLines(text)
    .filter(isTimeLabel)
    .map((line) => parseMessageTime(line, now))
    .filter(Boolean)
    .map((value) => new Date(value).getTime());
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

export function withinLookback(value, now = new Date(), days = 5) {
  const time = value && new Date(value).getTime();
  return Number.isFinite(time) && time >= now.getTime() - Math.max(1, days) * 86_400_000;
}

function comparableHostname(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function candidateArticleLinks(links, baseUrl, limit = 30) {
  const base = new URL(baseUrl);
  base.hash = '';
  const seen = new Set();
  const candidates = [];
  for (const link of links) {
    const text = String(link.text || '').replace(/\s+/g, ' ').trim();
    if (text.length < 4 || text.length > 200 || !ROUTE_SUBJECT_RE.test(text) || !CHANGE_RE.test(text)) continue;
    let url;
    try { url = new URL(link.href, base); } catch { continue; }
    if (!/^https?:$/i.test(url.protocol) || comparableHostname(url.hostname) !== comparableHostname(base.hostname)) continue;
    url.hash = '';
    const href = url.href;
    const dedupeKey = `${url.protocol}//${comparableHostname(url.hostname)}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}`;
    if (href === base.href || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    candidates.push({ text, url: href });
    if (candidates.length >= Math.max(0, limit)) break;
  }
  return candidates;
}

export function mergeEntries(...groups) {
  const merged = new Map();
  for (const entry of groups.flat()) {
    if (!entry?.text) continue;
    const key = entry.id || entry.text;
    const current = merged.get(key);
    if (!current) merged.set(key, entry);
    else if (entry.text.length > current.text.length || (!current.publishedAt && entry.publishedAt)) {
      merged.set(key, { ...current, ...entry, publishedAt: entry.publishedAt || current.publishedAt });
    }
  }
  return [...merged.values()];
}

export function diffLines(previous = [], current = []) {
  const old = new Set(previous);
  return current.filter((line) => !old.has(line));
}

export function digest(lines) {
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function isWeibo(url = '') {
  return /(^|\.)weibo\.com$|(^|\.)weibo\.cn$/i.test(new URL(url).hostname);
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
}

export function loginRequired(url, text) {
  return /passport\.weibo\.com|login\.sina\.com/i.test(url)
    || (isWeibo(url) && /登录后查看更多|请先登录|扫码登录|短信登录|账号登录|前方有点拥堵，请登录后使用|登录\s*\/\s*注册/u.test(text));
}
