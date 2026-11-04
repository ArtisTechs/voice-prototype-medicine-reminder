<#
  Start VOICE on this laptop with no manual .env editing.

  - First run: creates .env from .env.example with random secrets.
  - Every run: detects this laptop's IP for the phone app, writes LAN_IP into .env,
    starts the Docker stack and prints the addresses to use.
  - VOICE (ESP32) always uses the Windows Mobile hotspot address http://192.168.137.1:5055,
    which is the same on every Windows laptop, so the firmware is flashed once.

  Usage (from the repo root):  .\start-voice.cmd            phone app reaches the laptop over the phone hotspot
                               .\start-voice.cmd -Hotspot   phone app is connected to the laptop's hotspot
#>
param([switch]$Hotspot)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envFile = Join-Path $root '.env'
$hotspotIp = '192.168.137.1'
$utf8 = New-Object System.Text.UTF8Encoding($false)  # compose dislikes a BOM

function New-Secret([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

function Set-EnvValue([string]$text, [string]$key, [string]$value) {
  if ($text -match "(?m)^$key=") { return [regex]::Replace($text, "(?m)^$key=.*$", "$key=$value") }
  return $text.TrimEnd() + "`n$key=$value`n"
}

# 1. .env with random secrets on first run
if (-not (Test-Path $envFile)) {
  $t = [IO.File]::ReadAllText((Join-Path $root '.env.example'))
  $t = Set-EnvValue $t 'JWT_SECRET' (New-Secret 32)
  $t = Set-EnvValue $t 'MYSQL_PASSWORD' (New-Secret 16)
  $t = Set-EnvValue $t 'MYSQL_ROOT_PASSWORD' (New-Secret 16)
  [IO.File]::WriteAllText($envFile, $t, $utf8)
  Write-Host 'Created .env with new secrets.'
}

# 1b. An .env from the PostgreSQL version: add the MySQL values, drop the old database URL
if ((Test-Path $envFile) -and ([IO.File]::ReadAllText($envFile) -notmatch '(?m)^MYSQL_PASSWORD=')) {
  $t = [IO.File]::ReadAllText($envFile)
  $t = [regex]::Replace($t, '(?m)^(DATABASE_URL|POSTGRES_\w+|VISION_\w+|ANTHROPIC_API_KEY)=.*\r?\n', '')
  $t = Set-EnvValue $t 'MYSQL_DATABASE' 'medrem'
  $t = Set-EnvValue $t 'MYSQL_USER' 'medrem'
  $t = Set-EnvValue $t 'MYSQL_PASSWORD' (New-Secret 16)
  $t = Set-EnvValue $t 'MYSQL_ROOT_PASSWORD' (New-Secret 16)
  $t = Set-EnvValue $t 'GEMINI_MODEL' 'gemini-3.5-flash'
  [IO.File]::WriteAllText($envFile, $t, $utf8)
  Write-Host 'Updated .env for MySQL. Add GEMINI_API_KEY (https://aistudio.google.com/apikey) to enable package scans.' -ForegroundColor Yellow
}

# 2. Addresses: the laptop's own hotspot, and its IP on the network that gives it internet
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
$hotspotOn = [bool]($ips | Where-Object { $_.IPAddress -eq $hotspotIp })
$uplink = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.InterfaceAlias -notlike 'vEthernet*' } |
  ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -and $_ -ne $hotspotIp } | Select-Object -First 1

if ($Hotspot -or -not $uplink) {
  if (-not $hotspotOn) { throw 'No network found. Connect to the phone hotspot, or turn on Windows Mobile hotspot.' }
  $appIp = $hotspotIp
} else {
  $appIp = $uplink
}

$t = [IO.File]::ReadAllText($envFile)
$t = Set-EnvValue $t 'LAN_IP' $appIp
[IO.File]::WriteAllText($envFile, $t, $utf8)
$port = if ($t -match '(?m)^API_PORT=(\d+)') { $Matches[1] } else { '5055' }

# 3. Start the stack
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop, wait for "Engine running", then run this again.' }
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
if ($LASTEXITCODE -ne 0) { throw 'docker compose failed (see above).' }

Write-Host 'Waiting for the API...'
$ok = $false
for ($i = 0; $i -lt 90 -and -not $ok; $i++) {
  try { $ok = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://localhost:$port/healthz").StatusCode -eq 200 } catch { Start-Sleep 2 }
}

Write-Host ''
Write-Host '================ VOICE is running ================' -ForegroundColor Green
if (-not $ok) { Write-Host 'The API is still starting (first run can take a while). Check: docker compose ps' -ForegroundColor Yellow }
Write-Host "Phone app (Expo Go):  exp://${appIp}:8081"
Write-Host "API for the app:      http://${appIp}:$port   (docs: /docs)"
if ($hotspotOn) {
  Write-Host "VOICE device URL:     http://${hotspotIp}:$port   (hotspot is on)"
} else {
  Write-Host "VOICE device URL:     http://${hotspotIp}:$port   - turn on Windows Mobile hotspot so VOICE can connect" -ForegroundColor Yellow
}
if ($port -ne '5055') { Write-Host "Note: API_PORT=$port in .env. The VOICE device firmware needs 5055." -ForegroundColor Yellow }
$rules = Get-NetFirewallRule -DisplayName 'VOICE*' -ErrorAction SilentlyContinue
if (-not $rules) { Write-Host 'Firewall not opened yet: run setup-voice.cmd once (it asks for admin).' -ForegroundColor Yellow }
Write-Host 'Sign in: demo@example.com / demo1234     QR code: docker compose logs -f mobile'
