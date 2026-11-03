# Met MyProxmox à jour depuis GitHub, puis installe les dépendances et compile si besoin.
# - Avec git (dossier cloné) : git pull en avance rapide uniquement.
# - Sans git (zip téléchargé) : télécharge la dernière version et remplace les fichiers,
#   sans jamais toucher au dossier data\ (configuration, clés, notifications).
# Pour désactiver la mise à jour automatique : crée un fichier vide data\no-auto-update
param([switch]$Force)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root
$Owner = "ethanfrq"
$Name = "MyProxmox"
$Branch = if ($env:MYPROXMOX_BRANCH) { $env:MYPROXMOX_BRANCH } else { "main" }
$Data = Join-Path $Root "data"
New-Item $Data -ItemType Directory -Force | Out-Null
$changed = $false

function Info($m) { Write-Host "  $m" -ForegroundColor Gray }

if ((Test-Path (Join-Path $Data "no-auto-update")) -and -not $Force) {
  Info "Mise à jour automatique désactivée (data\no-auto-update)."
} else {
  try {
    if ((Test-Path ".git") -and (Get-Command git -ErrorAction SilentlyContinue)) {
      Info "Recherche d'une mise à jour (git)..."
      $before = (git rev-parse HEAD).Trim()
      git fetch --quiet origin $Branch
      if ($LASTEXITCODE -ne 0) { throw "git fetch a échoué" }
      git merge --ff-only --quiet "origin/$Branch"
      if ($LASTEXITCODE -ne 0) { throw "des fichiers ont été modifiés localement, mise à jour ignorée" }
      $after = (git rev-parse HEAD).Trim()
      $changed = $before -ne $after
    } else {
      Info "Recherche d'une mise à jour (GitHub)..."
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $headers = @{ "User-Agent" = "MyProxmox-updater"; "Accept" = "application/vnd.github+json" }
      $sha = (Invoke-RestMethod "https://api.github.com/repos/$Owner/$Name/commits/$Branch" -Headers $headers -TimeoutSec 20).sha
      $stamp = Join-Path $Data ".installed-commit"
      $current = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { "" }
      if ($sha -ne $current) {
        $tmp = Join-Path $env:TEMP "myproxmox-update"
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        New-Item $tmp -ItemType Directory | Out-Null
        Info "Téléchargement de la version $($sha.Substring(0,7))..."
        Invoke-WebRequest "https://github.com/$Owner/$Name/archive/refs/heads/$Branch.zip" -OutFile (Join-Path $tmp "src.zip") -UseBasicParsing -TimeoutSec 120
        Expand-Archive (Join-Path $tmp "src.zip") -DestinationPath $tmp -Force
        $src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
        robocopy $src $Root /E /XD data node_modules .git /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "copie des fichiers impossible (robocopy $LASTEXITCODE)" }
        Set-Content $stamp $sha
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        $changed = $true
      }
    }
    if ($changed) { Info "Nouvelle version récupérée." } else { Info "Déjà à jour." }
  } catch {
    Write-Warning "Mise à jour impossible : $($_.Exception.Message). On continue avec la version installée."
  }
}

$needBuild = $changed -or $Force -or -not (Test-Path "node_modules") -or -not (Test-Path "server\dist\index.js") -or -not (Test-Path "web\dist\index.html")
if ($needBuild) {
  Info "Installation des dépendances (npm ci)..."
  & npm.cmd ci --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { Write-Error "npm ci a échoué"; exit 1 }
  Info "Compilation..."
  & npm.cmd run build --silent
  if ($LASTEXITCODE -ne 0) { Write-Error "La compilation a échoué"; exit 1 }
}
exit 0
