import { writeFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { Store } from './store.js';
import { PasarGuardClient } from './pasarguard.js';
import { Scheduler } from './scheduler.js';
import { TelegramBot } from './telegram.js';

const config = loadConfig();
const store = new Store(config.databasePath);
const panel = new PasarGuardClient(config);
const abortController = new AbortController();
let timer;
let busy = false;
let stopped = false;

const scheduler = new Scheduler({
  config, store, panel,
  notify: async (message) => bot.alert(message),
});
const bot = new TelegramBot({ config, store, scheduler });

async function tick() {
  if (busy || stopped) return;
  busy = true;
  try {
    const result = await scheduler.reconcile();
    if (result.outcome === 'node-disabled') log('info', { event: 'node-disabled-schedule-skipped', nodeId: 66 });
  } catch { /* Scheduled next interval; failure already audited and alerted. */ }
  finally {
    try { await scheduler.flushAlerts(); }
    catch { log('warn', { event: 'alert-retry-failed' }); }
    try { writeFileSync('/data/heartbeat', String(Date.now())); }
    catch { log('warn', { event: 'healthcheck-heartbeat-failed' }); }
    busy = false;
  }
}

async function shutdown() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  abortController.abort();
  log('info', { event: 'shutdown-requested' });
  // Wait for serialized writes, but honor Docker's 35-second stop grace.
  await Promise.race([Promise.all([scheduler.queue, scheduler.notificationQueue]), new Promise((resolve) => setTimeout(resolve, 15000))]);
  store.close();
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });

log('info', { event: 'scheduler-started', mode: config.dryRun ? 'dry-run' : 'live', nodeId: 66,
  timezone: config.timezone, intervalMs: config.checkIntervalMs });
await tick();
timer = setInterval(() => { void tick(); }, config.checkIntervalMs);
void bot.run(abortController.signal);
