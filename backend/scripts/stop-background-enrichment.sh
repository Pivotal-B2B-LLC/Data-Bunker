#!/bin/bash

echo "🛑 Stopping Background Enrichment Service..."

if [ ! -f "logs/enrichment.pid" ]; then
  echo "❌ No PID file found - service may not be running"
  exit 1
fi

PID=$(cat logs/enrichment.pid)

if ps -p $PID > /dev/null 2>&1; then
  kill $PID
  echo "✅ Sent stop signal to process $PID"
  echo "⏳ Waiting for graceful shutdown..."
  
  # Wait up to 10 seconds
  for i in {1..10}; do
    if ! ps -p $PID > /dev/null 2>&1; then
      echo "✅ Service stopped"
      rm logs/enrichment.pid
      exit 0
    fi
    sleep 1
  done
  
  # Force kill if still running
  echo "⚠️  Forcing shutdown..."
  kill -9 $PID
  rm logs/enrichment.pid
  echo "✅ Service forcefully stopped"
else
  echo "⚠️  Process $PID not found - cleaning up"
  rm logs/enrichment.pid
fi
