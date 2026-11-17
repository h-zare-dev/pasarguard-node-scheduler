const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function tehranParts(date = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute),
  };
}

function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function scheduleAt(date = new Date()) {
  const local = tehranParts(date);
  const minutes = local.hour * 60 + local.minute;
  const night = minutes >= 120 && minutes < 420;
  // A normal window runs from 07:00 through 01:59 the next calendar day.
  const normalDay = minutes < 120
    ? new Date(Date.UTC(local.year, local.month - 1, local.day - 1))
    : null;
  const windowKey = night
    ? `night:${dateKey(local)}`
    : `normal:${normalDay ? dateKey({ year: normalDay.getUTCFullYear(), month: normalDay.getUTCMonth() + 1, day: normalDay.getUTCDate() }) : dateKey(local)}`;
  return { night, coefficient: night ? 0 : 1, windowKey,
    localTime: `${dateKey(local)} ${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}` };
}

export function desiredCoefficient(now, store) {
  const schedule = scheduleAt(now);
  if (store.getSetting('automation_enabled', 'true') !== 'true') {
    return { ...schedule, enabled: false, source: 'paused' };
  }
  const override = store.getSetting('manual_override', '');
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (parsed.windowKey === schedule.windowKey && (parsed.coefficient === 0 || parsed.coefficient === 1)) {
        return { ...schedule, coefficient: parsed.coefficient, enabled: true, source: 'manual-override' };
      }
    } catch { /* Invalid historic state falls back to schedule. */ }
  }
  return { ...schedule, enabled: true, source: 'schedule' };
}
