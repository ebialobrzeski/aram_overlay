# Repairs a node_modules/electron install whose binary never got extracted
# (npm may skip install scripts, and extract-zip can fail silently on newer Node versions).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $root 'node_modules\electron'
if (-not (Test-Path $electron)) { throw "node_modules/electron is missing - run npm install first" }
$version = (Get-Content (Join-Path $electron 'package.json') | ConvertFrom-Json).version
$exe = Join-Path $electron 'dist\electron.exe'
if (Test-Path $exe) { Write-Host "electron.exe already present ($version)"; return }

Write-Host "Downloading / locating electron $version..."
try { node (Join-Path $electron 'install.js') } catch { }
if (-not (Test-Path $exe)) {
  $zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-v$version-win32-x64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $zip) { throw "Zip not found in $env:LOCALAPPDATA\electron\Cache - check your internet connection and rerun" }
  Write-Host "Extracting $($zip.FullName)"
  Expand-Archive -Path $zip.FullName -DestinationPath (Join-Path $electron 'dist') -Force
  $dts = Join-Path $electron 'dist\electron.d.ts'
  if (Test-Path $dts) { Move-Item $dts (Join-Path $electron 'electron.d.ts') -Force }
}
[IO.File]::WriteAllText((Join-Path $electron 'path.txt'), 'electron.exe')
Write-Host "Done: $exe"
