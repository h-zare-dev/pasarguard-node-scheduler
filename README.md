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

## Getting started

See **[docs/deployment.md](docs/deployment.md)** for Docker deployment, BotFather, API-key permissions, dry-run validation, backup, rollback, and the explicit live-mode approval gates.

### Local verification (no panel/API credentials needed)

```bash
npm run check
npm test
```

### Start in dry-run Docker mode

After preparing `.env`, `secrets/`, and `data/` following the deployment guide:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose logs -f --tail=100 scheduler
```

## Safety boundaries / limitations

- Do **not** put credentials in Git, shell history, screenshots, or public issues.
- The bot allows only configured numeric Telegram user IDs **in private chats**. Every mutating command requires a 60-second, single-use confirmation. A fresh API read verifies post-write state.
- `DRY_RUN=false` **alone does not enable writes**. A second explicit `PRODUCTION_WRITE_CONFIRMATION` value is required; see the deployment guide. The owner must approve the switch separately.
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
compose.yaml
Dockerfile
```

## License

Private operational project; no open-source license is granted by this repository's contents.
