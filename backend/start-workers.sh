#!/bin/bash
cd /workspaces/Data-Bunker/backend
export NUM_WORKERS=${1:-10}
node scripts/start-enrichment-workers.js
