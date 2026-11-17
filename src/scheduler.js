import { desiredCoefficient, scheduleAt } from './schedule.js';
import { log } from './log.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Scheduler {
  constructor({ config, store, panel, notify = async () => {}, clock = () => new Date() }) {
    this.config = config;
    this.store = store;
    this.panel = panel;
    this.notify = notify;
    this.clock = clock;
    this.queue = Promise.resolve();
    this.notificationQueue = Promise.resolve();
    this.lastPreview = '';
  }

  locked(fn) {
    const work = this.queue.then(fn, fn);
    this.queue = work.catch(() => {});
    return work;
  }

  async alert(message) {
    this.store.enqueueAlert(message);
    await this.flushAlerts();
  }

  async flushAlerts() {
    const work = this.notificationQueue.then(async () => {
      for (const pending of this.store.pendingAlerts()) {
        try {
          await this.notify(pending.message);
          this.store.markAlertDelivered(pending.id);
        } catch {
          this.store.markAlertFailed(pending.id);
          log('warn', { event: 'telegram-notification-pending-retry', alertId: pending.id });
          break; // Keep order; retry after a minute or on restart.
        }
      }
    });
    this.notificationQueue = work.catch(() => {});
    return work;
  }

  async failure(source, operation, error) {
    const message = error instanceof Error ? error.message : 'Unknown failure';
    this.store.addAudit(source, operation, 'error', message);
    log('error', { event: 'operation-failed', source, operation, error: message });
    const last = Number(this.store.getSetting('last_error_alert_at', '0'));
    if (Date.now() - last >= 15 * 60_000) {
      this.store.setSetting('last_error_alert_at', String(Date.now()));
      await this.alert(`⚠️ PasarGuard Scheduler\nNode 66: ${operation} failed.\n${message}\nRetry on next interval.`);
    }
  }

  async verifyCoefficient(value) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const node = await this.panel.getNode();
      if (node.usage_coefficient === value) return node;
      if (attempt !== 2) await sleep(700);
    }
    throw new Error(`Coefficient verification failed; expected ${value}`);
  }

  async setCoefficient(value, source, baseline) {
    if (![0, 1].includes(value)) throw new Error('Unsupported coefficient');
    if (baseline.usage_coefficient === value) return { outcome: 'unchanged', node: baseline };
    if (this.config.dryRun) {
      const signature = `${source}:${value}:${baseline.usage_coefficient}`;
      if (signature !== this.lastPreview) {
        this.store.addAudit(source, 'coefficient', 'dry-run', `${baseline.usage_coefficient} -> ${value}`);
        log('info', { event: 'dry-run', source, operation: 'coefficient', expected: value, actual: baseline.usage_coefficient });
        this.lastPreview = signature;
      }
      return { outcome: 'dry-run', node: baseline };
    }

    await this.panel.updateCoefficient(value);
    const node = await this.verifyCoefficient(value);
    this.store.addAudit(source, 'coefficient', 'applied', `${baseline.usage_coefficient} -> ${value}`);
    log('info', { event: 'coefficient-applied', source, nodeId: 66, expected: value, actual: node.usage_coefficient });
    this.store.setSetting('last_error_alert_at', '0');
    await this.alert(`✅ Node 66 (${source})\nUsage coefficient: ${baseline.usage_coefficient} → ${value}`);
    return { outcome: 'applied', node };
  }

  async reconcile(source = 'timer') {
    return this.locked(async () => {
      try {
        const desired = desiredCoefficient(this.clock(), this.store);
        if (!desired.enabled) return { outcome: 'paused', desired };
        const node = await this.panel.getNode();
        // A disabled node is deliberately not reactivated by coefficient changes.
        if (node.status === 'disabled') return { outcome: 'node-disabled', node, desired };
        const result = await this.setCoefficient(desired.coefficient, source, node);
        return { ...result, desired };
      } catch (error) {
        await this.failure(source, 'reconcile', error);
        throw error;
      }
    });
  }

  async status() {
    const node = await this.panel.getNode();
    const desired = desiredCoefficient(this.clock(), this.store);
    return { node, desired, dryRun: this.config.dryRun };
  }

  async manualCoefficient(value, userId) {
    return this.locked(async () => {
      const source = `telegram:${userId}`;
      try {
        const node = await this.panel.getNode();
        const result = await this.setCoefficient(value, source, node);
        if (!this.config.dryRun) {
          const windowKey = scheduleAt(this.clock()).windowKey;
          this.store.setSetting('manual_override', JSON.stringify({ coefficient: value, windowKey }));
        }
        return result;
      } catch (error) {
        await this.failure(source, 'manual-coefficient', error);
        throw error;
      }
    });
  }

  async changeNodeStatus(status, userId) {
    return this.locked(async () => {
      const source = `telegram:${userId}`;
      try {
        const node = await this.panel.getNode();
        if (this.config.dryRun) {
          this.store.addAudit(source, 'node-status', 'dry-run', `${node.status} -> ${status}`);
          return { outcome: 'dry-run', node };
        }
        const updated = await this.panel.updateStatus(status);
        const observed = await this.panel.getNode();
        const acceptable = status === 'disabled' ? ['disabled'] : ['connecting', 'connected'];
        if (!acceptable.includes(observed.status)) throw new Error(`Node status verification failed: ${observed.status}`);
        this.store.addAudit(source, 'node-status', 'applied', `${node.status} -> ${observed.status}`);
        await this.alert(`✅ Node 66 status (${source}): ${node.status} → ${observed.status}`);
        return { outcome: 'applied', node: observed ?? updated };
      } catch (error) {
        await this.failure(source, 'node-status', error);
        throw error;
      }
    });
  }

  async setAutomation(enabled, userId) {
    return this.locked(async () => {
      const source = `telegram:${userId}`;
      try {
        if (!enabled) {
          const node = await this.panel.getNode();
          // Pausing must never silently leave the special nighttime rate in place,
          // even if the node happens to be disabled at this moment.
          const result = await this.setCoefficient(1, source, node);
          if (result.outcome === 'dry-run') return { outcome: 'dry-run', enabled: true };
        }
        if (this.config.dryRun) return { outcome: 'dry-run', enabled };
        this.store.setSetting('automation_enabled', String(enabled));
        this.store.setSetting('manual_override', '');
        this.store.addAudit(source, 'automation', 'applied', enabled ? 'resumed' : 'paused (normal restored)');
        await this.alert(`ℹ️ Node 66 schedule ${enabled ? 'resumed' : 'paused (normal coefficient restored)'}`);
        return { outcome: 'applied', enabled };
      } catch (error) {
        await this.failure(source, 'automation', error);
        throw error;
      }
    });
  }
}
