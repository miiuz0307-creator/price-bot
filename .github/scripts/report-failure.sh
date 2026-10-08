#!/usr/bin/env bash
# Turns the tail of the CI log into a GitHub annotation, so the failure reason is
# visible on the run page and through the API without downloading full logs.
log="${RUNNER_TEMP}/ci.log"
[ -f "$log" ] || exit 0
tail -n 120 "$log" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-400 > "${RUNNER_TEMP}/tail.log"
msg=$(sed -e 's/%/%25/g' "${RUNNER_TEMP}/tail.log" | sed -e ':a;N;$!ba;s/\r/%0D/g;s/\n/%0A/g')
echo "::error title=CI failure (last 120 log lines)::${msg}"
