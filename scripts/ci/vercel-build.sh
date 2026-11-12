#!/usr/bin/env bash
# `vercel build`, retried only when eve loses a race for a sandbox template.
#
# Usage: bash scripts/ci/vercel-build.sh [vercel build args...]
# Reads VERCEL_TOKEN from the environment.
#
# The production and staging deploys run in separate concurrency groups (one
# per branch, so a staging push can never cancel a queued production deploy),
# and they share one Vercel project. eve's build prepares a sandbox template
# per agent, named by a hash of its contents; an agent unchanged between the
# two branches gets the same name in both. When both deploys build at once,
# each looks the template up, finds nothing, and creates it — and the second
# create fails with "A sandbox with the name 'eve-sbx-tpl-…' already exists",
# failing the whole deploy (main, #428 merge, 12 Nov 2026).
#
# The other build finishes that template within a minute or two, and a retry
# then finds it and reuses its snapshot. Any other failure fails at once: a
# blind retry would hide a real build error.
set -uo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"

attempts=3
wait_seconds="${VERCEL_BUILD_RETRY_WAIT:-60}"
log="$(mktemp)"

for attempt in $(seq 1 "$attempts"); do
  if vercel build "$@" --token="$VERCEL_TOKEN" 2>&1 | tee "$log"; then
    exit 0
  fi
  if ! grep -Eq "sandbox with the name 'eve-sbx-tpl-[^']+' already exists" "$log"; then
    exit 1
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::Another deploy was creating the same eve sandbox template; retrying vercel build in ${wait_seconds}s (attempt $((attempt + 1)) of ${attempts})."
    sleep "$wait_seconds"
  fi
done

echo "::error::vercel build kept colliding with another deploy's eve sandbox template after ${attempts} attempts."
exit 1
