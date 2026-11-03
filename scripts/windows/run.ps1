# Lanceur Windows de MyProxmox (appelé par MyProxmox.bat).
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root
$NoUpdate = $args -contains "--no-update"
$NoBrowser = $args -contains "--no-browser"
$Port = if ($env:PORT) { $env:PORT } else { "8080" }

Write-Host ""
Write-Host "  MyProxmox" -ForegroundColor DarkYellow
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js n'est pas installé." -ForegroundColor Red
  Write-Host "  Installe la version LTS depuis https://nodejs.org puis relance MyProxmox.bat"
  Start-Process "https://nodejs.org/fr/download"
  Read-Host "  Entrée pour fermer"
  exit 1
}
$major = [int]((node -v).TrimStart("v").Split(".")[0])
if ($major -lt 20) {
  Write-Host "  Node.js $(node -v) est trop ancien : il faut la version 20 ou plus récente." -ForegroundColor Red
  Read-Host "  Entrée pour fermer"
  exit 1
}

if (-not $NoUpdate) {
  & (Join-Path $PSScriptRoot "update.ps1")
  if ($LASTEXITCODE -ne 0) { Read-Host "  Erreur pendant la préparation. Entrée pour fermer"; exit 1 }
} elseif (-not (Test-Path "server\dist\index.js")) {
  & (Join-Path $PSScriptRoot "update.ps1") -Force
}

if (-not $NoBrowser) {
  Start-Job -ScriptBlock { param($p) Start-Sleep -Seconds 3; Start-Process "http://localhost:$p" } -ArgumentList $Port | Out-Null
}
Write-Host "  Garde cette fenêtre ouverte. Ferme-la (ou Ctrl+C) pour arrêter MyProxmox." -ForegroundColor Gray
$env:PORT = $Port
& node "server\dist\index.js"
exit $LASTEXITCODE
