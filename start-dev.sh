#!/usr/bin/env bash

set -euo pipefail

cd /home/charles/Documents/Projects/HomeServer || exit 1

mkdir -p .logs .pids

stop_if_running() {
  local pid_file="$1"

  if [ ! -f "$pid_file" ]; then
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
  fi

  rm -f "$pid_file"
}

stop_if_running .pids/frontend.pid
stop_if_running .pids/backend.pid

nohup npm --prefix frontend run dev -- --host > .logs/frontend.log 2>&1 < /dev/null &
echo $! > .pids/frontend.pid

nohup npm --prefix backend run dev -- --host > .logs/backend.log 2>&1 < /dev/null &
echo $! > .pids/backend.pid
