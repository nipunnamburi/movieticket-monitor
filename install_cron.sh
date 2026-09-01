#!/usr/bin/env bash
# install_cron.sh — Adds a macOS cron job to run the monitor every 15 minutes.
# Safe to re-run; won't add duplicate entries.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_PY="$SCRIPT_DIR/monitor.py"
LOG_FILE="$SCRIPT_DIR/monitor.log"
PYTHON=$(command -v python3)

# Read interval from config.yaml (default 15 if not parseable)
INTERVAL=$(python3 -c "
import yaml, pathlib
cfg = yaml.safe_load(pathlib.Path('$SCRIPT_DIR/config.yaml').read_text())
print(cfg.get('interval_minutes', 15))
" 2>/dev/null || echo 15)

# Build cron expression
if [ "$INTERVAL" -eq 15 ]; then
  CRON_SCHEDULE="*/15 * * * *"
elif [ "$INTERVAL" -eq 5 ]; then
  CRON_SCHEDULE="*/5 * * * *"
elif [ "$INTERVAL" -eq 30 ]; then
  CRON_SCHEDULE="*/30 * * * *"
else
  CRON_SCHEDULE="*/$INTERVAL * * * *"
fi

CRON_LINE="$CRON_SCHEDULE $PYTHON $MONITOR_PY >> $LOG_FILE 2>&1"
MARKER="# bms-monitor"

echo "──────────────────────────────────────────"
echo " Installing cron job: every $INTERVAL minutes"
echo " $CRON_LINE"
echo "──────────────────────────────────────────"

# Remove any existing bms-monitor cron lines, then add the new one
(crontab -l 2>/dev/null | grep -v "$MARKER"; echo "$CRON_LINE  $MARKER") | crontab -

echo ""
echo "✅  Cron job installed!"
echo "   Logs will be written to: $LOG_FILE"
echo ""
echo "   To view live logs:"
echo "     tail -f $LOG_FILE"
echo ""
echo "   To remove the cron job:"
echo "     crontab -l | grep -v '$MARKER' | crontab -"
echo "──────────────────────────────────────────"
