#!/bin/bash

echo "📊 Background Enrichment Status"
echo "═══════════════════════════════════════════════════════════"

# Check if running
if [ -f "logs/enrichment.pid" ]; then
  PID=$(cat logs/enrichment.pid)
  if ps -p $PID > /dev/null 2>&1; then
    echo "✅ Status: RUNNING (PID: $PID)"
    
    # Show CPU and memory usage
    ps -p $PID -o %cpu,%mem,etime,cmd | tail -1
  else
    echo "❌ Status: NOT RUNNING (PID file exists but process died)"
  fi
else
  echo "⚠️  Status: NOT RUNNING"
fi

echo ""
echo "📈 Database Statistics:"
echo "───────────────────────────────────────────────────────────"

docker exec data-bunker-db psql -U postgres -d databunker -c "
SELECT 
  COUNT(*) as total_active_companies,
  COUNT(*) FILTER (WHERE last_enriched IS NOT NULL) as enriched,
  COUNT(*) FILTER (WHERE website IS NOT NULL) as has_website,
  COUNT(*) FILTER (WHERE email IS NOT NULL) as has_email,
  COUNT(*) FILTER (WHERE phone IS NOT NULL) as has_phone,
  COUNT(*) FILTER (WHERE linkedin_url IS NOT NULL) as has_linkedin,
  ROUND(COUNT(*) FILTER (WHERE last_enriched IS NOT NULL)::NUMERIC / COUNT(*)::NUMERIC * 100, 2) as enrichment_percentage
FROM companies
WHERE status ILIKE '%active%';
" 2>/dev/null

echo ""
echo "📋 Queue Status:"
echo "───────────────────────────────────────────────────────────"

docker exec data-bunker-db psql -U postgres -d databunker -c "
SELECT 
  status,
  COUNT(*) as count
FROM enrichment_queue
GROUP BY status
ORDER BY status;
" 2>/dev/null

echo ""
echo "📝 Recent Activity (last 10 log entries):"
echo "───────────────────────────────────────────────────────────"

if [ -f "logs/enrichment.log" ]; then
  tail -10 logs/enrichment.log
else
  echo "No log file found"
fi

echo "═══════════════════════════════════════════════════════════"
