#Requires -Version 5.1
<#
.SYNOPSIS
    Infra Glassplane — full Windows build pipeline.

.DESCRIPTION
    1. Generates icon assets (requires Pillow)
    2. Compiles the FastAPI backend to a standalone .exe via PyInstaller
    3. Builds the React frontend via Vite
    4. Packages everything into a Windows NSIS installer via electron-builder

.PARAMETER SkipBackend
    Skip the PyInstaller step (reuse an existing backend binary).

.PARAMETER SkipFrontend
    Skip the Vite build step.

.PARAMETER SkipIcons
    Skip icon generation (use existing build-resources/icon.ico).

.PARAMETER Publish
    Push the installer to GitHub Releases (requires GH_TOKEN env var).

.EXAMPLE
    .\build.ps1
    .\build.ps1 -SkipBackend -SkipFrontend
    .\build.ps1 -Publish
#>
param(
    [switch]$SkipBackend,
    [switch]$SkipFrontend,
    [switch]$SkipIcons,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root       = $PSScriptRoot
$BackendDir = Join-Path $Root 'backend'
$FrontDir   = Join-Path $Root 'frontend'
$ScriptsDir = Join-Path $Root 'scripts'
$BuildRes   = Join-Path $Root 'build-resources'
$Binary     = Join-Path $BackendDir 'dist\glassplane-backend.exe'

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "  >> $msg" -ForegroundColor Cyan
}

function Assert-Command([string]$cmd, [string]$hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "  ERROR: '$cmd' not found in PATH. $hint" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Blue
Write-Host "  Infra Glassplane — Windows build" -ForegroundColor Blue
Write-Host "==========================================" -ForegroundColor Blue

# ── 0. Pre-flight ─────────────────────────────────────────────────────────────

Assert-Command 'python'  'Install Python 3.11+ from python.org'
Assert-Command 'node'    'Install Node.js 20+ from nodejs.org'
Assert-Command 'npm'     'Install Node.js 20+ from nodejs.org'

# ── 1. Icons ──────────────────────────────────────────────────────────────────

if (-not $SkipIcons) {
    Write-Step 'Step 1/4 — Generating icon assets'
    $iconScript = Join-Path $ScriptsDir 'make-icon.py'

    $pillowOk = python -c "import PIL" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  Installing Pillow for icon generation...'
        python -m pip install Pillow --quiet
    }

    python $iconScript
    if ($LASTEXITCODE -ne 0) { Write-Host '  Icon generation failed.' -ForegroundColor Red; exit 1 }

    if (-not (Test-Path (Join-Path $BuildRes 'icon.ico'))) {
        Write-Host '  ERROR: build-resources/icon.ico not created.' -ForegroundColor Red
        exit 1
    }
    Write-Host '  OK — icons ready.' -ForegroundColor Green
} else {
    Write-Step 'Step 1/4 — Skipping icons (-SkipIcons)'
    if (-not (Test-Path (Join-Path $BuildRes 'icon.ico'))) {
        Write-Host '  WARNING: build-resources/icon.ico missing — installer will have no icon.' -ForegroundColor Yellow
    }
}

# ── 2. Python backend → PyInstaller .exe ──────────────────────────────────────

if (-not $SkipBackend) {
    Write-Step 'Step 2/4 — Compiling FastAPI backend (PyInstaller)'
    Push-Location $BackendDir

    $pyiOk = python -c "import PyInstaller" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  Installing PyInstaller...'
        python -m pip install pyinstaller --quiet
    }

    Write-Host '  Installing backend dependencies...'
    python -m pip install -r requirements.txt --quiet

    Write-Host '  Running PyInstaller...'
    python -m PyInstaller glassplane-backend.spec `
        --distpath dist `
        --workpath build `
        --noconfirm

    Pop-Location

    if (-not (Test-Path $Binary)) {
        Write-Host "  ERROR: $Binary not found after PyInstaller." -ForegroundColor Red
        exit 1
    }

    $size = [math]::Round((Get-Item $Binary).Length / 1MB, 1)
    Write-Host "  OK — backend binary: $size MB" -ForegroundColor Green
} else {
    Write-Step 'Step 2/4 — Skipping backend build (-SkipBackend)'
    if (-not (Test-Path $Binary)) {
        Write-Host '  WARNING: backend binary not found — installer will be incomplete.' -ForegroundColor Yellow
    }
}

# ── 3. React/Vite frontend ───────────────────────────────────────────────────

if (-not $SkipFrontend) {
    Write-Step 'Step 3/4 — Building React frontend (Vite)'
    Push-Location $FrontDir

    if (-not (Test-Path 'node_modules')) {
        Write-Host '  npm install...'
        npm install --silent
    }

    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host '  Vite build failed.' -ForegroundColor Red; exit 1 }

    Pop-Location
    Write-Host '  OK — frontend/dist/ ready.' -ForegroundColor Green
} else {
    Write-Step 'Step 3/4 — Skipping frontend build (-SkipFrontend)'
}

# ── 4. electron-builder → NSIS installer ────────────────────────────────────

Write-Step 'Step 4/4 — Packaging with electron-builder (NSIS)'
Push-Location $Root

if (-not (Test-Path 'node_modules')) {
    Write-Host '  npm install (root)...'
    npm install --silent
}

if ($Publish) {
    Write-Host '  Publishing to GitHub Releases...'
    npm run release
} else {
    npm run dist:win
}

if ($LASTEXITCODE -ne 0) { Write-Host '  electron-builder failed.' -ForegroundColor Red; exit 1 }

Pop-Location

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Build complete" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

$distDir = Join-Path $Root 'dist-electron'
if (Test-Path $distDir) {
    Get-ChildItem $distDir -Filter '*.exe' | ForEach-Object {
        $mb = [math]::Round($_.Length / 1MB, 1)
        Write-Host "  $($_.Name)  ($mb MB)" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "  Output folder: $distDir" -ForegroundColor Cyan
}
