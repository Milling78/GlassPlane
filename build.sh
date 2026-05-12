#!/usr/bin/env bash
# build.sh — full fat-client build pipeline
# Usage:
#   ./build.sh            # build for current platform
#   ./build.sh --win      # cross-compile for Windows (requires Wine on Linux/Mac)
#   ./build.sh --mac      # macOS only
#   ./build.sh --linux    # Linux only
#   ./build.sh --skip-backend   # skip PyInstaller (use existing binary)
#   ./build.sh --skip-frontend  # skip Vite build

set -euo pipefail

PLATFORM_FLAG="${1:-}"
SKIP_BACKEND=false
SKIP_FRONTEND=false
for arg in "$@"; do
  [[ "$arg" == "--skip-backend"  ]] && SKIP_BACKEND=true
  [[ "$arg" == "--skip-frontend" ]] && SKIP_FRONTEND=true
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
BINARY_NAME="glassplane-backend"
[[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "CYGWIN"* ]] && BINARY_NAME="glassplane-backend.exe"

echo "════════════════════════════════════════"
echo " Infra Glassplane — fat client build"
echo "════════════════════════════════════════"

# ── 1. Python backend → PyInstaller binary ────────────────────────────────────
if [[ "$SKIP_BACKEND" == false ]]; then
  echo ""
  echo "▶ Step 1/3 — Compiling FastAPI backend with PyInstaller"

  cd "$BACKEND_DIR"

  if ! command -v pyinstaller &>/dev/null; then
    echo "  Installing PyInstaller…"
    pip install pyinstaller --quiet
  fi

  echo "  Installing backend dependencies…"
  pip install -r requirements.txt --quiet

  echo "  Running PyInstaller…"
  pyinstaller glassplane-backend.spec --distpath dist --workpath build --noconfirm

  if [[ ! -f "dist/$BINARY_NAME" ]]; then
    echo "  ERROR: binary not found at backend/dist/$BINARY_NAME"
    exit 1
  fi
  echo "  ✓ Backend binary: backend/dist/$BINARY_NAME ($(du -sh "dist/$BINARY_NAME" | cut -f1))"
else
  echo "▶ Step 1/3 — Skipping backend build (--skip-backend)"
fi

# ── 2. React frontend → Vite static build ────────────────────────────────────
if [[ "$SKIP_FRONTEND" == false ]]; then
  echo ""
  echo "▶ Step 2/3 — Building React frontend with Vite"

  cd "$FRONTEND_DIR"

  if [[ ! -d node_modules ]]; then
    echo "  Installing frontend dependencies…"
    npm install --silent
  fi

  npm run build
  echo "  ✓ Frontend built to frontend/dist/"
else
  echo "▶ Step 2/3 — Skipping frontend build (--skip-frontend)"
fi

# ── 3. Electron Builder → installer ──────────────────────────────────────────
echo ""
echo "▶ Step 3/3 — Packaging with electron-builder"

cd "$ROOT"

if [[ ! -d node_modules ]]; then
  echo "  Installing root dependencies…"
  npm install --silent
fi

case "$PLATFORM_FLAG" in
  --win)   npm run dist:win   ;;
  --mac)   npm run dist:mac   ;;
  --linux) npm run dist:linux ;;
  *)       npm run dist       ;;
esac

echo ""
echo "════════════════════════════════════════"
echo " Build complete → dist-electron/"
ls -lh dist-electron/ 2>/dev/null || true
echo "════════════════════════════════════════"
