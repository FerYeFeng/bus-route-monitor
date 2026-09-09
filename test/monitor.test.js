import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, isTimeLabel, isWeibo, loginRequired, normalizeLines, parseMessageTime, relevantEntries, relevantLines } from '../src/monitor.js';

test('normalizes duplicate and noisy lines', () => {
  assert.deepEqual(normalizeLines('首页\n  12路  临时调整  \n12路 临时调整\n短'), ['12路 临时调整']);
});

test('keeps route-related content and detects additions', () => {
  const lines = relevantLines('今日天气晴朗\n因施工，88路公交临时绕行三天\n欢迎关注我们');
  assert.deepEqual(lines, ['因施工，88路公交临时绕行三天']);
  assert.deepEqual(diffLines(['旧线路公告'], lines), lines);
});

test('recognizes weibo and login wall', () => {
  assert.equal(isWeibo('https://weibo.com/u/1'), true);
  assert.equal(isWeibo('https://example.com/weibo.com'), false);
  assert.equal(loginRequired('https://weibo.com/login.php', '请先登录'), true);
});

test('parses message time and associates nearby route content', () => {
  const now = new Date('2026-09-09T12:00:00+08:00');
  assert.equal(parseMessageTime('今天 08:35', now), '2026-09-09T00:35:00.000Z');
  assert.equal(parseMessageTime('2026年9月8日 17:20', now), '2026-09-08T09:20:00.000Z');
  assert.deepEqual(relevantEntries('9月9日 10:12\n因施工，12路公交临时绕行', now), [
    { text: '因施工，12路公交临时绕行', publishedAt: '2026-09-09T02:12:00.000Z' }
  ]);
  assert.equal(isTimeLabel('9月9日 10:12 来自微博网页版'), true);
  assert.deepEqual(relevantEntries('12路公交自2026年9月8日起临时绕行', now), [
    { text: '12路公交自2026年9月8日起临时绕行', publishedAt: null }
  ]);
});
