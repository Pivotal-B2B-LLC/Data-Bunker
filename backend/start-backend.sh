#!/bin/bash
# Start backend from the correct directory
cd "$(dirname "$0")"
node server.js >> /tmp/backend.log 2>&1
