#!/usr/bin/env bash
# Server-side unattended deployment. A reviewed merge to main is the release gate.
# Never copies .env, touches SQLite, or restarts another Docker Compose service.
set -Eeuo pipefail

readonly app_dir='/opt/pasarguard-node-scheduler'
readonly image='ghcr.io/h-zare-dev/pasarguard-node-scheduler:main'
readonly failed_image_file='/var/lib/pasarguard-scheduler-updater/failed-image-id'

exec 9>/run/lock/pasarguard-scheduler-updater.lock
flock -n 9 || exit 0

cd "$app_dir"
if [[ "$(git branch --show-current)" != 'main' ]]; then
  echo 'REFUSED: auto-update only supports a checked-out main branch' >&2
  exit 2
fi
if [[ ! -f .env ]] ||
   [[ "$(grep -c '^SCHEDULER_IMAGE=' .env || true)" != 1 ]] ||
   ! grep -qx "SCHEDULER_IMAGE=$image" .env; then
  echo 'REFUSED: .env must exist and select the main GHCR image' >&2
  exit 2
fi

# The server follows only reviewed main commits, never unmerged development.
git fetch --quiet origin main
git merge --ff-only origin/main
docker compose config --quiet

previous_container="$(docker compose ps -q scheduler 2>/dev/null || true)"
previous_id=''
if [[ -n "$previous_container" ]]; then
  previous_id="$(docker inspect -f '{{.Image}}' "$previous_container" 2>/dev/null || true)"
fi

docker compose pull --quiet scheduler
published_id="$(docker image inspect -f '{{.Id}}' "$image")"
published_revision="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
expected_revision="$(git rev-parse HEAD)"

# A reviewed main commit may arrive before GitHub Actions finishes publishing.
# Never deploy an old mutable :main tag or one built from another commit.
if [[ "$published_revision" != "$expected_revision" ]]; then
  echo "WAITING: GHCR main image revision does not yet match $expected_revision" >&2
  exit 0
fi

# Avoid repeatedly replacing a known-unhealthy image until a newer image arrives.
if [[ -f "$failed_image_file" && "$previous_id" != "$published_id" ]] &&
   [[ "$(<"$failed_image_file")" == "$published_id" ]]; then
  echo 'SKIPPED: this image previously failed its health check; waiting for a newer image' >&2
  exit 1
fi

# Compose recreates only when image or environment configuration changed.
if docker compose up -d --no-deps --wait --wait-timeout 120 scheduler >/dev/null; then
  current_container="$(docker compose ps -q scheduler)"
  current_id="$(docker inspect -f '{{.Image}}' "$current_container")"
  if [[ "$current_id" == "$published_id" ]]; then
    if [[ "$previous_id" != "$published_id" ]]; then
      echo "DEPLOY_OK: image=$published_id"
    fi
    if [[ -f "$failed_image_file" ]]; then
      rm -- "$failed_image_file"
    fi
    exit 0
  fi
fi

echo 'DEPLOY_FAILED: attempting rollback to previous image' >&2
if [[ -n "$previous_id" && "$previous_id" != "$published_id" ]] &&
   docker image inspect "$previous_id" >/dev/null 2>&1; then
  printf '%s\n' "$published_id" > "$failed_image_file"
  rollback_tag="pasarguard-scheduler:rollback-$(date +%s)"
  docker image tag "$previous_id" "$rollback_tag"
  SCHEDULER_IMAGE="$rollback_tag" docker compose up -d --no-deps --wait --wait-timeout 120 scheduler || true
fi
echo 'FAILED: inspect systemd journal and Docker logs; SQLite was not deleted' >&2
exit 1
