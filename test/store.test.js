import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';

test('SQLite settings and audit persist; confirmations are one-use, per-user and time-bound', () => {
  const store = new Store(':memory:');
  try {
    store.setSetting('automation_enabled', 'false');
    assert.equal(store.getSetting('automation_enabled'), 'false');
    store.addAudit('test', 'coefficient', 'dry-run', '1 -> 0');
    assert.equal(store.recentAudit()[0].outcome, 'dry-run');
    const token = store.createConfirmation(123, 'disable', 1_000);
    assert.equal(store.consumeConfirmation(token, 456, 1_001), null);
    assert.equal(store.consumeConfirmation(token, 123, 1_001), 'disable');
    assert.equal(store.consumeConfirmation(token, 123, 1_001), null);
    const expired = store.createConfirmation(123, 'enable', 1_000);
    assert.equal(store.consumeConfirmation(expired, 123, 70_000), null);
    store.enqueueAlert('network down');
    const alert = store.pendingAlerts()[0];
    assert.equal(alert.message, 'network down');
    store.markAlertFailed(alert.id);
    assert.equal(store.pendingAlerts().length, 1);
    store.markAlertDelivered(alert.id);
    assert.deepEqual(store.pendingAlerts(), []);
  } finally { store.close(); }
});
