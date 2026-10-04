@echo off
chcp 65001 >nul
title Voice Split - one file per character
cd /d "%~dp0"

rem  How to use:
rem    drag one or more video/audio files onto this file -> split each, review page
rem      opens automatically (only when you dropped a single file)
rem    drag one or more saved edits.json files            -> apply each
rem    double-click                                        -> pick file(s)
rem
rem  First run installs packages; later runs start instantly (remembered in .venv).
rem  To force a clean reinstall, delete the .venv folder and run this again.

set "TOOL=scripts\voice_split_offline.py"
if not exist "%TOOL%" set "TOOL=voice_split.py"
if not exist "%TOOL%" (
  echo [ERROR] Put this file next to voice_split.py or in the BarameyDabber folder.
  goto :end
)

rem ---- 1. Python ----
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

rem Packages: checked once, remembered in a stamp file so later runs start instantly
if not exist ".venv\pkgs_ok" (
  echo [1/3] Installing packages - first run only, needs internet ...
  "%PY%" -m pip install -q --disable-pip-version-check numpy scipy
  if errorlevel 1 (
    echo [ERROR] pip install failed - take a screenshot of this window.
    goto :end
  )
  echo ok> ".venv\pkgs_ok"
)

rem Demucs removes the music first: finds lines hidden under music, cleaner voices.
rem Asked once; the answer is remembered. With an NVIDIA GPU, Demucs also runs far
rem faster - detected automatically, no extra question.
if not exist ".venv\pkgs_ok_demucs" if not exist ".venv\no_demucs" (
  echo.
  echo  Install Demucs? It removes the music before splitting - much better results.
  echo  Downloads about 2 GB once. [Y = install, N = skip, ask never again]
  choice /c YN /t 30 /d N /m " Install Demucs"
  if errorlevel 2 (
    echo skip> ".venv\no_demucs"
  ) else (
    where nvidia-smi >nul 2>nul
    if not errorlevel 1 (
      echo  NVIDIA GPU found - trying GPU-accelerated Demucs ^(much faster^) ...
      "%PY%" -m pip install -q --disable-pip-version-check torch --index-url https://download.pytorch.org/whl/cu121 >nul 2>nul
    )
    "%PY%" -m pip install --disable-pip-version-check demucs
    if not errorlevel 1 echo ok> ".venv\pkgs_ok_demucs"
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

rem ---- 3. What to do (one file, or a whole folder of episodes dropped together) ----
set "LIST=%TEMP%\voice_split_input_%RANDOM%.txt"
if not "%~1"=="" (
  (for %%F in (%*) do @echo %%~F)> "%LIST%"
) else (
  echo [3/3] Choose one or more video/audio files, or edits.json files ...
  powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; $d.Filter='Video, audio or edits.json|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.flv;*.ts;*.mp3;*.wav;*.m4a;*.aac;*.flac;*.json|All files|*.*'; if ($d.ShowDialog() -eq 'OK') { [IO.File]::WriteAllLines('%LIST%', [string[]]$d.FileNames, (New-Object Text.UTF8Encoding $false)) }"
)
if not exist "%LIST%" (
  echo Nothing chosen.
  goto :end
)
set /a TOTAL=0
for /f "usebackq delims=" %%F in ("%LIST%") do set /a TOTAL+=1
if "%TOTAL%"=="0" (
  echo Nothing chosen.
  del "%LIST%" 2>nul
  goto :end
)

if not exist "voice_split" mkdir "voice_split"
set "PYTHONIOENCODING=utf-8"
if %TOTAL% GTR 1 echo.
if %TOTAL% GTR 1 echo Processing %TOTAL% files - each episode remembers the others' characters.

for /f "usebackq delims=" %%F in ("%LIST%") do (
  if /i "%%~xF"==".json" (
    echo.
    echo Applying fixes from "%%~nF%%~xF" ...
    "%PY%" "%TOOL%" apply "%%~F" --search "voice_split" --profiles "voice_split\voices.json"
    if errorlevel 1 echo [ERROR] Could not apply %%~nF - see the message above
  ) else (
    echo.
    echo Splitting "%%~nF" ... ^(a 45 min episode: about 1 min, plus a few min if Demucs runs^)
    "%PY%" "%TOOL%" split "%%~F" --outdir "voice_split\%%~nF" --profiles "voice_split\voices.json"
    if errorlevel 1 (
      echo [ERROR] Could not split %%~nF - see the message above
    ) else if "%TOTAL%"=="1" (
      start "" "voice_split\%%~nF\review.html"
    )
  )
)
del "%LIST%" 2>nul

echo.
echo ============================================================
if "%TOTAL%"=="1" (
  echo  Done. The review page opened - fix only the lines marked
  echo  with a warning sign, click "Save edits.json", then drag
  echo  edits.json onto VOICE_SPLIT.bat.
) else (
  echo  Done - %TOTAL% files processed. Open each folder's review.html
  echo  to fix its flagged lines, save edits.json, then drag each
  echo  edits.json onto VOICE_SPLIT.bat.
)
echo   "%CD%\voice_split"
echo ============================================================
start "" "voice_split"
goto :end

:end
echo.
pause
