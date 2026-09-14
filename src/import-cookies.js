import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { isWeibo, loginRequired, readJson } from './monitor.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROFILE = path.join(ROOT, 'work', 'browser-profile');
let input = '';
for await (const chunk of process.stdin) input += chunk;

const cookies = input.trim().split(/;\s*/).map((part) => {
  const separator = part.indexOf('=');
  if (separator < 1) return null;
  return {
    name: part.slice(0, separator).trim(),
    value: part.slice(separator + 1).trim(),
    domain: '.weibo.com',
    path: '/',
    secure: true,
    sameSite: 'Lax'
  };
}).filter(Boolean);

if (!cookies.length) throw new Error('没有识别到 Cookie');
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  headless: true,
  locale: 'zh-CN'
});
try {
  await context.addCookies(cookies);
  const page = context.pages()[0] ?? await context.newPage();
  const sources = await readJson(path.join(ROOT, 'sources.json'), []);
  const verifyUrl = sources.find((source) => source.enabled !== false && source.url && isWeibo(source.url))?.url || 'https://weibo.com/';
  await page.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const text = await page.locator('body').innerText().catch(() => '');
  const loggedIn = !loginRequired(page.url(), text);
  console.log(JSON.stringify({ imported: cookies.length, loggedIn, verifiedOnProfile: verifyUrl !== 'https://weibo.com/' }));
} finally {
  await context.close();
}
