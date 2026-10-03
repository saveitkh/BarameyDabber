@echo off
title AI Voice Clone ^& Dubbing Studio
chcp 65001 > nul
cd /d "%~dp0"

echo ====================================================
echo  AI Voice Clone ^& Dubbing Studio (Python)
echo ====================================================

REM 1. Python
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Install from https://www.python.org/downloads/
    echo         and tick "Add Python to PATH", then run this file again.
    goto :end
)

REM 2. Virtualenv + packages (pip skips what is already installed)
if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Creating .venv ...
    python -m venv .venv
)
echo [INFO] Checking packages (first run takes a few minutes) ...
.venv\Scripts\python -m pip install -q --disable-pip-version-check fastapi "uvicorn[standard]" python-multipart edge-tts httpx requests python-dotenv pydantic google-genai numpy scipy pillow
if errorlevel 1 (
    echo [ERROR] Package install failed - take a screenshot of this window.
    goto :end
)

REM 3. FFmpeg in bin/ or system PATH
if not exist "bin\ffmpeg.exe" (
    where ffmpeg >nul 2>nul
    if errorlevel 1 (
        echo [INFO] Downloading FFmpeg ...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile 'ffmpeg.zip'; Expand-Archive 'ffmpeg.zip' -DestinationPath 'temp_ffmpeg'; New-Item -ItemType Directory -Force bin | Out-Null; Move-Item 'temp_ffmpeg\*\bin\ffmpeg.exe' bin\; Move-Item 'temp_ffmpeg\*\bin\ffprobe.exe' bin\; Remove-Item -Recurse -Force 'temp_ffmpeg', 'ffmpeg.zip';"
    )
)

REM 4. Pick a free port: 3000, or 3001.. if another app already uses it
set STUDIO_PORT=3000
:checkport
netstat -ano | findstr /R /C:":%STUDIO_PORT% .*LISTENING" >nul
if not errorlevel 1 (
    echo [INFO] Port %STUDIO_PORT% is used by another app - trying the next one.
    set /a STUDIO_PORT+=1
    goto :checkport
)

REM 5. Open the browser only after this server answers (never the old app)
echo [INFO] Starting server on http://localhost:%STUDIO_PORT%  (keep this window open)
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 180;$i++){try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:%STUDIO_PORT%/api/config' | Out-Null; Start-Process 'http://localhost:%STUDIO_PORT%'; break}catch{Start-Sleep 1}}"
.venv\Scripts\python.exe server.py

:end
echo.
echo If you see an error above, take a screenshot of this window.
pause
