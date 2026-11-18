import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, LIVE_APPROVAL } from '../src/config.js';

const base = {
  PANEL_BASE_URL: 'https://example.com', PANEL_API_KEY: 'mock-key',
  TELEGRAM_BOT_TOKEN: 'mock-token', TELEGRAM_ALLOWED_USER_IDS: '1234',
};

test('dry-run is default; no accidental production writes', () => {
  const config = loadConfig(base);
  assert.equal(config.dryRun, true);
  assert.deepEqual(config.target, { id: 66, name: 'IDDidicate-DE', coreConfigId: 1 });
  assert.throws(() => loadConfig({ ...base, DRY_RUN: 'false' }), /requires explicit/);
  assert.equal(loadConfig({ ...base, DRY_RUN: 'false', PRODUCTION_WRITE_CONFIRMATION: LIVE_APPROVAL }).dryRun, false);
});

test('identity, schedule, origin, and secrets fail closed', () => {
  assert.throws(() => loadConfig({ ...base, TARGET_NODE_ID: '67' }), /hard-locked/);
  assert.throws(() => loadConfig({ ...base, TARGET_NODE_NAME: 'other' }), /hard-locked/);
  assert.throws(() => loadConfig({ ...base, NIGHT_END: '06:00' }), /fixed/);
  assert.throws(() => loadConfig({ ...base, PANEL_BASE_URL: 'http://example.com' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...base, PANEL_BASE_URL: 'https://example.com/api/' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...base, TELEGRAM_ALLOWED_USER_IDS: '' }), /cannot be empty/);
  assert.throws(() => loadConfig({ ...base, PANEL_API_KEY_FILE: '/mock' }, () => 'file-key'), /not both/);
  const fromFile = loadConfig({ ...base, PANEL_API_KEY: undefined, PANEL_API_KEY_FILE: '/mock' }, () => 'file-key');
  assert.equal(fromFile.panelApiKey, 'file-key');
});
