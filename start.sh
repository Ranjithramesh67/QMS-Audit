#!/usr/bin/env bash
# Starts the backend API (port 3001) and the frontend dev server (port 5173, the exposed port).
# The frontend dev server proxies /api -> backend, so only one port is needed for preview.
set -e

echo "Starting QMS Audit Platform..."

# Backend API
npm --prefix backend run dev &
BACKEND_PID=$!

# Frontend (Vite) - this is the port exposed to the preview environment
npm --prefix frontend run dev &
FRONTEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for either process to exit
wait -n "$BACKEND_PID" "$FRONTEND_PID"
