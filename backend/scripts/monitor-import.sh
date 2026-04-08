#!/bin/bash

echo "📊 UK Companies Import Monitor"
echo "================================"
echo "Press Ctrl+C to stop monitoring"
echo ""

while true; do
  clear
  echo "📊 Import Status - $(date '+%H:%M:%S')"
  echo "================================"
  
  RESPONSE=$(curl -s http://localhost:5000/api/bulk-import/status 2>/dev/null)
  
  if [ $? -eq 0 ]; then
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
  else
    echo "❌ Cannot connect to server"
    echo "   Is the server running? (npm start)"
  fi
  
  echo ""
  echo "🔄 Refreshing every 10 seconds..."
  sleep 10
done
