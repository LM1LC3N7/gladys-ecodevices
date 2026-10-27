// -----------------------------------------------------------------------------
// The answers of the JSON API -> values: the wiki examples, the tariff
// options, strict numbers, texts never measurements, prototype keys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integer, parseDaily, parseIndexes, totalOfTariffs } from '../src/ecodevices/model.js';
import { WIKI_DAILY, WIKI_INDEXES, hchp, indexes, tempo } from './fixtures/ecodevices.js';

test('the example of the GCE wiki (cmd=10): T1 in base, T2 unused, both counters', () => {
  const r = parseIndexes(WIKI_INDEXES);
  assert.deepEqual(r.teleinfo.t1, {
    connected: true,
    period: 'TH..',
    papp: 850,
    pappInvalid: false,
    option: 'base',
    tariffs: { BASE: 50_670_371 },
    missing: [],
    ambiguous: false,
  });
  assert.equal(r.teleinfo.t2.connected, false, '"----" and zeros: no meter');
  assert.equal(r.teleinfo.t2.papp, undefined, 'a 0 on an unused input is never a value');
  assert.equal(r.teleinfo.t2.tariffs, undefined);
  assert.deepEqual(r.counters, { c1: 70_371, c2: 21_792_980 });
});

test('the example of the GCE wiki (cmd=20)', () => {
  assert.deepEqual(parseDaily(WIKI_DAILY), { c1: 135, c2: 3960 });
  assert.deepEqual(parseDaily({ product: 'Eco-devices', Day_C1: 0 }), { c1: 0, c2: undefined });
});

test('not an Eco-Devices answer: undefined (the RT2, another product, not an object)', () => {
  for (const body of [
    null,
    [],
    'Eco-devices',
    {},
    { product: 'EcoDevices RT2', T1_PAPP: 1 },
    { product: 'IPX800' },
    { product: 42 },
  ]) {
    assert.equal(parseIndexes(body), undefined, JSON.stringify(body));
    assert.equal(parseDaily(body), undefined, JSON.stringify(body));
  }
  assert.ok(parseIndexes({ product: 'EcoDevices' }));
  assert.ok(parseIndexes({ product: 'eco-devices ' }));
});

test('off-peak/peak and Tempo options: the indexes of that option only', () => {
  const hc = parseIndexes(hchp()).teleinfo.t1;
  assert.equal(hc.option, 'hc');
  assert.deepEqual(hc.tariffs, { HCHC: 20_000_000, HCHP: 30_000_000 });
  const t = parseIndexes(tempo()).teleinfo.t1;
  assert.equal(t.option, 'tempo');
  assert.equal(Object.keys(t.tariffs).length, 6);
  assert.equal(t.tariffs.BBRHCJR, 0, 'a red index still at 0 is a value of the option');
  assert.equal(t.period, 'HPJB');
});

test('two options with values at once: ambiguous, no index', () => {
  const t = parseIndexes(indexes({ t1: { HCHC: 5 } })).teleinfo.t1;
  assert.equal(t.ambiguous, true);
  assert.equal(t.tariffs, undefined);
  assert.equal(t.connected, true);
});

test('strict numbers: "" and null are unknown, never 0; strings of digits pass; bounds', () => {
  assert.equal(integer('', 10), undefined);
  assert.equal(integer(null, 10), undefined);
  assert.equal(integer(undefined, 10), undefined);
  assert.equal(integer('007', 10), 7);
  assert.equal(integer(1.5, 10), undefined, 'a decimal is not an index');
  assert.equal(integer(-1, 10), undefined);
  assert.equal(integer(11, 10), undefined);
  assert.equal(integer('1e3', 10_000), undefined);
  assert.equal(integer(' 5', 10), undefined);
  assert.equal(integer(Number.NaN, 10), undefined);
  const t = parseIndexes(indexes({ papp: '', t1: { BASE: '' } })).teleinfo.t1;
  assert.equal(t.papp, undefined, 'an empty power is unknown');
  assert.equal(t.pappInvalid, true);
  assert.equal(t.tariffs, undefined, 'an empty index is not 0');
  const big = parseIndexes(indexes({ papp: 100_000 })).teleinfo.t1;
  assert.equal(big.papp, undefined, 'PAPP has 5 digits');
});

test('a text is never a measurement: PTEC is only a text, an odd one is dropped', () => {
  const t = parseIndexes(indexes({ t1: { PTEC: '<script>' } })).teleinfo.t1;
  assert.equal(t.period, undefined);
  assert.equal(parseIndexes(indexes({ t1: { PTEC: 'Aus' } })).teleinfo.t1.period, 'Aus');
  assert.equal(parseIndexes(indexes({ papp: 'HC..' })).teleinfo.t1.papp, undefined);
});

test('counters: 0 is "no index", never a value', () => {
  const r = parseIndexes(indexes({ c1: 0, c2: '' }));
  assert.equal(r.counters.c1, undefined);
  assert.equal(r.counters.c2, undefined);
});

test('only own keys: a __proto__ key never reaches a value', () => {
  const body = JSON.parse(
    '{"product":"Eco-devices","__proto__":{"T1_BASE":5,"T1_PTEC":"HC.."},"T2_PTEC":"----"}',
  );
  const r = parseIndexes(body);
  assert.equal(r.teleinfo.t1.connected, false);
  assert.equal({}.T1_BASE, undefined, 'no prototype pollution');
});

test('total of tariffs: all of the option, glitches never reach the guard', () => {
  const hc = (a, b) => ({ option: 'hc', tariffs: { HCHC: a, HCHP: b } });
  assert.equal(totalOfTariffs(hc(10, 20)), 30);
  assert.equal(totalOfTariffs(hc(10, undefined)), undefined, 'one index missing');
  assert.equal(totalOfTariffs(hc(0, 0)), undefined, 'a total at 0');
  // Against the last total accepted:
  assert.equal(totalOfTariffs(hc(11, 21), hc(10, 20)), 32);
  assert.equal(totalOfTariffs(hc(0, 21), hc(10, 20)), undefined, 'one index back to 0');
  assert.equal(totalOfTariffs(hc(9, 21), hc(10, 20)), undefined, 'one index lower alone');
  assert.equal(totalOfTariffs(hc(5, 6), hc(10, 20)), 11, 'both lower: a real drop, to the guard');
  // Tempo: a red index still at 0 does not stop a real drop from reaching the guard.
  const t = (b, r) => ({
    option: 'tempo',
    tariffs: { BBRHCJB: b, BBRHPJB: b, BBRHCJW: b, BBRHPJW: b, BBRHCJR: r, BBRHPJR: r },
  });
  assert.equal(totalOfTariffs(t(5, 0), t(100, 0)), 20);
  // Another option than before: to the guard (which holds a drop or a jump).
  assert.equal(totalOfTariffs({ option: 'base', tariffs: { BASE: 7 } }, hc(10, 20)), 7);
});
