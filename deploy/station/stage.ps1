# Gathers what Lume POS installs into deploy/station/stage/ (run from the repo root after
# `npm ci` and `npm run build`): Node.js for Windows, the server, the built app, and only the
# runtime packages. Used by .github/workflows/station.yml.
# -OfflineWebView2: also Microsoft's full WebView2 installer, for the offline Setup.exe (iscc /DOffline).
param([Parameter(Mandatory = $true)][string]$NodeVersion, [Parameter(Mandatory = $true)][string]$AppVersion, [switch]$OfflineWebView2)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stage = Join-Path $PSScriptRoot 'stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$stage\node", "$stage\app" | Out-Null

# Node.js: just node.exe, the exact version this POS is tested with.
$zip = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $zip -UseBasicParsing
Expand-Archive $zip -DestinationPath $env:TEMP -Force
Copy-Item "$env:TEMP\node-v$NodeVersion-win-x64\node.exe" "$stage\node\node.exe"

# The POS: the server, the code it shares with the app, the built app (no tests, no local data).
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
foreach ($dir in @('server', 'src', 'dist')) {
  Copy-Item (Join-Path $root $dir) "$stage\app\$dir" -Recurse
}
Get-ChildItem "$stage\app" -Recurse -Include '*.test.ts', '*.test.tsx' | Remove-Item -Force
foreach ($local in @('server\data', 'server\prints', 'server\.env', 'server\.env.migrate')) {
  $p = Join-Path "$stage\app" $local
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}
Copy-Item (Join-Path $root 'package.json'), (Join-Path $root 'package-lock.json') "$stage\app"
Push-Location "$stage\app"
try { & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm ci failed' } } finally { Pop-Location }

if ($OfflineWebView2) {
  New-Item -ItemType Directory -Force -Path "$stage\webview2" | Out-Null
  Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/?linkid=2124701' -OutFile "$stage\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" -UseBasicParsing
}

Set-Content -Path "$stage\version.txt" -Value $AppVersion -NoNewline
Write-Host "Staged Lume POS $AppVersion ($([math]::Round((Get-ChildItem $stage -Recurse | Measure-Object Length -Sum).Sum / 1MB)) MB)"
