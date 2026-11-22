#!/bin/sh
# Start the bridge as the unprivileged `node` user, whoever owns the volume.
#
# A host that mounts its own volume over DATA_DIR (Railway does) hides the
# image's `chown` and hands the directory over root-owned, so `node` cannot
# write the linked device's keys. The container therefore starts as root, makes
# DATA_DIR node's, and drops to node before the bridge runs. exec keeps the
# bridge as PID 1 so it receives SIGTERM on a redeploy.
set -e

if [ "$(id -u)" = "0" ]; then
  data_dir="${DATA_DIR:-/data}"
  mkdir -p "$data_dir"
  if [ "$(stat -c %u "$data_dir")" != "$(id -u node)" ]; then
    chown -R node:node "$data_dir"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
