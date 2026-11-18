import test from 'node:test';
import assert from 'node:assert/strict';
import { desiredCoefficient, scheduleAt, tehranParts } from '../src/schedule.js';

const atTehran = (hour, minute, day = 17) =>
  new Date(Date.UTC(2026, 10, day, hour, minute) - 3.5 * 60 * 60 * 1000);

test('02:00 inclusive and 07:00 exclusive in Tehran regardless of host TZ', () => {
  assert.equal(scheduleAt(atTehran(1, 59)).coefficient, 1);
  assert.equal(scheduleAt(atTehran(2, 0)).coefficient, 0);
  assert.equal(scheduleAt(atTehran(6, 59)).coefficient, 0);
  assert.equal(scheduleAt(atTehran(7, 0)).coefficient, 1);
  assert.equal(scheduleAt(atTehran(23, 59)).coefficient, 1);
  assert.equal(scheduleAt(atTehran(0, 30)).coefficient, 1);
  assert.deepEqual(tehranParts(atTehran(7, 0)).hour, 7);
});

test('normal window spans midnight; override expires at 02:00 or 07:00', () => {
  const normal = scheduleAt(atTehran(23, 59));
  assert.equal(normal.windowKey, scheduleAt(atTehran(1, 59, 18)).windowKey);
  const settings = new Map([['automation_enabled', 'true'],
    ['manual_override', JSON.stringify({ coefficient: 0, windowKey: normal.windowKey })]]);
  const store = { getSetting: (key, fallback) => settings.get(key) ?? fallback };
  assert.equal(desiredCoefficient(atTehran(1, 59, 18), store).coefficient, 0);
  assert.equal(desiredCoefficient(atTehran(2, 0, 18), store).source, 'schedule');
  assert.equal(desiredCoefficient(atTehran(7, 0, 18), store).coefficient, 1);
  settings.set('automation_enabled', 'false');
  assert.equal(desiredCoefficient(atTehran(2, 0, 18), store).enabled, false);
});
