@echo off
setlocal
title Bus Route Monitor

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
set "CHECK_INTERVAL_MINUTES=3"

echo Starting Bus Route Monitor at http://localhost:9093
echo Keep this window open. Press Ctrl+C to stop the service.
call npm run serve

if errorlevel 1 (
  echo.
  echo The service stopped with an error.
  pause
)
