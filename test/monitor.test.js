import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateArticleLinks, containsMessageTime, diffLines, firstPublishedTime, isTimeLabel, isWeibo, loginRequired, mergeEntries, messageEntry, normalizeLines, oldestMessageTime, parseMessageTime, relevantEntries, relevantEntriesFromBlocks, relevantLines, withinLookback } from '../src/monitor.js';

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
  assert.equal(loginRequired('https://weibo.com/u/1', '前方有点拥堵，请登录后使用'), true);
  assert.equal(loginRequired('https://passport.weibo.com/sso/signin', ''), true);
});

test('parses message time and associates nearby route content', () => {
  const now = new Date('2026-09-09T12:00:00+08:00');
  assert.equal(parseMessageTime('今天 08:35', now), '2026-09-09T00:35:00.000Z');
  assert.equal(parseMessageTime('2026年9月8日 17:20', now), '2026-09-08T09:20:00.000Z');
  assert.equal(parseMessageTime('4小时前', now), '2026-09-09T00:00:00.000Z');
  assert.deepEqual(relevantEntries('9月9日 10:12\n因施工，12路公交临时绕行', now), [
    { text: '因施工，12路公交临时绕行', publishedAt: '2026-09-09T02:12:00.000Z' }
  ]);
  assert.equal(isTimeLabel('9月9日 10:12 来自微博网页版'), true);
  assert.equal(isTimeLabel('4小时前 来自微博网页版'), true);
  assert.equal(containsMessageTime('4小时前'), true);
  assert.equal(containsMessageTime('15分钟前'), true);
  assert.equal(parseMessageTime('15分钟前', now), '2026-09-09T03:45:00.000Z');
  assert.deepEqual(relevantEntries('12路公交自2026年9月8日起临时绕行', now), [
    { text: '12路公交自2026年9月8日起临时绕行', publishedAt: null }
  ]);
});

test('selects same-site route article links and removes duplicates', () => {
  assert.deepEqual(candidateArticleLinks([
    { text: '关于12路公交临时绕行的公告', href: '/news/12#content' },
    { text: '关于12路公交临时绕行的公告', href: 'https://www.example.com/news/12' },
    { text: '公交线路查询', href: '/routes' },
    { text: '普通工作动态', href: '/news/other' },
    { text: '88路恢复运营', href: 'https://outside.example/news/88' }
  ], 'https://example.com/notices/'), [
    { text: '关于12路公交临时绕行的公告', url: 'https://example.com/news/12' }
  ]);
});

test('merges duplicate entries and keeps a discovered publication time', () => {
  assert.deepEqual(mergeEntries(
    [{ text: '12路公交临时绕行', publishedAt: null }],
    [{ text: '12路公交临时绕行', publishedAt: '2026-09-09T02:12:00.000Z', url: 'https://example.com/12' }]
  ), [{
    text: '12路公交临时绕行',
    publishedAt: '2026-09-09T02:12:00.000Z',
    url: 'https://example.com/12'
  }]);
});

test('extracts dated posts as blocks and applies a five-day window', () => {
  const now = new Date('2026-09-10T12:00:00+08:00');
  assert.deepEqual(relevantEntriesFromBlocks([
    '9月9日 10:12\n因施工，12路公交临时绕行',
    '9月3日 08:00\n88路恢复运营'
  ], now), [
    { text: '因施工，12路公交临时绕行', publishedAt: '2026-09-09T02:12:00.000Z' },
    { text: '88路恢复运营', publishedAt: '2026-09-03T00:00:00.000Z' }
  ]);
  assert.equal(oldestMessageTime('9月9日 10:12\n9月3日 08:00', now), '2026-09-03T00:00:00.000Z');
  assert.equal(withinLookback('2026-09-09T02:12:00.000Z', now, 5), true);
  assert.equal(withinLookback('2026-09-03T00:00:00.000Z', now, 5), false);
  assert.equal(firstPublishedTime(['2026-09-09T08:30:00+08:00'], now), '2026-09-09T00:30:00.000Z');
  assert.equal(firstPublishedTime(['浏览次数：541 发布时间：2026-08-31'], now), '2026-08-30T16:00:00.000Z');
  assert.equal(firstPublishedTime(['今天是: 2026年9月10日\n浏览次数：541 发布时间：2026-08-31'], now), '2026-08-30T16:00:00.000Z');
  assert.equal(firstPublishedTime(['2026-09-07 15:46'], now), '2026-09-07T07:46:00.000Z');
});

test('keeps a multi-line post or article as one message', () => {
  const now = new Date('2026-09-10T12:00:00+08:00');
  assert.deepEqual(messageEntry('9月9日 10:12\n12路临时调整\n取消停靠人民路站\n新增停靠中心站', now), {
    text: '12路临时调整\n取消停靠人民路站\n新增停靠中心站',
    publishedAt: '2026-09-09T02:12:00.000Z'
  });
  assert.deepEqual(relevantEntriesFromBlocks([{
    id: 'post-1',
    url: 'https://weibo.com/1/post-1',
    text: '9月9日 10:12\n12路临时调整\n取消停靠人民路站'
  }], now), [{
    id: 'post-1',
    url: 'https://weibo.com/1/post-1',
    text: '12路临时调整\n取消停靠人民路站',
    publishedAt: '2026-09-09T02:12:00.000Z'
  }]);
});

test('deduplicates the same message id as one record', () => {
  assert.deepEqual(mergeEntries(
    [{ id: 'notice-1', text: '12路临时调整', publishedAt: null }],
    [{ id: 'notice-1', text: '12路临时调整\n取消停靠人民路站', publishedAt: '2026-09-09T02:12:00.000Z' }]
  ), [{
    id: 'notice-1',
    text: '12路临时调整\n取消停靠人民路站',
    publishedAt: '2026-09-09T02:12:00.000Z'
  }]);
});
