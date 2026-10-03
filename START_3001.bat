@echo off
chcp 65001 >nul
title BarameyDabber - Session Studio (port 3001)
cd /d "%~dp0"

if not exist "server.py" (
  echo [ERROR] Put this file in the folder that contains server.py
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install from https://www.python.org/downloads/ and tick "Add Python to PATH"
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating .venv ...
  python -m venv .venv
)

echo [2/3] Installing packages (first time takes a few minutes) ...
.venv\Scripts\python -m pip install -q --disable-pip-version-check fastapi "uvicorn[standard]" python-multipart edge-tts httpx requests python-dotenv pydantic google-genai numpy scipy pillow
if errorlevel 1 (
  echo [ERROR] pip install failed - take a screenshot of this window
  pause
  exit /b 1
)

rem server.py reads PORT from .env (and .env wins), so force 3001 there too.
if not exist ".env" if exist ".env.example" copy ".env.example" ".env" >nul
if exist ".env" (
  powershell -NoProfile -Command "$p='.env'; $t=Get-Content $p; if ($t -match '^PORT=') { $t=$t -replace '^PORT=.*','PORT=3001' } else { $t=@('PORT=3001')+$t }; [IO.File]::WriteAllLines((Resolve-Path $p), $t)"
)
set PORT=3001

echo [3/3] Starting server on http://localhost:3001  (keep this window open)
start "" cmd /c "timeout /t 10 >nul & start http://localhost:3001"
.venv\Scripts\python server.py
echo.
echo Server stopped. If you see an error above, take a screenshot.
pause
