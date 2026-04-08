#!/bin/bash

echo ""
echo "================================================================================"
echo "   🌍 GLOBAL BUSINESS DATA DOMINATION"
echo "   TARGET: 130+ MILLION BUSINESSES WORLDWIDE"
echo "================================================================================"
echo ""
echo "Step 1: Generating comprehensive city lists..."
echo ""

# Generate USA cities (all 20,000+)
echo "[1/3] Generating USA cities database..."
node usa-all-cities-generator.js > usa-cities-generation.log 2>&1 &
USA_PID=$!

# Generate global cities
echo "[2/3] Generating global cities database..."
node global-cities-generator.js > global-cities-generation.log 2>&1 &
GLOBAL_PID=$!

echo ""
echo "✓ City generation started in background..."
echo ""
echo "Process IDs:"
echo "  USA Cities: $USA_PID"
echo "  Global Cities: $GLOBAL_PID"
echo ""
echo "Logs:"
echo "  tail -f usa-cities-generation.log"
echo "  tail -f global-cities-generation.log"
echo ""
echo "================================================================================"
echo ""
echo "Waiting for generation to complete (checking every 60 seconds)..."
echo ""

# Wait for both processes
while kill -0 $USA_PID 2>/dev/null || kill -0 $GLOBAL_PID 2>/dev/null; do
    sleep 60
    echo "⏳ Still generating city lists..."
done

echo ""
echo "✅ City generation complete!"
echo ""
echo "================================================================================"
echo "   🚀 STARTING MEGA GLOBAL DISCOVERY"
echo "   Running with 100 parallel workers..."
echo "================================================================================"
echo ""

# Start discovery
node mega-global-discovery.js 100

echo ""
echo "================================================================================"
echo "   🎉 DISCOVERY SESSION COMPLETE"
echo "================================================================================"
echo ""
echo "Check your stats:"
echo "  node check-total-stats.js"
echo ""
