@echo off
chcp 65001 >nul
title Voice Clips - cut one voice into individual clips
cd /d "%~dp0"

rem  For a file that already holds ONE character's voice only (e.g. an S01.wav from
rem  VOICE_SPLIT.bat, or any already-separated voice track) and you want it cut back
rem  into individual short clips instead of one long file.
rem
rem  How to use: drag one or more such files onto this file, or double-click to pick.

set "TOOL=scripts\voice_split_offline.py"
if not exist "%TOOL%" set "TOOL=voice_split.py"
if not exist "%TOOL%" (
  echo [ERROR] Put this file next to voice_split.py or in the BarameyDabber folder.
  goto :end
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install from https://www.python.org/downloads/
  echo         and tick "Add Python to PATH", then run this file again.
  goto :end
)
if not exist ".venv\Scripts\python.exe" (
  echo [1/2] Creating .venv ...
  python -m venv .venv
)
set "PY=.venv\Scripts\python.exe"
if not exist ".venv\pkgs_ok" (
  echo [1/2] Installing packages - first run only, needs internet ...
  "%PY%" -m pip install -q --disable-pip-version-check numpy scipy
  if errorlevel 1 (
    echo [ERROR] pip install failed - take a screenshot of this window.
    goto :end
  )
  echo ok> ".venv\pkgs_ok"
)

if exist "bin\ffmpeg.exe" set "PATH=%CD%\bin;%PATH%"
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [2/2] Downloading FFmpeg ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile 'ffmpeg.zip'; Expand-Archive 'ffmpeg.zip' -DestinationPath 'temp_ffmpeg'; New-Item -ItemType Directory -Force bin | Out-Null; Move-Item 'temp_ffmpeg\*\bin\ffmpeg.exe' bin\; Move-Item 'temp_ffmpeg\*\bin\ffprobe.exe' bin\; Remove-Item -Recurse -Force 'temp_ffmpeg', 'ffmpeg.zip'"
  set "PATH=%CD%\bin;%PATH%"
)

set "LIST=%TEMP%\voice_clips_input_%RANDOM%.txt"
if not "%~1"=="" (
  (for %%F in (%*) do @echo %%~F)> "%LIST%"
) else (
  echo Choose one or more audio files (one voice per file) ...
  powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; $d.Filter='Audio or video|*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg;*.mp4;*.mkv;*.mov;*.webm|All files|*.*'; if ($d.ShowDialog() -eq 'OK') { [IO.File]::WriteAllLines('%LIST%', [string[]]$d.FileNames, (New-Object Text.UTF8Encoding $false)) }"
)
if not exist "%LIST%" (
  echo Nothing chosen.
  goto :end
)

echo.
echo  How short should the clips be?
echo   [1] Fine   - cuts often, short clips
echo   [2] Normal - balanced (recommended)
echo   [3] Coarse - cuts only at long pauses, longer clips
choice /c 123 /t 20 /d 2 /m " Choose 1-2-3"
if errorlevel 3 (set "MDB=7" & set "MGAP=0.22") else if errorlevel 2 (set "MDB=4" & set "MGAP=0.12") else (set "MDB=2.5" & set "MGAP=0.08")

if not exist "voice_clips" mkdir "voice_clips"
set "PYTHONIOENCODING=utf-8"

for /f "usebackq delims=" %%F in ("%LIST%") do (
  echo.
  echo Cutting "%%~nF" into clips ...
  "%PY%" "%TOOL%" clips "%%~F" --outdir "voice_clips\%%~nF" --margin-db %MDB% --merge-gap %MGAP%
  if errorlevel 1 echo [ERROR] Could not process %%~nF - see the message above
)
del "%LIST%" 2>nul

echo.
echo ============================================================
echo  Done. Each file's clips, numbered in order, are in:
echo   "%CD%\voice_clips"
echo  Too few/long clips? Run again and pick [1] Fine.
echo  Too many/short clips? Run again and pick [3] Coarse.
echo ============================================================
start "" "voice_clips"

:end
echo.
pause
