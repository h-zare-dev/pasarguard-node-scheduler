import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Scheduler } from '../src/scheduler.js';

const atTehran = (hour, minute = 0) => new Date(Date.UTC(2026, 10, 17, hour, minute) - 3.5 * 3600000);

function setup({ dryRun, hour, status = 'connected', coefficient = 1 }) {
  const store = new Store(':memory:');
  const calls = [];
  let current = { id: 66, name: 'IDDidicate-DE', core_config_id: 1,
    usage_coefficient: coefficient, status };
  const panel = {
    async getNode() { calls.push('GET'); return { ...current }; },
    async updateCoefficient(value) {
      calls.push(`PUT coefficient ${value}`); current = { ...current, usage_coefficient: value }; return { ...current };
    },
    async updateStatus(value) {
      calls.push(`PUT status ${value}`); current = { ...current, status: value }; return { ...current };
    },
  };
  const alerts = [];
  const scheduler = new Scheduler({
    config: { dryRun }, store, panel, clock: () => atTehran(hour), notify: async (message) => alerts.push(message),
  });
  return { scheduler, store, calls, alerts };
}

test('dry-run never performs PUT, including manual and node status operations', async () => {
  const { scheduler, store, calls } = setup({ dryRun: true, hour: 2 });
  try {
    assert.equal((await scheduler.reconcile()).outcome, 'dry-run');
    assert.equal((await scheduler.manualCoefficient(0, 123)).outcome, 'dry-run');
    assert.equal((await scheduler.changeNodeStatus('disabled', 123)).outcome, 'dry-run');
    assert.equal((await scheduler.setAutomation(false, 123)).outcome, 'dry-run');
    assert.deepEqual(calls.filter((c) => c.startsWith('PUT')), []);
    assert.equal(store.getSetting('automation_enabled', 'true'), 'true');
    assert.ok(store.recentAudit().some((item) => item.outcome === 'dry-run'));
  } finally { store.close(); }
});

test('live reconciliation updates only necessary coefficient and verifies', async () => {
  const { scheduler, store, calls, alerts } = setup({ dryRun: false, hour: 2 });
  try {
    assert.equal((await scheduler.reconcile()).outcome, 'applied');
    assert.equal((await scheduler.reconcile()).outcome, 'unchanged');
    assert.deepEqual(calls.filter((c) => c.startsWith('PUT')), ['PUT coefficient 0']);
    assert.equal(alerts.length, 1);
  } finally { store.close(); }
});

test('disabled node still receives scheduled coefficient; status remains independent', async () => {
  const { scheduler, store, calls } = setup({ dryRun: false, hour: 2, status: 'disabled' });
  try {
    assert.equal((await scheduler.reconcile()).outcome, 'applied');
    assert.equal((await scheduler.changeNodeStatus('connecting', 123)).outcome, 'applied');
    assert.deepEqual(calls.filter((c) => c.startsWith('PUT')), ['PUT coefficient 0', 'PUT status connecting']);
  } finally { store.close(); }
});

test('07:00 restores coefficient even when node is disabled', async () => {
  const { scheduler, store, calls } = setup({ dryRun: false, hour: 7, status: 'disabled', coefficient: 0 });
  try {
    assert.equal((await scheduler.reconcile()).outcome, 'applied');
    assert.deepEqual(calls.filter((c) => c.startsWith('PUT')), ['PUT coefficient 1']);
  } finally { store.close(); }
});

test('pausing automation restores coefficient 1 then persists pause', async () => {
  const { scheduler, store, calls } = setup({ dryRun: false, hour: 2, coefficient: 0 });
  try {
    assert.equal((await scheduler.setAutomation(false, 123)).outcome, 'applied');
    assert.ok(calls.includes('PUT coefficient 1'));
    assert.equal(store.getSetting('automation_enabled'), 'false');
    assert.equal((await scheduler.reconcile()).outcome, 'paused');
  } finally { store.close(); }
});
