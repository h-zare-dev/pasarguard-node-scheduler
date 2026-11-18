import { readFileSync } from 'node:fs';

export const TARGET = Object.freeze({ id: 66, name: 'IDDidicate-DE', coreConfigId: 1 });
export const LIVE_APPROVAL = 'I_APPROVE_NODE_66_WRITES';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received ${JSON.stringify(value)}`);
}

function integer(value, fallback, min, max) {
  const result = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`Invalid integer setting (allowed range ${min}..${max})`);
  }
  return result;
}

function secret(env, name, readSecretFile) {
  const file = env[`${name}_FILE`];
  if (file && env[name]) throw new Error(`Provide ${name} or ${name}_FILE, not both`);
  const value = file ? readSecretFile(file, 'utf8').trim() : (env[name] ?? '').trim();
  if (!value) throw new Error(`Missing secret ${name} or ${name}_FILE`);
  return value;
}

export function loadConfig(env = process.env, readSecretFile = readFileSync) {
  const targetNodeId = integer(env.TARGET_NODE_ID, TARGET.id, 1, 1_000_000);
  const coreConfigId = integer(env.TARGET_CORE_CONFIG_ID, TARGET.coreConfigId, 1, 1_000_000);
  const targetNodeName = env.TARGET_NODE_NAME ?? TARGET.name;
  if (targetNodeId !== TARGET.id || targetNodeName !== TARGET.name || coreConfigId !== TARGET.coreConfigId) {
    throw new Error('This v1 build is hard-locked to node 66 (IDDidicate-DE), core 1');
  }

  const normalCoefficient = Number(env.NORMAL_COEFFICIENT ?? '1');
  const nightCoefficient = Number(env.NIGHT_COEFFICIENT ?? '0');
  if (normalCoefficient !== 1 || nightCoefficient !== 0) {
    throw new Error('This v1 build only supports normal coefficient 1 and night coefficient 0');
  }

  const timezone = env.SCHEDULE_TIMEZONE ?? 'Asia/Tehran';
  const nightStart = env.NIGHT_START ?? '02:00';
  const nightEnd = env.NIGHT_END ?? '07:00';
  if (timezone !== 'Asia/Tehran' || nightStart !== '02:00' || nightEnd !== '07:00') {
    throw new Error('This v1 build is fixed to 02:00–07:00 Asia/Tehran');
  }

  if (!env.PANEL_BASE_URL) throw new Error('PANEL_BASE_URL is required');
  const panelBaseUrl = new URL(env.PANEL_BASE_URL);
  if (panelBaseUrl.protocol !== 'https:' || panelBaseUrl.username || panelBaseUrl.password ||
      panelBaseUrl.search || panelBaseUrl.hash || panelBaseUrl.pathname !== '/') {
    throw new Error('PANEL_BASE_URL must be an HTTPS origin without credentials or path');
  }

  const dryRun = bool(env.DRY_RUN, true);
  const liveApproved = env.PRODUCTION_WRITE_CONFIRMATION === LIVE_APPROVAL;
  if (!dryRun && !liveApproved) {
    throw new Error('Live mode requires explicit PRODUCTION_WRITE_CONFIRMATION for node 66');
  }

  const allowedUserIds = [...new Set((env.TELEGRAM_ALLOWED_USER_IDS ?? '')
    .split(',').map((item) => item.trim()).filter(Boolean).map((item) => integer(item, 0, 1, Number.MAX_SAFE_INTEGER)))];
  if (allowedUserIds.length === 0) throw new Error('TELEGRAM_ALLOWED_USER_IDS cannot be empty');

  const alertChatId = env.TELEGRAM_ALERT_CHAT_ID
    ? integer(env.TELEGRAM_ALERT_CHAT_ID, 0, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    : allowedUserIds[0];

  return Object.freeze({
    target: TARGET,
    panelBaseUrl: panelBaseUrl.origin,
    panelApiKey: secret(env, 'PANEL_API_KEY', readSecretFile),
    botToken: secret(env, 'TELEGRAM_BOT_TOKEN', readSecretFile),
    allowedUserIds,
    alertChatId,
    timezone,
    nightStart,
    nightEnd,
    normalCoefficient,
    nightCoefficient,
    checkIntervalMs: integer(env.CHECK_INTERVAL_SECONDS, 60, 30, 3600) * 1000,
    databasePath: env.DATABASE_PATH ?? '/data/scheduler.sqlite',
    dryRun,
    liveApproved,
  });
}
