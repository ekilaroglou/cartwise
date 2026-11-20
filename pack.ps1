# Makes the zip to upload to the Chrome Web Store and to Microsoft Edge Add-ons:
# only the files the extension runs (no README, privacy text or icon source).
# Run it from PowerShell:  .\pack.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force dist | Out-Null
$zip = "dist/eksipno-kalathi-$version.zip"
if (Test-Path $zip) { Remove-Item $zip }
# Windows' own tar writes the zip with forward slashes, as the stores expect
& "$env:WINDIR\System32\tar.exe" -a -c -f $zip manifest.json _locales icons lib background.js boot.js content.css content.js offscreen.html offscreen.js popup.css popup.html popup.js
if ($LASTEXITCODE -ne 0) { throw "tar failed" }
Write-Host "Made $zip"
