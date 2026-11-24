#!/bin/sh
# Files mounted from Windows appear world-readable inside Linux containers, and ssh refuses
# private keys with such permissions. Copy the mounted keys into the container's own
# ~/.ssh with strict permissions before running the requested command.
set -e

mkdir -p /root/.ssh
chmod 700 /root/.ssh
if [ -d /keys ]; then
  for key in /keys/depi-ecommerce /keys/depi-ecommerce.pub; do
    if [ -f "$key" ]; then cp "$key" /root/.ssh/; fi
  done
  if [ -f /root/.ssh/depi-ecommerce ]; then chmod 600 /root/.ssh/depi-ecommerce; fi
fi

# Terraform's shared provider cache must exist before "terraform init".
if [ -n "$TF_PLUGIN_CACHE_DIR" ]; then mkdir -p "$TF_PLUGIN_CACHE_DIR"; fi

exec "$@"
