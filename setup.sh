#!/usr/bin/env bash
# setup.sh — One-time setup for BookMyShow Live Monitor Monorepo

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "──────────────────────────────────────────"
echo " 🎬 BookMyShow Live Monitor — Setup"
echo "──────────────────────────────────────────"

if ! command -v node &>/dev/null; then
  echo "❌  Node.js not found. Please install Node.js (v20+) from https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -v)
echo "✅  Node.js $NODE_VER"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "📄  Creating .env from .env.example..."
    cp .env.example .env
  fi
fi

echo ""
echo "📦  Installing monorepo dependencies..."
npm install

echo ""
echo "🌐  Installing Playwright Chromium browser..."
npx playwright install chromium

echo ""
echo "🗄️   Generating Prisma Database Client..."
npm run db:generate

echo ""
echo "🏗️   Building packages & React Web Dashboard..."
npm run build

echo ""
echo "🧪  Running validation test suite..."
npm test

echo ""
echo "──────────────────────────────────────────"
echo " ✅ Setup complete! Choose how to run:"
echo ""
echo "  Option A (Local Development):"
echo "     npm run dev"
echo "     (Open http://localhost:5055 or Vite dev on http://localhost:5173)"
echo ""
echo "  Option B (Production Docker Compose):"
echo "     docker compose up -d --build"
echo "     (Open http://localhost:5055)"
echo ""
echo "  Option C (24/7 Cloud Background Check):"
echo "     npm run runner"
echo "──────────────────────────────────────────"
