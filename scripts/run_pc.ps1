# TeleScripts on this Windows PC, for free: the studio + a public https link (Cloudflare quick
# tunnel, no account needed) + the Telegram bot pointed at that link.
# Start it with run_pc.bat (double-click). The first run installs what is missing (Python 3.12,
# Node.js, FFmpeg, packages) and asks for the keys; later runs start in about a minute.
# The link changes on every start; the bot is restarted with the new link automatically.
# Keep this window open — closing it stops the app.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
New-Item -ItemType Directory -Force -Path "$Root\logs", "$Root\tools" | Out-Null

function Say($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "!! $m" -ForegroundColor Yellow }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Winget-Install($id) {
  if (-not (Have 'winget')) { throw "winget is missing — install '$id' by hand, then run again." }
  winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent | Out-Host
  Refresh-Path
}
function Read-Env($file) {
  $vals = @{}
  if (Test-Path $file) {
    foreach ($line in Get-Content $file -Encoding UTF8) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $vals[$Matches[1]] = $Matches[2].Trim().Trim('"') }
    }
  }
  return $vals
}

# ── Tools ────────────────────────────────────────────────────────────────────
Say 'Checking Python 3.12, Node.js, FFmpeg'
$hasPy312 = $false
if (Have 'py') { & py -3.12 --version *> $null; $hasPy312 = ($LASTEXITCODE -eq 0) }
if (-not $hasPy312 -and -not (Test-Path "$Root\.venv\Scripts\python.exe")) { Winget-Install 'Python.Python.3.12' }
if (-not (Have 'node')) { Winget-Install 'OpenJS.NodeJS.LTS' }
if (-not (Have 'ffmpeg')) { Winget-Install 'Gyan.FFmpeg' }
foreach ($c in @('node', 'ffmpeg')) {
  if (-not (Have $c)) { throw "$c was installed but this window cannot see it yet — close it and double-click run_pc.bat again." }
}

# ── Settings (.env) ──────────────────────────────────────────────────────────
$envFile = "$Root\.env"
if (-not (Test-Path $envFile)) {
  Say 'First run: settings'
  $gem = Read-Host 'Gemini API key (AIza...)'
  $pwd = Read-Host 'Admin password for the web login (email cm5722254@gmail.com)'
  $bot = Read-Host 'Telegram bot token from @BotFather (Enter to skip)'
  $botUser = if ($bot) { Read-Host 'Bot username without @ (e.g. TeleScriptsAgentbot)' } else { '' }
  $adminId = Read-Host 'Your Telegram ID for admin [6213884151]'
  if (-not $adminId) { $adminId = '6213884151' }
  @(
    "GEMINI_API_KEY=$gem",
    'STUDIO_PUBLIC_MODE=1',
    'STUDIO_PASSWORD_LOGIN=1',
    "STUDIO_ADMIN_PASSWORD=$pwd",
    "STUDIO_TELEGRAM_BOT_TOKEN=$bot",
    "STUDIO_BOT_USERNAME=$botUser",
    "STUDIO_TELEGRAM_ADMIN_IDS=$adminId",
    "DUBBER_BOT_TOKEN=$bot"
  ) | Set-Content -Path $envFile -Encoding UTF8
  Write-Host "Saved to $envFile (edit it with Notepad any time)."
}
$cfg = Read-Env $envFile

# The https link is public, so sign-in must be on: an older .env from a local-only run may have it
# off, which would let anyone with the link in as admin. Fix those settings and ask for what is missing.
function Set-EnvValue($key, $value) {
  $lines = @(Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -notmatch "^\s*$key\s*=" })
  $lines += "$key=$value"
  $lines | Set-Content -Path $envFile -Encoding UTF8
  $cfg[$key] = $value
}
if ($cfg['STUDIO_PUBLIC_MODE'] -ne '1') { Set-EnvValue 'STUDIO_PUBLIC_MODE' '1' }
if ($cfg['STUDIO_PASSWORD_LOGIN'] -ne '1') { Set-EnvValue 'STUDIO_PASSWORD_LOGIN' '1' }
if (-not $cfg['STUDIO_ADMIN_PASSWORD']) {
  Set-EnvValue 'STUDIO_ADMIN_PASSWORD' (Read-Host 'Admin password for the web login (email cm5722254@gmail.com)')
}
if (-not $cfg['GEMINI_API_KEY']) { Set-EnvValue 'GEMINI_API_KEY' (Read-Host 'Gemini API key (AIza...)') }
if (-not $cfg['STUDIO_TELEGRAM_ADMIN_IDS']) { Set-EnvValue 'STUDIO_TELEGRAM_ADMIN_IDS' '6213884151' }
if (-not $cfg['DUBBER_BOT_TOKEN']) {
  $tok = $cfg['STUDIO_TELEGRAM_BOT_TOKEN']
  if (-not $tok) { $tok = Read-Host 'Telegram bot token from @BotFather (Enter to skip)' }
  if ($tok) {
    Set-EnvValue 'DUBBER_BOT_TOKEN' $tok
    if (-not $cfg['STUDIO_TELEGRAM_BOT_TOKEN']) { Set-EnvValue 'STUDIO_TELEGRAM_BOT_TOKEN' $tok }
    if (-not $cfg['STUDIO_BOT_USERNAME']) { Set-EnvValue 'STUDIO_BOT_USERNAME' (Read-Host 'Bot username without @ (e.g. TeleScriptsAgentbot)') }
  }
}

# ── Python packages ──────────────────────────────────────────────────────────
$py = "$Root\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  Say 'Creating the Python environment'
  & py -3.12 -m venv "$Root\.venv"
  if ($LASTEXITCODE -ne 0) { throw 'Could not create .venv with Python 3.12' }
}
$reqHash = (Get-FileHash "$Root\requirements.txt").Hash
$depsMark = "$Root\.venv\.deps_ok"
if (-not (Test-Path $depsMark) -or (Get-Content $depsMark) -ne $reqHash) {
  Say 'Installing Python packages (first time 5-15 min)'
  & $py -m pip install --upgrade pip | Out-Host
  # CPU PyTorch first (Demucs); the default wheels pull GBs of CUDA files a PC without NVIDIA cannot use
  & $py -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu | Out-Host
  & $py -m pip install -r "$Root\requirements.txt" | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'pip install failed — see the messages above' }
  Set-Content $depsMark $reqHash
}

# ── Web app build ────────────────────────────────────────────────────────────
# A ZIP download has no .git folder: then the newest source file's time marks the version
$head = $null
if (Test-Path "$Root\.git") { try { $head = (git -C $Root rev-parse HEAD 2>$null) } catch { $head = $null } }
if (-not $head) {
  $newest = Get-ChildItem "$Root\src", "$Root\index.html", "$Root\package.json" -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  $head = if ($newest) { "files-$($newest.LastWriteTimeUtc.Ticks)" } else { 'files' }
}
$buildMark = "$Root\logs\.built_head"
if (-not (Test-Path "$Root\public\assets") -or -not (Test-Path $buildMark) -or (Get-Content $buildMark) -ne $head) {
  Say 'Building the web app'
  if (-not (Test-Path "$Root\node_modules")) { npm install --no-audit --no-fund | Out-Host }
  npm run build | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'npm run build failed — see the messages above' }
  Set-Content $buildMark $head
}

# ── Cloudflare tunnel program ────────────────────────────────────────────────
$cf = "$Root\tools\cloudflared.exe"
# A download cut short (window closed, network drop) leaves a broken .exe: check it really runs.
function Test-Exe($path) {
  # Run it: a cut-short download fails to start ("not a valid Win32 application") even though
  # it still begins like a Windows program.
  if (-not (Test-Path $path)) { return $false }
  try {
    $out = & $path --version 2>&1 | Out-String
    return ($LASTEXITCODE -eq 0 -and $out -match 'cloudflared')
  } catch { return $false }
}
if (-not (Test-Exe $cf)) {
  Say 'Downloading cloudflared (free https link, ~40 MB)'
  if (Test-Path $cf) { Remove-Item $cf -Force }
  # Windows only runs files ending in .exe, so the download gets its own .exe name until it is checked
  $part = "$Root\tools\cloudflared-download.exe"
  if (Test-Path $part) { Remove-Item $part -Force }
  $ProgressPreference = 'SilentlyContinue'  # the progress bar makes the download many times slower
  Invoke-WebRequest -UseBasicParsing -OutFile $part 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  if (-not (Test-Exe $part)) { throw 'cloudflared download is incomplete — check the internet and run again.' }
  Move-Item $part $cf -Force
}

# ── Start ────────────────────────────────────────────────────────────────────
$procs = @()
try {
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 3000 is already in use — close the other TeleScripts / uvicorn window first.'
  }
  Say 'Starting the studio'
  $studio = Start-Process -FilePath $py -ArgumentList '-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '3000' `
    -WorkingDirectory $Root -RedirectStandardOutput "$Root\logs\studio.log" -RedirectStandardError "$Root\logs\studio.err.log" `
    -NoNewWindow -PassThru
  $procs += $studio
  $up = $false
  for ($i = 0; $i -lt 90 -and -not $up; $i++) {
    Start-Sleep 2
    if ($studio.HasExited) { break }
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:3000/api/system/version' | Out-Null; $up = $true } catch {}
  }
  if (-not $up) {
    Get-Content "$Root\logs\studio.err.log" -Tail 25 | Out-Host
    throw 'The studio did not start — the last lines of logs\studio.err.log are above.'
  }

  Say 'Opening the free https link'
  $tunnelLog = "$Root\logs\tunnel.log"
  if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
  $tunnel = Start-Process -FilePath $cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3000' `
    -RedirectStandardError $tunnelLog -RedirectStandardOutput "$Root\logs\tunnel.out.log" -NoNewWindow -PassThru
  $procs += $tunnel
  $url = $null
  for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep 1
    if (Test-Path $tunnelLog) {
      $m = Select-String -Path $tunnelLog -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value }
    }
  }
  if (-not $url) { Get-Content $tunnelLog -Tail 20 | Out-Host; throw 'No https link from Cloudflare — check the internet connection and run again.' }

  # Telegram bot (Project1 next to this folder), started with the new link
  $botToken = $cfg['DUBBER_BOT_TOKEN']
  $botProc = $null
  $p1 = Join-Path (Split-Path $Root -Parent) 'Project1'
  if ($botToken -and (Test-Path "$p1\src\dubberBot.js")) {
    Say 'Starting the Telegram bot'
    if (-not (Test-Path "$p1\node_modules")) { Push-Location $p1; npm install --no-audit --no-fund | Out-Host; Pop-Location }
    $env:DUBBER_BOT_TOKEN = $botToken
    $env:DUBBING_STUDIO_URL = "$url/"
    $env:DUBBER_DATA_DIR = "$p1\data"
    $env:DUBBER_ADMIN_IDS = $cfg['STUDIO_TELEGRAM_ADMIN_IDS']
    $botProc = Start-Process -FilePath 'node' -ArgumentList 'src/dubberBot.js' -WorkingDirectory $p1 `
      -RedirectStandardOutput "$Root\logs\bot.log" -RedirectStandardError "$Root\logs\bot.err.log" -NoNewWindow -PassThru
    $procs += $botProc
  } elseif ($botToken) {
    Warn "Telegram bot not started: put the Project1 folder next to this one ($p1)."
  }

  try { Set-Clipboard $url } catch {}
  Write-Host ''
  Write-Host '=========================================================' -ForegroundColor Green
  Write-Host "  TeleScripts is running:  $url" -ForegroundColor Green
  $note = if ($botProc) { 'copied to the clipboard; the bot already uses it' } else { 'copied to the clipboard' }
  Write-Host "  ($note)" -ForegroundColor Green
  Write-Host '  Keep this window open. Close it to stop.' -ForegroundColor Green
  Write-Host '=========================================================' -ForegroundColor Green
  Start-Process $url

  while ($true) {
    Start-Sleep 5
    if ($studio.HasExited) { Warn 'The studio stopped — see logs\studio.err.log'; break }
    if ($tunnel.HasExited) { Warn 'The https link stopped — run run_pc.bat again for a new one'; break }
  }
} finally {
  foreach ($p in $procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
