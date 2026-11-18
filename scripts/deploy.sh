#!/usr/bin/env bash
# Executed remotely by CI over a pinned SSH host key, not by Docker itself.
# The server needs a checked-out Git branch, Docker Compose, and local secrets.
set -Eeuo pipefail

branch="${1:-}"
commit="${2:-}"
deploy_dir="${3:-}"

if [[ ! "$branch" =~ ^(main|development)$ ]] ||
   [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]] ||
   [[ ! "$deploy_dir" =~ ^/opt/[a-zA-Z0-9/_-]+$ ]]; then
  echo 'Invalid branch, commit, or deployment directory' >&2
  exit 2
fi

if [[ ! -d "$deploy_dir/.git" || ! -f "$deploy_dir/.env" ]]; then
  echo 'Server is not bootstrapped; refusing deployment' >&2
  exit 2
fi

if [[ "$(git -C "$deploy_dir" branch --show-current)" != "$branch" ]]; then
  echo 'Checked-out branch does not match the deployment branch' >&2
  exit 2
fi

# Automated deploy must not silently turn on live PasarGuard writes.
# A live-mode rollout needs a second, explicit marker placed by the owner.
dry_run_count="$(grep -c '^DRY_RUN=' "$deploy_dir/.env" || true)"
if { [[ "$dry_run_count" != '1' ]] || ! grep -qx 'DRY_RUN=true' "$deploy_dir/.env"; } &&
   [[ ! -f "$deploy_dir/.auto-deploy-live-approved" ]]; then
  echo 'Automated deployment blocked: dry-run not confirmed and no owner approval marker' >&2
  exit 2
fi

git -C "$deploy_dir" fetch origin "$branch"
git -C "$deploy_dir" merge --ff-only FETCH_HEAD
if [[ "$(git -C "$deploy_dir" rev-parse HEAD)" != "$commit" ]]; then
  echo 'Git head is not the exact commit published by CI; refusing deployment' >&2
  exit 2
fi

cd "$deploy_dir"
export SCHEDULER_IMAGE="ghcr.io/h-zare-dev/pasarguard-node-scheduler:sha-$commit"

docker compose config --quiet

previous_container="$(docker compose ps -q scheduler 2>/dev/null || true)"
previous_image=''
if [[ -n "$previous_container" ]]; then
  previous_image="$(docker inspect -f '{{.Image}}' "$previous_container" 2>/dev/null || true)"
fi

docker compose pull scheduler

if docker compose up -d --no-deps --wait --wait-timeout 120 scheduler; then
  echo "DEPLOY_OK: commit=$commit service=scheduler"
  exit 0
fi

echo 'New image was unhealthy; attempting a non-destructive rollback' >&2
if [[ -n "$previous_image" ]] && docker image inspect "$previous_image" >/dev/null 2>&1; then
  rollback_tag="pasarguard-node-scheduler:rollback-$(date +%s)"
  docker image tag "$previous_image" "$rollback_tag"
  export SCHEDULER_IMAGE="$rollback_tag"
  docker compose up -d --no-deps --wait --wait-timeout 120 scheduler || true
fi
echo 'DEPLOY_FAILED: review container health and logs; existing data was preserved' >&2
exit 1
