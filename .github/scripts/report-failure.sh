#!/usr/bin/env bash
# Turns the tail of the failing step's log into GitHub annotations (split into
# chunks, since one annotation holds only a few KB) so the failure reason is
# readable on the run page and through the API without downloading full logs.
log="${RUNNER_TEMP}/step.log"
[ -f "$log" ] || exit 0
tail -n 80 "$log" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-240 > "${RUNNER_TEMP}/tail.log"
split -C 3000 -d "${RUNNER_TEMP}/tail.log" "${RUNNER_TEMP}/chunk."
n=0
for chunk in "${RUNNER_TEMP}"/chunk.*; do
  n=$((n + 1))
  msg=$(sed -e 's/%/%25/g' "$chunk" | sed -e ':a;N;$!ba;s/\r/%0D/g;s/\n/%0A/g')
  echo "::error title=CI failure part ${n}::${msg}"
done
