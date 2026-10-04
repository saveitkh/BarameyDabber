@echo off
chcp 65001 >nul
title Voice Split - one file per character
cd /d "%~dp0"

rem  How to use:
rem    drag a video/audio file onto this file  -> split voices, then the review page opens
rem    drag the saved edits.json onto this file -> apply your fixes
rem    double-click                             -> pick a file

set "TOOL=scripts\voice_split_offline.py"
if not exist "%TOOL%" set "TOOL=voice_split.py"
if not exist "%TOOL%" (
  echo [ERROR] Put this file next to voice_split.py or in the BarameyDabber folder.
  goto :end
)

rem ---- 1. Python + packages (only the first run takes time) ----
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install from https://www.python.org/downloads/
  echo         and tick "Add Python to PATH", then run this file again.
  goto :end
)
if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating .venv ...
  python -m venv .venv
)
set "PY=.venv\Scripts\python.exe"
echo [1/3] Checking packages ...
"%PY%" -m pip install -q --disable-pip-version-check numpy scipy
if errorlevel 1 (
  echo [ERROR] pip install failed - take a screenshot of this window.
  goto :end
)

rem Demucs removes the music first: finds lines hidden under music, cleaner voices.
rem Asked once; the answer is remembered.
"%PY%" -c "import demucs" >nul 2>nul
if errorlevel 1 if not exist ".venv\no_demucs" (
  echo.
  echo  Install Demucs? It removes the music before splitting - much better results,
  echo  but downloads about 2 GB once. [Y = install, N = skip, ask never again]
  choice /c YN /t 30 /d N /m " Install Demucs"
  if errorlevel 2 (
    echo skip> ".venv\no_demucs"
  ) else (
    "%PY%" -m pip install --disable-pip-version-check demucs
  )
)

rem ---- 2. FFmpeg (bin\ or PATH; downloaded once if missing) ----
if exist "bin\ffmpeg.exe" set "PATH=%CD%\bin;%PATH%"
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [2/3] Downloading FFmpeg ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile 'ffmpeg.zip'; Expand-Archive 'ffmpeg.zip' -DestinationPath 'temp_ffmpeg'; New-Item -ItemType Directory -Force bin | Out-Null; Move-Item 'temp_ffmpeg\*\bin\ffmpeg.exe' bin\; Move-Item 'temp_ffmpeg\*\bin\ffprobe.exe' bin\; Remove-Item -Recurse -Force 'temp_ffmpeg', 'ffmpeg.zip'"
  set "PATH=%CD%\bin;%PATH%"
)

rem ---- 3. What to do ----
set "INPUT=%~1"
if "%INPUT%"=="" (
  echo [3/3] Choose a video/audio file, or the edits.json you saved ...
  for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='Video, audio or edits.json|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.flv;*.ts;*.mp3;*.wav;*.m4a;*.aac;*.flac;*.json|All files|*.*'; if ($d.ShowDialog() -eq 'OK') { $d.FileName }"`) do set "INPUT=%%F"
)
if "%INPUT%"=="" (
  echo Nothing chosen.
  goto :end
)
if not exist "%INPUT%" (
  echo [ERROR] File not found - drag the file onto VOICE_SPLIT.bat again.
  goto :end
)

if not exist "voice_split" mkdir "voice_split"
set "PYTHONIOENCODING=utf-8"
for %%I in ("%INPUT%") do (
  set "EXT=%%~xI"
  set "NAME=%%~nI"
)

if /i "%EXT%"==".json" goto :apply

rem ---- split ----
set "OUT=voice_split\%NAME%"
echo.
echo Splitting "%NAME%" ... (a 45 min episode: about 1 min, plus a few min for Demucs)
"%PY%" "%TOOL%" split "%INPUT%" --outdir "%OUT%" --profiles "voice_split\voices.json"
if errorlevel 1 goto :failed
echo.
echo ============================================================
echo  Done. The review page opens now:
echo   - fix only the lines marked with a warning sign
echo   - click "Save edits.json", then drag edits.json onto VOICE_SPLIT.bat
echo  Files: "%CD%\%OUT%"
echo ============================================================
start "" "%OUT%\review.html"
start "" "%OUT%"
goto :end

:apply
echo.
echo Applying your fixes from "%INPUT%" ...
"%PY%" "%TOOL%" apply "%INPUT%" --search "voice_split" --profiles "voice_split\voices.json"
if errorlevel 1 goto :failed
echo.
echo Done. Character files are updated in the voice_split folder.
start "" "voice_split"
goto :end

:failed
echo.
echo [ERROR] Something went wrong - take a screenshot of this window.

:end
echo.
pause
