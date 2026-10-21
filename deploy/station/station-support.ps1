# Start menu > "Lume POS support file": the support file on the desktop, even when the POS does
# not start (server/supportFile.ts, run with the Station's own Node.js). The shop's data is for
# administrators only, so Windows asks once (Yes/No); then Explorer shows the file to send.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
function Say([string]$text) { [System.Windows.MessageBox]::Show($text, 'Lume POS support file') | Out-Null }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  try {
    Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
  } catch {
    Say 'Windows needs your permission to read the POS logs. Choose Yes when it asks.'
  }
  exit
}

$node = Join-Path $PSScriptRoot 'node\node.exe'
$script = Join-Path $PSScriptRoot 'app\server\supportFile.ts'
$out = & $node --experimental-strip-types --no-warnings $script 2>&1
if ($LASTEXITCODE -eq 0) {
  $path = "$($out | Select-Object -Last 1)".Trim()
  Start-Process explorer.exe "/select,`"$path`""
} else {
  Say ("The support file could not be made:`n`n" + ($out -join "`n"))
}
