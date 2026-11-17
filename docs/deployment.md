# Dry-run deployment and operations

These are commands for an Ubuntu Linux host already running Docker Engine + Docker Compose v2. The service is **isolated** and does not need direct access to PasarGuard's database or Docker socket. All times mean `Asia/Tehran`.

## 1. Get source and prepare data

```bash
sudo mkdir -p /opt/pasarguard-node-scheduler
sudo chown "$(id -u):$(id -g)" /opt/pasarguard-node-scheduler
git clone https://github.com/h-zare-dev/pasarguard-node-scheduler.git /opt/pasarguard-node-scheduler
cd /opt/pasarguard-node-scheduler
cp .env.example .env
mkdir -p secrets data
sudo chown 1000:1000 data
sudo chmod 700 data
chmod 600 .env
```

If a user chose the cloned directory beforehand, do not overwrite it. **Until the code is merged into `main`, use the implementation branch (for example `git switch development`);** a draft PR is not deployed automatically.

## 2. Create the secrets (never paste tokens into chat)

Create a PasarGuard API key in **API Keys** with only `nodes.read` and `nodes.update`. This app does not need database, users or admin permissions. Use the **new dedicated Telegram bot token** from BotFather.

```bash
sudo touch secrets/panel_api_key secrets/telegram_bot_token
sudo chown root:1000 secrets/panel_api_key secrets/telegram_bot_token
sudo chmod 640 secrets/panel_api_key secrets/telegram_bot_token
sudo nano secrets/panel_api_key
sudo nano secrets/telegram_bot_token
```

Why `root:1000 / 0640`? The container deliberately runs as the unprivileged `node` user (UID/GID 1000). File-backed Compose secrets are bind-mounted on Linux, so the group must be readable inside the container while remaining protected from other host users.

Find your Telegram numeric user ID using a **trusted** method, e.g. your own Telegram Bot API `getUpdates` after sending `/start`, or a reputable user-ID bot. Use only the numeric `from.id`, not a username. The bot can send notifications only after you **open its private chat and send `/start`**.

Edit `.env` using `nano .env`:

```dotenv
PANEL_BASE_URL=https://YOUR-PANEL.example.com
TELEGRAM_ALLOWED_USER_IDS=YOUR_NUMERIC_TELEGRAM_USER_ID
TELEGRAM_ALERT_CHAT_ID=YOUR_NUMERIC_TELEGRAM_USER_ID
DRY_RUN=true
PRODUCTION_WRITE_CONFIRMATION=NO
```

Leave the target ID, name, core, coefficient values, and Tehran schedule from `.env.example` unchanged. Never put the secrets themselves in `.env`; leave their `*_FILE` settings in place. Optional: review the `PANEL_BASE_URL` TLS certificate and DNS resolution from the host before starting.

## 3. Start / validate without production writes

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 scheduler
```

Expected startup log has `"mode":"dry-run"` and `"nodeId":66`. The scheduled GET reads real node status but writes **nothing**. At Tehran 02:00–07:00, with coefficient still `1`, audit/log should indicate what **would** change; the actual panel stays at `1`.

In Telegram, send `/start` and test these buttons:

1. **Status**: verify `Node #66`, the current coefficient, and `DRY-RUN`.
2. **Coefficient 0** then **Confirm**: receive *Simulated*; verify panel rate unchanged.
3. **Disable node** then **Confirm**: receive *Simulated*; verify node remains online.
4. **Recent activity**: ensure dry-run entries appear. Check logs and `docker compose ps` for healthy status.

All operations target **only** node ID 66. Failure to verify its name or core configuration is a hard stop and creates an alert. No other running PasarGuard Docker container or service is restarted by this app.

## 4. Monitoring / troubleshooting

```bash
docker compose ps
docker compose logs -f --tail=100 scheduler
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q scheduler)"
```

Key cases:

- `HTTP 401/403`: check API key and only the required read/update permissions.
- `Node identity mismatch`: **stop here**; do not change safety locks to make it work. Inspect ID/name/core in the panel.
- Telegram bot does not respond: open the bot and send `/start`; check `TELEGRAM_ALLOWED_USER_IDS`. Only private chat is accepted. The Telegram token must belong to this bot and no second long-polling instance can run simultaneously.
- `permission denied /data`: ensure `data/` is writable by UID 1000.
- `permission denied /run/secrets/`: verify group 1000 and host file mode `0640`.
- Pending Telegram alerts persist in SQLite and retry every interval. If Telegram credentials/network are incorrect, fix them without deleting `data/`.
- After panel connectivity resumes, the next interval reconciles the **current Tehran-time** target. Nothing auto-enables a disabled node.

## 5. Backups / restore

To get a consistent SQLite backup without a separate SQLite CLI, briefly stop just this scheduler container, copy its data directory, and restart:

```bash
cd /opt/pasarguard-node-scheduler
docker compose stop scheduler
sudo cp -a data "data.backup.$(date -u +%Y%m%dT%H%M%SZ)"
docker compose up -d scheduler
```

This pauses scheduling during the backup; on restart, reconciliation catches up. An alternative is to implement an online SQLite backup command for future versions. Keep backups outside the Git repository and protect Telegram user IDs, audit entries and secrets. Check the backup directory permissions.

## 6. Update or rollback safely

```bash
cd /opt/pasarguard-node-scheduler
git pull --ff-only
docker compose build
docker compose up -d
docker compose ps
```

For an emergency **without destructive changes to data**, first set `DRY_RUN=true` and `PRODUCTION_WRITE_CONFIRMATION=NO` in `.env`, then restart only this service:

```bash
docker compose up -d --force-recreate scheduler
```

**Important:** Switching to dry-run stops subsequent writes but **does not immediately restore** any already-applied nighttime coefficient. If necessary, restore coefficient `1` manually in the PasarGuard UI and check it. If you stop the service altogether, it cannot apply the scheduled 07:00 restoration; always inspect the panel after stopping.

## 7. Live mode is a separate, explicitly approved future step

**Do not perform this step until the owner explicitly approves production writes after dry-run review.** Once approved, live operation requires setting both:

```dotenv
DRY_RUN=false
PRODUCTION_WRITE_CONFIRMATION=I_APPROVE_NODE_66_WRITES
```

Then `docker compose up -d --force-recreate scheduler` picks up the configuration. The scheduler does a read, applies only a missing `0`/`1` coefficient with a partial PUT, verifies a subsequent read, and alerts on success or failure. Telegram changes independently require another button confirmation. Switching between dry-run and live is never automated.

There are no guarantees of second-perfect execution if the server, Telegram, DNS, or PasarGuard is unavailable. Monitor panel reachability and ensure a reliable host clock (NTP). For stronger assurance, set up a separate uptime alert outside this host.
