#!/usr/bin/env bash
# setup.sh — One-time setup for BMS Monitor web app.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "──────────────────────────────────────────"
echo " BookMyShow Monitor — Setup"
echo "──────────────────────────────────────────"

if ! command -v python3 &>/dev/null; then
  echo "❌  python3 not found. Install from https://python.org"
  exit 1
fi
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "✅  Python $PY_VER"

echo ""
echo "📦  Installing Python dependencies …"
python3 -m pip install --upgrade pip --quiet
python3 -m pip install -r requirements.txt --quiet
echo "✅  Dependencies installed (Flask, APScheduler, Playwright, PyYAML)"

echo ""
echo "🌐  Installing Playwright Chromium browser …"
python3 -m playwright install chromium
echo "✅  Chromium installed"

echo ""
echo "──────────────────────────────────────────"
echo " Setup complete! Next steps:"
echo ""
echo "  1. Start the web app:"
echo "     python3 app.py"
echo ""
echo "  2. Open your browser at:"
echo "     http://localhost:5055"
echo ""
echo "  3. Click '⚙ Email Config' in the top-right to set up Gmail."
echo "     (App Password: https://myaccount.google.com/apppasswords)"
echo ""
echo "  4. Paste the BookMyShow URL and click 'Start Monitoring'."
echo "──────────────────────────────────────────"
