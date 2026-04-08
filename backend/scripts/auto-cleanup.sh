#!/bin/bash

###############################################################################
# AUTO CLEANUP - Runs periodically to keep storage clean
# Safe to run anytime - only removes unnecessary files
###############################################################################

BACKEND_DIR="/workspaces/Data-Bunker/backend"

echo "🧹 Auto Cleanup - $(date)"

# 1. Clean old worker logs (keep last 3)
cd "$BACKEND_DIR/logs" 2>/dev/null
ls -t worker-*.log 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null
echo "✓ Worker logs cleaned"

# 2. Truncate large logs (keep last 1000 lines)
cd "$BACKEND_DIR"
for log in import.log officer-import.log server.log; do
    if [ -f "$log" ] && [ $(wc -l < "$log" 2>/dev/null || echo 0) -gt 1000 ]; then
        tail -1000 "$log" > "$log.tmp" && mv "$log.tmp" "$log"
    fi
done
echo "✓ Large logs truncated"

# 3. Remove temp files
find "$BACKEND_DIR" -name "*.tmp" -o -name "*.temp" -o -name "*~" -o -name ".DS_Store" | xargs rm -f 2>/dev/null
echo "✓ Temp files removed"

# 4. Docker cleanup (safe)
docker system prune -f --volumes=false > /dev/null 2>&1
echo "✓ Docker cache cleaned"

echo "✅ Cleanup complete - $(date)"
echo ""
