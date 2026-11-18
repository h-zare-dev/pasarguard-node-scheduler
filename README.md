# PasarGuard Node Scheduler

An independent **Docker + SQLite + Telegram** automation service for **PasarGuard 5.6.0**. Version 0.1 is intentionally restricted to **node ID 66 (`IDDidicate-DE`), core 1**.

> **Safety:** `DRY_RUN=true` by default. **No PasarGuard API writes occur** in dry-run, including Telegram button actions. We will not enable live mode or deploy to production without the owner's explicit approval.

## Behavior

| Asia/Tehran time | Desired usage coefficient | Node status |
| --- | --- | --- |
| 02:00–06:59 | `0` | Unchanged |
| 07:00–01:59 | `1` | Unchanged |

- The service reconciles the coefficient at startup and every 60 seconds (configurable within 30–3600 seconds); time comes from `Asia/Tehran`, independent of host timezone. It catches up after restarts and temporary outages and verifies writes through a fresh `GET`.
- **Node status control is separate:** Telegram offers *Enable* (API `connecting`) and *Disable* (`disabled`) after a one-use confirmation. The schedule never changes node status or automatically enables a disabled node.
- Telegram private-chat UI: current status, activity history, manual `0`/`1`, independent node enable/disable, pause/resume, confirmation for every mutation, and failure/success alerts.
- Manual coefficient changes stay effective until the next schedule boundary; at 02:00 or 07:00 the automated schedule takes over again.
- Pausing the schedule first restores coefficient `1` (and refuses to pause if restoration fails). No automated writes while paused.
- SQLite persists settings, audit history, confirmation nonces, Telegram long-poll offset, and an **alert outbox** that retries unsent alerts.
- Uses only Node 24 built-ins (`node:sqlite`); no npm runtime dependencies or exposed HTTP ports.
- Request paths are restricted to `GET /api/node/66` and `PUT /api/node/66`, with partial PUT bodies containing only `usage_coefficient` **or** `status`. Every read validates node ID, exact name and core config ID.

## CI/CD and image delivery

GitHub Actions runs syntax checks, unit/mock tests, Compose validation and a Docker build on every PR. **Only a successful push to `development` or `main` publishes an image** to GitHub Container Registry (GHCR):

| Branch | Mutable image tag | Immutable image tag |
| --- | --- | --- |
| `development` | `ghcr.io/h-zare-dev/pasarguard-node-scheduler:development` | `:sha-<full-commit-sha>` |
| `main` | `:main` and `:latest` | `:sha-<full-commit-sha>` |

The server runs the image from GHCR; **it does not build from source**. For the existing Test-Bot `main` deployment, use the recommended **server-side systemd auto-updater**: every minute it fast-forwards the reviewed `main` branch, waits until GHCR publishes the image labeled with **that exact commit**, pulls it, updates only `scheduler`, checks health and attempts rollback if unhealthy. It does not need GitHub SSH/deploy secrets or touch `.env`/SQLite. See [the one-time setup](docs/deployment.md#recommended-auto-deploy-main-on-test-bot).

An alternative optional SSH deployment job remains in GitHub Actions but is **disabled by default** (`AUTO_DEPLOY_ENABLED` unset). Do not enable both deployment mechanisms for the same host. The owner alone merges PRs; merging to `main` is the auto-deployment trigger.

## Getting started

See **[docs/deployment.md](docs/deployment.md)** for Docker deployment, BotFather, API-key permissions, dry-run validation, backup, rollback, and the explicit live-mode approval gates.

### Local verification (no panel/API credentials needed)

```bash
npm run check
npm test
```

### Start in dry-run Docker mode

After preparing the untracked `.env` (including the two credentials) and `data/` following the deployment guide:

```bash
docker compose config --quiet
docker compose pull scheduler
docker compose up -d
docker compose logs -f --tail=100 scheduler
```

## Safety boundaries / limitations

- Do **not** put credentials in Git, shell history, screenshots, or public issues.
- The bot allows only configured numeric Telegram user IDs **in private chats**. Every mutating command requires a 60-second, single-use confirmation. A fresh API read verifies post-write state.
- `DRY_RUN=false` **alone does not enable writes**. A second explicit `PRODUCTION_WRITE_CONFIRMATION` value is required; see the deployment guide. The owner must approve the switch separately.
- GitHub Actions never receives PasarGuard or Telegram credentials. They remain only in the server's untracked `.env` file (`chmod 600`). Docker environment variables can be inspected by privileged Docker users; choose Docker secrets instead if you need stronger isolation. The CI deploy job is skipped until explicitly configured.
- This v1 does not support any node other than 66 or any rate other than 0/1.
- No process can guarantee an **exact second** of execution during power failures, Internet outages or PasarGuard downtime. This service attempts recovery at each interval and sends alerts. For strict service-level guarantees, use redundant monitoring and an external uptime alert.
- SQLite and polling are single-instance: **do not scale this Compose service above one replica**. Running two instances can lead to competing updates and Telegram `getUpdates` conflicts.
- Disabling a node is a separate action and may affect connectivity. Enable/disable is not part of the recurring schedule.

## Project structure

```text
src/
  config.js       # fail-closed config and double live-write gate
  schedule.js     # Tehran schedule and expiring manual overrides
  pasarguard.js   # minimal, identity-validated API client
  scheduler.js    # serialized reconciliation, verification and alerts
  store.js        # SQLite audit/settings/confirmation/alert outbox
  telegram.js     # allowlisted Telegram controls and long polling
  main.js         # process lifecycle, healthcheck and scheduled retries
test/             # unit and mocked API tests
docs/deployment.md
scripts/deploy.sh # exact-commit GHCR pull and health-checked rollout
scripts/auto-update.sh # reviewed-main GHCR pull, revision check, health check, rollback
scripts/install-auto-update.sh # one-time Test-Bot systemd timer installer
systemd/          # one-minute automatic update service and timer
.github/workflows/ci.yml # tests, GHCR publish, optional SSH deploy
compose.yaml
Dockerfile
```

## License

Private operational project; no open-source license is granted by this repository's contents.
