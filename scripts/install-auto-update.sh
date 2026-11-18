#!/usr/bin/env bash
# One-time installer to be run by the owner on Test-Bot as root.
set -Eeuo pipefail

readonly app_dir='/opt/pasarguard-node-scheduler'
if (( EUID != 0 )); then
  echo 'Run as root on Test-Bot' >&2
  exit 2
fi
if [[ ! -f "$app_dir/.env" || ! -f "$app_dir/compose.yaml" ]]; then
  echo 'Bootstrap the application and .env before enabling automatic updates' >&2
  exit 2
fi
if [[ "$(git -C "$app_dir" branch --show-current)" != main ]]; then
  echo 'Checkout main before enabling automatic updates' >&2
  exit 2
fi
if [[ "$(grep -c '^SCHEDULER_IMAGE=' "$app_dir/.env" || true)" != 1 ]] ||
   ! grep -qx 'SCHEDULER_IMAGE=ghcr.io/h-zare-dev/pasarguard-node-scheduler:main' "$app_dir/.env"; then
  echo 'Set SCHEDULER_IMAGE to the main GHCR image in .env first' >&2
  exit 2
fi

install -d -m 0700 /var/lib/pasarguard-scheduler-updater
install -m 0644 "$app_dir/systemd/pasarguard-scheduler-update.service" /etc/systemd/system/
install -m 0644 "$app_dir/systemd/pasarguard-scheduler-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pasarguard-scheduler-update.timer
systemctl start pasarguard-scheduler-update.service
systemctl --no-pager status pasarguard-scheduler-update.timer
