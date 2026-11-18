import { log } from './log.js';

const ACTIONS = Object.freeze({
  zero: { title: 'Set coefficient to 0', execute: (scheduler, id) => scheduler.manualCoefficient(0, id) },
  normal: { title: 'Set coefficient to 1', execute: (scheduler, id) => scheduler.manualCoefficient(1, id) },
  disable: { title: 'Disable node', execute: (scheduler, id) => scheduler.changeNodeStatus('disabled', id) },
  enable: { title: 'Enable node', execute: (scheduler, id) => scheduler.changeNodeStatus('connecting', id) },
  pause: { title: 'Pause automation (restore coefficient 1)', execute: (scheduler, id) => scheduler.setAutomation(false, id) },
  resume: { title: 'Resume automation', execute: (scheduler, id) => scheduler.setAutomation(true, id) },
});

const keyboard = { inline_keyboard: [
  [{ text: '📊 Status', callback_data: 'status' }, { text: '📜 Recent activity', callback_data: 'history' }],
  [{ text: '🌙 Coefficient 0', callback_data: 'do:zero' }, { text: '☀️ Coefficient 1', callback_data: 'do:normal' }],
  [{ text: '🛑 Disable node', callback_data: 'do:disable' }, { text: '✅ Enable node', callback_data: 'do:enable' }],
  [{ text: '⏸ Pause schedule', callback_data: 'do:pause' }, { text: '▶️ Resume schedule', callback_data: 'do:resume' }],
] };

export class TelegramBot {
  constructor({ config, store, scheduler, fetcher = globalThis.fetch }) {
    this.config = config;
    this.store = store;
    this.scheduler = scheduler;
    this.fetcher = fetcher;
  }

  async api(method, payload = {}, timeoutMs = 12000) {
    let response;
    try {
      response = await this.fetcher(`https://api.telegram.org/bot${this.config.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { throw new Error(`Telegram ${method} transport failed`); }
    if (!response.ok) throw new Error(`Telegram ${method} returned HTTP ${response.status}`);
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`Telegram ${method} invalid response`); }
    if (!data.ok) throw new Error(`Telegram ${method} rejected request`);
    return data.result;
  }

  async send(chatId, text, replyMarkup = keyboard) {
    return this.api('sendMessage', {
      chat_id: chatId, text: text.slice(0, 3900),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async alert(text) {
    return this.send(this.config.alertChatId, text, null);
  }

  async statusText() {
    const { node, desired, dryRun } = await this.scheduler.status();
    return [
      '🖥 PasarGuard Node Scheduler',
      `Mode: ${dryRun ? '🧪 DRY-RUN (no panel writes)' : '🔴 LIVE'}`,
      `Node: ${node.name} (#${node.id})`,
      `Connection: ${node.status}`,
      `Current coefficient: ${node.usage_coefficient}`,
      `Desired coefficient: ${desired.coefficient} (${desired.source})`,
      `Automation: ${desired.enabled ? 'ON' : 'PAUSED'}`,
      `Tehran: ${desired.localTime}`,
      'Schedule: 02:00→0, 07:00→1 (Asia/Tehran)',
    ].join('\n');
  }

  async historyText() {
    const history = this.store.recentAudit(10);
    if (!history.length) return 'No recorded activity yet.';
    return `📜 Last ${history.length} events:\n` + history.map((e) =>
      `${e.created_at}\n${e.operation} [${e.outcome}] (${e.source}) ${e.detail}`,
    ).join('\n\n');
  }

  async handle(update) {
    const message = update.message;
    const callback = update.callback_query;
    const userId = message?.from?.id ?? callback?.from?.id;
    const chatId = message?.chat?.id ?? callback?.message?.chat?.id;
    const chatType = message?.chat?.type ?? callback?.message?.chat?.type;
    if (!this.config.allowedUserIds.includes(userId) || chatType !== 'private' || chatId !== userId) {
      if (callback) await this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Access denied.', show_alert: true });
      log('warn', { event: 'unauthorized-telegram-update' });
      return;
    }

    if (message) {
      const command = (message.text ?? '').split(' ')[0].split('@')[0];
      if (command === '/history') await this.send(chatId, await this.historyText());
      else await this.send(chatId, await this.statusText());
      return;
    }
    if (!callback) return;
    await this.api('answerCallbackQuery', { callback_query_id: callback.id });
    if (callback.data === 'status') return this.send(chatId, await this.statusText());
    if (callback.data === 'history') return this.send(chatId, await this.historyText());

    if (callback.data?.startsWith('do:')) {
      const action = callback.data.slice(3);
      if (!Object.hasOwn(ACTIONS, action)) return;
      const nonce = this.store.createConfirmation(userId, action);
      return this.send(chatId, `⚠️ Confirm: ${ACTIONS[action].title} for node #66?\nExpires in 60 seconds.\nMode: ${this.config.dryRun ? 'DRY-RUN' : 'LIVE (changes panel)'}`, {
        inline_keyboard: [[
          { text: '✅ Confirm', callback_data: `confirm:${nonce}` },
          { text: '❌ Cancel', callback_data: 'cancel' },
        ]],
      });
    }
    if (callback.data === 'cancel') return this.send(chatId, 'Cancelled.');
    if (callback.data?.startsWith('confirm:')) {
      const nonce = callback.data.slice(8);
      const action = this.store.consumeConfirmation(nonce, userId);
      if (!action || !Object.hasOwn(ACTIONS, action)) return this.send(chatId, 'Confirmation expired or already used.');
      try {
        const result = await ACTIONS[action].execute(this.scheduler, userId);
        await this.send(chatId, `${result.outcome === 'dry-run' ? '🧪 Simulated' : '✅ Completed'}: ${ACTIONS[action].title}\nResult: ${result.outcome}\n${this.config.dryRun ? 'No changes were made to PasarGuard.' : ''}`);
      } catch {
        // Detailed sanitized failure has been recorded and alerted by Scheduler.
        await this.send(chatId, `⚠️ ${ACTIONS[action].title} failed. Check recent activity and alerts.`);
      }
    }
  }

  async run(signal) {
    log('info', { event: 'telegram-polling-started' });
    while (!signal.aborted) {
      try {
        const offset = Number(this.store.getSetting('telegram_offset', '0'));
        const updates = await this.api('getUpdates', {
          offset, timeout: 20, allowed_updates: ['message', 'callback_query'], limit: 30,
        }, 28000);
        if (!Array.isArray(updates)) throw new Error('Telegram getUpdates returned unexpected data');
        for (const update of updates) {
          try { await this.handle(update); }
          catch (error) {
            log('error', { event: 'telegram-update-error', error: error.message });
            this.store.addAudit('telegram', 'update', 'error', 'Telegram update processing failed');
          } finally {
            this.store.setSetting('telegram_offset', String(update.update_id + 1));
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        log('error', { event: 'telegram-poll-error', error: error.message });
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 5000);
          signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    }
  }
}
