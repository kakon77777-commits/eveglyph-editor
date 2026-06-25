@echo off
REM ============================================================
REM  EveGlyph Editor launcher — double-click to run.
REM  First run installs dependencies, then starts the dev server
REM  and opens the browser automatically.
REM
REM  Agent CLIs (Claude / Codex / Gemini) are detected by the
REM  bridge itself at runtime — no resolution needed here.
REM ============================================================
cd /d "%~dp0"
title EveGlyph Editor

if not exist "node_modules" (
  echo Installing dependencies for the first time...
  echo This may take a minute.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [!] npm install failed. Make sure Node.js is installed.
    pause
    exit /b 1
  )
)

echo.
echo Starting EveGlyph Editor... the browser will open automatically.
echo Close this window to stop the server.
echo.
call npm run dev

echo.
echo Server stopped.
pause
