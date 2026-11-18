import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramBot } from '../src/telegram.js';
import { Store } from '../src/store.js';

test('only allowlisted private user can create one-time confirmed actions', async () => {
  const store = new Store(':memory:');
  const messages = [];
  const invoked = [];
  const scheduler = {
    status: async () => ({ node: { id: 66, name: 'IDDidicate-DE', status: 'connected', usage_coefficient: 1 },
      desired: { coefficient: 0, source: 'schedule', enabled: true, localTime: '2026-11-17 02:00' }, dryRun: true }),
    changeNodeStatus: async (status, userId) => { invoked.push([status, userId]); return { outcome: 'dry-run' }; },
  };
  const bot = new TelegramBot({
    config: { botToken: 'fake-token', alertChatId: 1234, allowedUserIds: [1234], dryRun: true }, store, scheduler,
    fetcher: async (url, req) => {
      const method = url.slice(url.lastIndexOf('/') + 1);
      const payload = JSON.parse(req.body);
      messages.push({ method, payload });
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    },
  });
  try {
    await bot.handle({ message: { from: { id: 999 }, chat: { id: 999, type: 'private' }, text: '/start' } });
    assert.equal(messages.length, 0);
    await bot.handle({ message: { from: { id: 1234 }, chat: { id: 1234, type: 'private' }, text: '/start' } });
    assert.match(messages.at(-1).payload.text, /DRY-RUN/);
    const button = (id, data) => ({ callback_query: { id, from: { id: 1234 },
      message: { chat: { id: 1234, type: 'private' } }, data } });
    await bot.handle(button('one', 'do:disable'));
    const nonce = messages.at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data;
    assert.match(nonce, /^confirm:/);
    assert.deepEqual(invoked, []);
    await bot.handle(button('two', nonce));
    assert.deepEqual(invoked, [['disabled', 1234]]);
    await bot.handle(button('three', nonce));
    assert.deepEqual(invoked, [['disabled', 1234]]);
    assert.match(messages.at(-1).payload.text, /already used/);
  } finally { store.close(); }
});

test('notifications retain pending state when delivery is unavailable', async () => {
  const { Scheduler } = await import('../src/scheduler.js');
  const store = new Store(':memory:');
  let available = false;
  const scheduler = new Scheduler({ config: { dryRun: true }, store, panel: {},
    notify: async () => { if (!available) throw new Error('unavailable'); } });
  try {
    await scheduler.alert('important');
    assert.equal(store.pendingAlerts().length, 1);
    available = true;
    await scheduler.flushAlerts();
    assert.equal(store.pendingAlerts().length, 0);
  } finally { store.close(); }
});
