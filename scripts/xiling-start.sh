#!/usr/bin/env sh
set -eu

pnpm --filter @xiling/server dev &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' INT TERM EXIT
pnpm --filter @xiling/web dev
