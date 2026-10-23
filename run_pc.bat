@echo off
REM TeleScripts on this PC (free): studio + public https link + Telegram bot.
REM Double-click to start. Keep the window open; close it to stop.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_pc.ps1"
echo.
pause
