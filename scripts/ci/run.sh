#!/usr/bin/env bash
# Usage: scripts/ci/run.sh "Step name" command args...
# Runs a command; on failure, publishes the tail of its output as a GitHub
# error annotation (readable from the Checks API even when logs are not).
set -o pipefail
name="$1"; shift
out="$(mktemp)"
"$@" 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  tail -n 120 "$out" | sed -e 's/\x1b\[[0-9;]*m//g' > "$out.tail"
  msg="$(sed -e 's/%/%25/g' -e 's/\r/%0D/g' "$out.tail" | awk 'BEGIN{ORS="%0A"} {print}')"
  echo "::error title=${name} failed::${msg}"
fi
exit "$status"
