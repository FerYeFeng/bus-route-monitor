import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const REPORT = path.join(ROOT, 'outputs', 'latest.json');
const HISTORY = path.join(ROOT, 'work', 'state', 'history.json');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 9093);
const INTERVAL_MINUTES = Math.max(1, Number(process.env.CHECK_INTERVAL_MINUTES || 3));
let running = false;
let loginRunning = false;
let startedAt = null;
let lastExit = null;
let logTail = [];

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readReport() {
  try { return JSON.parse(await fs.readFile(REPORT, 'utf8')); }
  catch (error) { return error.code === 'ENOENT' ? null : Promise.reject(error); }
}

async function readHistory() {
  try { return JSON.parse(await fs.readFile(HISTORY, 'utf8')); }
  catch (error) { return error.code === 'ENOENT' ? [] : Promise.reject(error); }
}

function runCheck() {
  if (running || loginRunning) return false;
  running = true;
  startedAt = new Date().toISOString();
  logTail = [];
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'check', '--concurrency', '6'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const collect = (chunk) => {
    logTail.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
    logTail = logTail.slice(-20);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', (error) => {
    logTail.push(error.message);
    running = false;
    lastExit = { at: new Date().toISOString(), code: -1 };
  });
  child.on('exit', (code) => {
    running = false;
    lastExit = { at: new Date().toISOString(), code };
  });
  return true;
}

function runLogin() {
  if (running || loginRunning) return false;
  loginRunning = true;
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'login', '--timeout', '300'], {
    cwd: ROOT,
    windowsHide: false,
    detached: false,
    stdio: 'ignore'
  });
  child.on('error', () => { loginRunning = false; });
  child.on('exit', () => { loginRunning = false; });
  return true;
}

async function serveFile(res, pathname) {
  const files = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
  const filename = files[pathname];
  if (!filename) return false;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const data = await fs.readFile(path.join(PUBLIC, filename));
  res.writeHead(200, { 'Content-Type': `${types[path.extname(filename)]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, { running, loginRunning, startedAt, lastExit, intervalMinutes: INTERVAL_MINUTES, logTail, report: await readReport(), history: await readHistory() });
    }
    if (req.method === 'POST' && url.pathname === '/api/check') {
      const accepted = runCheck();
      return json(res, accepted ? 202 : 409, { accepted, running: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const accepted = runLogin();
      return json(res, accepted ? 202 : 409, { accepted, loginRunning });
    }
    if (req.method === 'GET' && await serveFile(res, url.pathname)) return;
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`公交监控面板：http://localhost:${PORT}`);
  console.log(`监听：${HOST}:${PORT}；自动检查间隔：${INTERVAL_MINUTES} 分钟`);
});

setInterval(runCheck, INTERVAL_MINUTES * 60_000).unref();
