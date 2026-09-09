import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const ROUTE_RE = /公交|巴士|线路|路线|\d{1,4}\s*(?:路|线)|调整|改道|绕行|停运|恢复|开通|撤销|站点|首末班|运营|班次|接驳|临时|施工|迁移|更名|延伸|缩短/iu;
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

export function isTimeLabel(value) {
  const text = value.replace(/\s+/g, ' ').trim();
  return /^(?:刚刚|\d{1,3}\s*分钟前)(?:\s+来自.*)?$/u.test(text)
    || /^(?:今天|昨天|前天)\s*\d{1,2}:\d{2}(?:\s+来自.*)?$/u.test(text)
    || /^\d{1,2}\s*月\s*\d{1,2}\s*日?(?:\s+\d{1,2}:\d{2})?(?:\s+来自.*)?$/u.test(text)
    || /^20\d{2}\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}(?:\s*日)?(?:\s+\d{1,2}:\d{2})?(?:\s+来自.*)?$/u.test(text);
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
  return isWeibo(url) && (/passport\.weibo\.com|login\.sina\.com/i.test(url) || /登录后查看更多|请先登录|扫码登录|短信登录|账号登录/u.test(text));
}
