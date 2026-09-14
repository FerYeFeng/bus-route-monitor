@echo off
setlocal
title Weibo Bus Monitor

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or later first.
  pause
  exit /b 1
)

if not exist "node_modules\playwright\package.json" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

set "HOST=0.0.0.0"
set "PORT=9093"
set "CHECK_INTERVAL_MINUTES=10"
set "CHECK_START_DELAY_MINUTES=5"
set "CHECK_CONCURRENCY=1"
set "SOURCE_COOLDOWN_MS=1000"
set "LOOKBACK_DAYS=5"

rem Reuse the existing monitor instead of starting a second server.
powershell -NoProfile -Command "try { $s = Invoke-RestMethod -Uri 'http://127.0.0.1:9093/api/status' -TimeoutSec 2; if ($null -ne $s.running) { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Weibo monitor is already running: http://localhost:9093
  start "" "http://localhost:9093"
  exit /b 0
)

echo Starting Weibo monitor: http://localhost:9093
echo Keep this window open. Press Ctrl+C to stop the service.
call npm run serve

if errorlevel 1 (
  echo.
  echo The service stopped with an error.
  pause
)
